import { Hono } from "hono";
import { config } from "../config.ts";
import { sql } from "../db.ts";
import { audit } from "../security/audit.ts";
import { decrypt, encrypt, randomToken, sha256Hex } from "../security/crypto.ts";
import { actor, requireSession, requireStepUp } from "../security/guard.ts";
import { clientIp, userAgent } from "../security/headers.ts";
import {
  burnTime,
  hashPassword,
  validatePasswordStrength,
  verifyPassword,
} from "../security/password.ts";
import * as limit from "../security/ratelimit.ts";
import {
  clearPendingLogin,
  createPendingLogin,
  createSession,
  markStepUp,
  readPendingLogin,
  revokeAllSessions,
  revokeSession,
} from "../security/session.ts";
import { currentStep, generateSecret, otpauthUri, verifyTotp } from "../security/totp.ts";
import * as webauthn from "../security/webauthn.ts";

export const auth = new Hono();

interface AccountRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  totp_secret_enc: Uint8Array | null;
  totp_confirmed_at: Date | null;
  totp_last_step: string | null;
  is_active: boolean;
}

async function loadAccount(username: string): Promise<AccountRow | null> {
  const [row] = await sql<AccountRow[]>`
    select id, username, display_name, password_hash, totp_secret_enc, totp_confirmed_at,
           totp_last_step::text as totp_last_step, is_active
      from admin_accounts
     where lower(username) = lower(${username})
  `;
  return row ?? null;
}

async function loadAccountById(id: string): Promise<AccountRow | null> {
  const [row] = await sql<AccountRow[]>`
    select id, username, display_name, password_hash, totp_secret_enc, totp_confirmed_at,
           totp_last_step::text as totp_last_step, is_active
      from admin_accounts
     where id = ${id}
  `;
  return row ?? null;
}

// ── Step 1: password ────────────────────────────────────────────────────────────────

auth.post("/login", async (c) => {
  const ip = clientIp(c);
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const username = String(body.username ?? "").trim().slice(0, 256);
  const password = String(body.password ?? "");

  const lock = await limit.checkLock(username || null, ip);
  if (lock.locked) {
    await limit.record(username || null, ip, "locked");
    c.header("Retry-After", String(lock.retryAfterSeconds));
    return c.json({ error: "rate_limited", retry_after: lock.retryAfterSeconds }, 429);
  }

  const account = username ? await loadAccount(username) : null;

  // A missing account still costs a full Argon2 verification. Skipping it would make
  // "no such user" measurably faster than "wrong password" and turn this form into a
  // username oracle.
  if (!account || !account.is_active) {
    await burnTime(password);
    await limit.record(username || null, ip, "password_fail");
    await limit.failureDelay();
    return c.json({ error: "invalid_credentials" }, 401);
  }

  if (!(await verifyPassword(password, account.password_hash))) {
    await limit.record(username, ip, "password_fail");
    await limit.failureDelay();
    return c.json({ error: "invalid_credentials" }, 401);
  }

  const passkeys = await webauthn.credentialsFor(account.id);
  const totpReady = account.totp_confirmed_at !== null;

  // Fail closed. An account with a password and nothing else would be single-factor,
  // which is exactly what this dashboard must never allow — so it cannot sign in at all
  // until a second factor is enrolled on the box with scripts/bootstrap-admin.ts.
  if (passkeys.length === 0 && !totpReady) {
    await limit.record(username, ip, "password_fail");
    await audit({
      accountId: account.id,
      actor: account.username,
      ip,
      action: "auth.login.blocked",
      detail: { reason: "no second factor enrolled" },
      outcome: "denied",
    });
    return c.json({ error: "no_second_factor" }, 403);
  }

  await limit.record(username, ip, "password_ok");
  await createPendingLogin(c, account.id, ip, userAgent(c));

  return c.json({
    next: passkeys.length > 0 ? "webauthn" : "totp",
    methods: {
      webauthn: passkeys.length > 0,
      totp: totpReady,
      recovery: true,
    },
  });
});

// ── Step 2a: WebAuthn ───────────────────────────────────────────────────────────────

auth.post("/webauthn/options", async (c) => {
  const pending = await readPendingLogin(c);
  if (!pending) return c.json({ error: "no_pending_login" }, 401);

  const options = await webauthn.startAuthentication(pending.accountId);
  if (!options) return c.json({ error: "no_credentials" }, 400);
  return c.json(options);
});

auth.post("/webauthn/verify", async (c) => {
  const ip = clientIp(c);
  const pending = await readPendingLogin(c);
  if (!pending) return c.json({ error: "no_pending_login" }, 401);

  const account = await loadAccountById(pending.accountId);
  if (!account || !account.is_active) return c.json({ error: "no_pending_login" }, 401);

  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const result = await webauthn.finishAuthentication(pending.accountId, body);

  if (!result.ok) {
    await limit.record(account.username, ip, "factor2_fail");
    await limit.failureDelay();
    await audit({
      accountId: account.id,
      actor: account.username,
      ip,
      action: "auth.webauthn.failed",
      detail: { reason: result.error },
      outcome: "denied",
    });
    return c.json({ error: "verification_failed" }, 401);
  }

  await clearPendingLogin(c);
  await limit.record(account.username, ip, "factor2_ok");
  await createSession(c, account.id, "webauthn", ip, userAgent(c));
  await audit({
    accountId: account.id,
    actor: account.username,
    ip,
    action: "auth.login",
    detail: { factor2: "webauthn" },
  });
  return c.json({ ok: true });
});

// ── Step 2b: TOTP ───────────────────────────────────────────────────────────────────

auth.post("/totp", async (c) => {
  const ip = clientIp(c);
  const pending = await readPendingLogin(c);
  if (!pending) return c.json({ error: "no_pending_login" }, 401);

  const account = await loadAccountById(pending.accountId);
  if (!account || !account.is_active || !account.totp_secret_enc || !account.totp_confirmed_at) {
    return c.json({ error: "totp_not_enrolled" }, 400);
  }

  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const secret = await decrypt(account.totp_secret_enc);
  const result = await verifyTotp(
    secret,
    String(body.code ?? ""),
    account.totp_last_step ? Number(account.totp_last_step) : null,
  );

  if (!result.valid) {
    await limit.record(account.username, ip, "factor2_fail");
    await limit.failureDelay();
    await audit({
      accountId: account.id,
      actor: account.username,
      ip,
      action: "auth.totp.failed",
      outcome: "denied",
    });
    return c.json({ error: "invalid_code" }, 401);
  }

  // Burn the step before minting the session, so two requests racing with the same code
  // cannot both succeed.
  const burned = await sql`
    update admin_accounts
       set totp_last_step = ${result.step}
     where id = ${account.id}
       and (totp_last_step is null or totp_last_step < ${result.step})
    returning id
  `;
  if (burned.length === 0) {
    await limit.record(account.username, ip, "factor2_fail");
    return c.json({ error: "code_already_used" }, 401);
  }

  await clearPendingLogin(c);
  await limit.record(account.username, ip, "factor2_ok");
  await createSession(c, account.id, "totp", ip, userAgent(c));
  await audit({
    accountId: account.id,
    actor: account.username,
    ip,
    action: "auth.login",
    detail: { factor2: "totp" },
  });
  return c.json({ ok: true });
});

// ── Step 2c: recovery code ──────────────────────────────────────────────────────────

auth.post("/recovery", async (c) => {
  const ip = clientIp(c);
  const pending = await readPendingLogin(c);
  if (!pending) return c.json({ error: "no_pending_login" }, 401);

  const account = await loadAccountById(pending.accountId);
  if (!account || !account.is_active) return c.json({ error: "no_pending_login" }, 401);

  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const code = String(body.code ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.length < 10) {
    await limit.record(account.username, ip, "factor2_fail");
    await limit.failureDelay();
    return c.json({ error: "invalid_code" }, 401);
  }

  // Claim and mark used in one statement: a recovery code is single-use, and two
  // concurrent submissions of the same code must not both mint a session.
  const claimed = await sql`
    update recovery_codes
       set used_at = now()
     where account_id = ${account.id}
       and code_hash = ${await sha256Hex(code)}
       and used_at is null
    returning id
  `;

  if (claimed.length === 0) {
    await limit.record(account.username, ip, "factor2_fail");
    await limit.failureDelay();
    await audit({
      accountId: account.id,
      actor: account.username,
      ip,
      action: "auth.recovery.failed",
      outcome: "denied",
    });
    return c.json({ error: "invalid_code" }, 401);
  }

  const [{ count: remaining }] = await sql<{ count: string }[]>`
    select count(*)::text from recovery_codes where account_id = ${account.id} and used_at is null
  `;

  await clearPendingLogin(c);
  await limit.record(account.username, ip, "factor2_ok");
  await createSession(c, account.id, "recovery", ip, userAgent(c));
  await audit({
    accountId: account.id,
    actor: account.username,
    ip,
    action: "auth.login",
    detail: { factor2: "recovery", remaining_codes: Number(remaining) },
  });
  return c.json({ ok: true, remaining_recovery_codes: Number(remaining) });
});

// ── Session ─────────────────────────────────────────────────────────────────────────

auth.post("/logout", requireSession, async (c) => {
  const a = actor(c);
  await revokeSession(c);
  await audit({ ...a, action: "auth.logout" });
  return c.json({ ok: true });
});

auth.get("/me", requireSession, async (c) => {
  const session = c.get("session");
  const passkeys = await webauthn.credentialsFor(session.account_id);
  const [account] = await sql<{ totp_confirmed_at: Date | null }[]>`
    select totp_confirmed_at from admin_accounts where id = ${session.account_id}
  `;
  const [{ count: recovery }] = await sql<{ count: string }[]>`
    select count(*)::text from recovery_codes
     where account_id = ${session.account_id} and used_at is null
  `;

  return c.json({
    username: session.username,
    display_name: session.display_name,
    csrf_token: session.csrf_token,
    session: {
      factor2: session.factor2,
      created_at: session.created_at,
      absolute_expires_at: session.absolute_expires_at,
      stepup_at: session.stepup_at,
    },
    factors: {
      passkeys: passkeys.map((p) => ({
        id: p.id,
        nickname: p.nickname,
        device_type: p.device_type,
        backed_up: p.backed_up,
        created_at: p.created_at,
        last_used_at: p.last_used_at,
      })),
      totp_enrolled: account?.totp_confirmed_at !== null,
      recovery_codes_remaining: Number(recovery),
    },
  });
});

auth.post("/logout-everywhere", requireSession, async (c) => {
  const a = actor(c);
  const n = await revokeAllSessions(a.accountId);
  await audit({ ...a, action: "auth.logout_all", detail: { revoked: n } });
  return c.json({ ok: true, revoked: n });
});

// ── Step-up re-authentication ───────────────────────────────────────────────────────

auth.post("/stepup/webauthn/options", requireSession, async (c) => {
  const session = c.get("session");
  const options = await webauthn.startAuthentication(session.account_id);
  if (!options) return c.json({ error: "no_credentials" }, 400);
  return c.json(options);
});

auth.post("/stepup/webauthn/verify", requireSession, async (c) => {
  const session = c.get("session");
  const a = actor(c);
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const result = await webauthn.finishAuthentication(session.account_id, body);
  if (!result.ok) {
    await limit.failureDelay();
    await audit({
      ...a,
      action: "auth.stepup.failed",
      detail: { method: "webauthn" },
      outcome: "denied",
    });
    return c.json({ error: "verification_failed" }, 401);
  }
  await markStepUp(session.id);
  await audit({ ...a, action: "auth.stepup", detail: { method: "webauthn" } });
  return c.json({ ok: true });
});

auth.post("/stepup/totp", requireSession, async (c) => {
  const session = c.get("session");
  const a = actor(c);
  const account = await loadAccountById(session.account_id);
  if (!account?.totp_secret_enc || !account.totp_confirmed_at) {
    return c.json({ error: "totp_not_enrolled" }, 400);
  }

  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const secret = await decrypt(account.totp_secret_enc);
  const result = await verifyTotp(
    secret,
    String(body.code ?? ""),
    account.totp_last_step ? Number(account.totp_last_step) : null,
  );
  if (!result.valid) {
    await limit.failureDelay();
    await audit({
      ...a,
      action: "auth.stepup.failed",
      detail: { method: "totp" },
      outcome: "denied",
    });
    return c.json({ error: "invalid_code" }, 401);
  }

  const burned = await sql`
    update admin_accounts set totp_last_step = ${result.step}
     where id = ${account.id} and (totp_last_step is null or totp_last_step < ${result.step})
    returning id
  `;
  if (burned.length === 0) return c.json({ error: "code_already_used" }, 401);

  await markStepUp(session.id);
  await audit({ ...a, action: "auth.stepup", detail: { method: "totp" } });
  return c.json({ ok: true });
});

// ── Factor management (all require a fresh step-up) ─────────────────────────────────

auth.post("/passkeys/options", requireSession, requireStepUp, async (c) => {
  const session = c.get("session");
  const options = await webauthn.startRegistration(session.account_id, session.username);
  return c.json(options);
});

auth.post("/passkeys/verify", requireSession, requireStepUp, async (c) => {
  const session = c.get("session");
  const a = actor(c);
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const nickname = typeof body.nickname === "string" ? body.nickname.slice(0, 64) : null;
  const result = await webauthn.finishRegistration(
    session.account_id,
    (body.response ?? body) as Record<string, unknown>,
    nickname,
  );
  if (!result.ok) {
    await audit({
      ...a,
      action: "auth.passkey.add",
      detail: { reason: result.error },
      outcome: "failed",
    });
    return c.json({ error: result.error }, 400);
  }
  await audit({ ...a, action: "auth.passkey.add", target: result.id, detail: { nickname } });
  return c.json({ ok: true, id: result.id });
});

auth.delete("/passkeys/:id", requireSession, requireStepUp, async (c) => {
  const session = c.get("session");
  const a = actor(c);
  const id = c.req.param("id");

  // Removing the last passkey is allowed only when TOTP is enrolled, otherwise the
  // account would be left single-factor — the state the login route refuses to accept,
  // which would lock the founder out entirely.
  const creds = await webauthn.credentialsFor(session.account_id);
  const [account] = await sql<{ totp_confirmed_at: Date | null }[]>`
    select totp_confirmed_at from admin_accounts where id = ${session.account_id}
  `;
  if (creds.length <= 1 && !account?.totp_confirmed_at) {
    return c.json({ error: "would_remove_last_factor" }, 400);
  }

  const removed = await sql`
    delete from webauthn_credentials
     where id = ${id} and account_id = ${session.account_id}
    returning id
  `;
  if (removed.length === 0) return c.json({ error: "not_found" }, 404);

  await audit({ ...a, action: "auth.passkey.remove", target: id });
  return c.json({ ok: true });
});

auth.post("/totp/setup", requireSession, requireStepUp, async (c) => {
  const session = c.get("session");
  const secret = generateSecret();

  // Stored immediately but left unconfirmed. Until /totp/confirm proves the authenticator
  // produces matching codes, the login route treats this account as having no TOTP —
  // so a mistyped secret cannot silently become the only way back in.
  await sql`
    update admin_accounts
       set totp_secret_enc = ${await encrypt(secret)}, totp_confirmed_at = null
     where id = ${session.account_id}
  `;

  return c.json({
    secret,
    uri: otpauthUri(secret, session.username, config.rpName),
  });
});

auth.post("/totp/confirm", requireSession, requireStepUp, async (c) => {
  const session = c.get("session");
  const a = actor(c);
  const account = await loadAccountById(session.account_id);
  if (!account?.totp_secret_enc) return c.json({ error: "no_pending_secret" }, 400);

  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const secret = await decrypt(account.totp_secret_enc);
  const result = await verifyTotp(secret, String(body.code ?? ""), null);
  if (!result.valid) return c.json({ error: "invalid_code" }, 400);

  await sql`
    update admin_accounts
       set totp_confirmed_at = now(), totp_last_step = ${result.step}
     where id = ${session.account_id}
  `;
  await audit({ ...a, action: "auth.totp.enrolled" });
  return c.json({ ok: true });
});

auth.post("/recovery/regenerate", requireSession, requireStepUp, async (c) => {
  const session = c.get("session");
  const a = actor(c);

  // Regenerating invalidates every previous code. That is the point: it is the response
  // to "I think my printed list was seen", so leaving the old ones live would defeat it.
  await sql`delete from recovery_codes where account_id = ${session.account_id}`;

  const codes: string[] = [];
  for (let i = 0; i < 10; i++) {
    // 20 base32-ish characters ≈ 100 bits, grouped for legibility when written down.
    const raw = randomToken(16).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20);
    const code = raw.match(/.{1,5}/g)!.join("-");
    codes.push(code);
    await sql`
      insert into recovery_codes (account_id, code_hash)
      values (${session.account_id}, ${await sha256Hex(code.replace(/-/g, ""))})
    `;
  }

  await audit({ ...a, action: "auth.recovery.regenerated", detail: { count: codes.length } });
  return c.json({ codes });
});

auth.post("/password", requireSession, requireStepUp, async (c) => {
  const session = c.get("session");
  const a = actor(c);
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const current = String(body.current ?? "");
  const next = String(body.next ?? "");

  const account = await loadAccountById(session.account_id);
  if (!account || !(await verifyPassword(current, account.password_hash))) {
    await limit.failureDelay();
    await audit({ ...a, action: "auth.password.change", outcome: "denied" });
    return c.json({ error: "invalid_credentials" }, 401);
  }

  const problem = validatePasswordStrength(next);
  if (problem) return c.json({ error: "weak_password", message: problem }, 400);

  await sql`
    update admin_accounts
       set password_hash = ${await hashPassword(next)}, password_changed_at = now()
     where id = ${session.account_id}
  `;

  // Every other session is cut. A password change is the standard response to "someone
  // may have my credentials", and it would be worthless if the sessions minted with the
  // old one kept working.
  await sql`
    update sessions set revoked_at = now()
     where account_id = ${session.account_id} and id <> ${session.id} and revoked_at is null
  `;

  await audit({ ...a, action: "auth.password.change" });
  return c.json({ ok: true });
});

/** Exposed for the sweeper in main.ts. */
export async function pruneAuthTables(): Promise<void> {
  await webauthn.pruneChallenges();
  await limit.pruneAttempts();
}

export { currentStep };
