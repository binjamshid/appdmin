import type { Context, MiddlewareHandler } from "hono";
import { audit } from "./audit.ts";
import { clientIp } from "./headers.ts";
import { csrfIsValid, currentSession, type SessionRow, stepUpIsFresh } from "./session.ts";

declare module "hono" {
  interface ContextVariableMap {
    session: SessionRow;
  }
}

/**
 * The gate every API route sits behind.
 *
 * Order is deliberate: authenticate first, then check CSRF. A CSRF failure on an
 * unauthenticated request tells the caller nothing useful, and checking the token before
 * knowing whose session it should match is not a check at all.
 */
export const requireSession: MiddlewareHandler = async (c, next) => {
  const session = await currentSession(c);
  if (!session) return c.json({ error: "unauthenticated" }, 401);

  if (!csrfIsValid(c, session)) {
    await audit({
      accountId: session.account_id,
      actor: session.username,
      ip: clientIp(c),
      action: "csrf.rejected",
      target: c.req.path,
      outcome: "denied",
    });
    return c.json({ error: "csrf_failed" }, 403);
  }

  c.set("session", session);
  await next();
};

/**
 * Additional gate for operations that move money, mail or entitlements.
 *
 * A live session is not enough for these: a session lives up to twelve hours, and an
 * unlocked phone left on a desk is inside that window. Requiring a second factor within
 * the last few minutes means the person at the keyboard proved possession *just now*.
 */
export const requireStepUp: MiddlewareHandler = async (c, next) => {
  const session = c.get("session");
  if (!stepUpIsFresh(session)) {
    return c.json({ error: "stepup_required" }, 403);
  }
  await next();
};

/** Convenience for audit calls inside a guarded route. */
export function actor(c: Context) {
  const session = c.get("session");
  return {
    accountId: session.account_id,
    actor: session.username,
    ip: clientIp(c),
  };
}
