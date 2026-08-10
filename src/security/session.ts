import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { config } from "../config.ts";
import { sql } from "../db.ts";
import { randomToken, sha256, timingSafeEqual } from "./crypto.ts";

// `__Secure-` guarantees that production cookies are set over HTTPS while still allowing
// an owner to mount Appdmin under a configured base path.
export const SESSION_COOKIE = "__Secure-appdmin_session";
export const PENDING_COOKIE = "__Secure-appdmin_pending";
export const CSRF_HEADER = "x-appdmin-csrf";

export interface SessionRow {
  id: string;
  account_id: string;
  csrf_token: string;
  factor2: string;
  created_at: Date;
  last_seen_at: Date;
  absolute_expires_at: Date;
  stepup_at: Date | null;
  username: string;
  display_name: string;
}

/**
 * The attributes a `__Secure-` cookie must carry.
 *
 * These belong on the DELETE as much as the SET: the prefix is enforced on serialisation,
 * so an expiry written without `Secure` throws rather than clearing anything — which
 * turns a successful sign-in into a 500 at the last step.
 */
const CLEAR_OPTIONS = {
  path: config.basePath,
  httpOnly: true,
  secure: true,
  sameSite: "Strict" as const,
};

function cookieOptions(maxAgeSeconds: number) {
  return {
    path: config.basePath,
    httpOnly: true,
    secure: true,
    // Strict, not Lax: nothing outside the dashboard ever needs to link into an
    // authenticated view, and Strict removes the entire class of cross-site request
    // attacks that Lax still permits on top-level GET navigation.
    sameSite: "Strict" as const,
    maxAge: maxAgeSeconds,
  };
}

// ── Pending logins (password accepted, second factor outstanding) ───────────────────

export async function createPendingLogin(
  c: Context,
  accountId: string,
  ip: string | null,
  userAgent: string | null,
): Promise<void> {
  const token = randomToken(32);
  const expires = new Date(Date.now() + 5 * 60 * 1000);
  await sql`
    insert into pending_logins (account_id, token_sha256, ip, user_agent, expires_at)
    values (${accountId}, ${await sha256(token)}, ${ip}, ${userAgent}, ${expires})
  `;
  setCookie(c, PENDING_COOKIE, token, cookieOptions(5 * 60));
}

export async function readPendingLogin(c: Context): Promise<{ accountId: string } | null> {
  const token = getCookie(c, PENDING_COOKIE);
  if (!token) return null;
  const [row] = await sql<{ account_id: string }[]>`
    select account_id from pending_logins
     where token_sha256 = ${await sha256(token)} and expires_at > now()
  `;
  return row ? { accountId: row.account_id } : null;
}

export async function clearPendingLogin(c: Context): Promise<void> {
  const token = getCookie(c, PENDING_COOKIE);
  if (token) {
    await sql`delete from pending_logins where token_sha256 = ${await sha256(token)}`;
  }
  deleteCookie(c, PENDING_COOKIE, CLEAR_OPTIONS);
}

// ── Sessions ────────────────────────────────────────────────────────────────────────

export async function createSession(
  c: Context,
  accountId: string,
  factor2: "webauthn" | "totp" | "recovery",
  ip: string | null,
  userAgent: string | null,
): Promise<void> {
  const token = randomToken(32);
  const csrf = randomToken(32);
  const absolute = new Date(Date.now() + config.session.absoluteHours * 3600 * 1000);

  await sql`
    insert into sessions
      (account_id, token_sha256, csrf_token, ip, user_agent, factor2, absolute_expires_at, stepup_at)
    values
      (${accountId}, ${await sha256(token)}, ${csrf}, ${ip}, ${userAgent}, ${factor2},
       ${absolute}, now())
  `;

  await sql`update admin_accounts set last_login_at = now() where id = ${accountId}`;

  // The cookie's own lifetime is the absolute ceiling; the idle window is enforced
  // server-side, because a cookie max-age is a request the browser may ignore.
  setCookie(c, SESSION_COOKIE, token, cookieOptions(config.session.absoluteHours * 3600));
}

/**
 * Resolves and refreshes the caller's session.
 *
 * Both expiries are enforced here rather than by a background sweep: a sweep that fails
 * to run would leave sessions alive past their ceiling, whereas a check on the read path
 * cannot be skipped.
 */
export async function currentSession(c: Context): Promise<SessionRow | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;

  const idleCutoff = new Date(Date.now() - config.session.idleMinutes * 60 * 1000);

  const [row] = await sql<SessionRow[]>`
    update sessions s
       set last_seen_at = now()
      from admin_accounts a
     where s.token_sha256 = ${await sha256(token)}
       and s.account_id = a.id
       and s.revoked_at is null
       and s.absolute_expires_at > now()
       and s.last_seen_at > ${idleCutoff}
       and a.is_active
    returning s.id, s.account_id, s.csrf_token, s.factor2, s.created_at, s.last_seen_at,
              s.absolute_expires_at, s.stepup_at, a.username, a.display_name
  `;
  return row ?? null;
}

export async function revokeSession(c: Context): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    await sql`
      update sessions set revoked_at = now()
       where token_sha256 = ${await sha256(token)} and revoked_at is null
    `;
  }
  deleteCookie(c, SESSION_COOKIE, CLEAR_OPTIONS);
}

export async function revokeAllSessions(accountId: string): Promise<number> {
  const rows = await sql`
    update sessions set revoked_at = now()
     where account_id = ${accountId} and revoked_at is null
    returning id
  `;
  return rows.length;
}

export async function markStepUp(sessionId: string): Promise<void> {
  await sql`update sessions set stepup_at = now() where id = ${sessionId}`;
}

export function stepUpIsFresh(session: SessionRow): boolean {
  if (!session.stepup_at) return false;
  const age = Date.now() - new Date(session.stepup_at).getTime();
  return age < config.session.stepUpMinutes * 60 * 1000;
}

/** Removes rows that can no longer authenticate anything. Called on a timer. */
export async function pruneSessions(): Promise<void> {
  await sql`delete from sessions where absolute_expires_at < now() - interval '7 days'`;
  await sql`delete from pending_logins where expires_at < now() - interval '1 hour'`;
}

// ── CSRF ────────────────────────────────────────────────────────────────────────────

/**
 * Two independent checks, because each covers a case the other misses.
 *
 * The Origin header defeats a cross-site form post outright, but is absent on some
 * same-origin requests and can be stripped by intermediaries. The per-session token
 * defeats anything that can issue a request but cannot read the response — which is the
 * defining limitation of a cross-site attacker. SameSite=Strict on the cookie is a third
 * layer, but it is a browser policy rather than something this service can verify.
 */
export function csrfIsValid(c: Context, session: SessionRow): boolean {
  const method = c.req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;

  const origin = c.req.header("origin");
  if (origin && origin !== config.origin) return false;
  // A state-changing request with no Origin at all is refused: every browser that can
  // run this dashboard sends one on fetch(), so its absence means a non-browser caller.
  if (!origin) return false;

  const presented = c.req.header(CSRF_HEADER) ?? "";
  return presented !== "" && timingSafeEqual(presented, session.csrf_token);
}
