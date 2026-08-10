import { config } from "../config.ts";
import { sql } from "../db.ts";

export type Outcome =
  | "password_ok"
  | "password_fail"
  | "factor2_ok"
  | "factor2_fail"
  | "locked";

export async function record(
  username: string | null,
  ip: string | null,
  outcome: Outcome,
): Promise<void> {
  await sql`
    insert into login_attempts (username, ip, outcome) values (${username}, ${ip}, ${outcome})
  `;
}

export interface LockStatus {
  locked: boolean;
  reason: "account" | "ip" | null;
  retryAfterSeconds: number;
}

const FAIL_OUTCOMES = ["password_fail", "factor2_fail"];

/**
 * Counts recent failures against two independent budgets.
 *
 * Both are needed. An account-only budget lets anyone lock the founder out of their own
 * dashboard by spraying their username; an IP-only budget is defeated by rotating
 * addresses. Running both, with the account budget the *tighter* of the two, means a
 * targeted lockout still costs the attacker far more requests than it costs the owner
 * in inconvenience — and the owner's own address is almost never the one being throttled.
 */
export async function checkLock(
  username: string | null,
  ip: string | null,
): Promise<LockStatus> {
  const accountWindow = `${config.rateLimit.accountWindowMinutes} minutes`;
  const ipWindow = `${config.rateLimit.ipWindowMinutes} minutes`;

  const [account] = username
    ? await sql<{ n: string; oldest: Date | null }[]>`
        select count(*)::text as n, min(at) as oldest
          from login_attempts
         where lower(username) = lower(${username})
           and outcome = any(${FAIL_OUTCOMES})
           and at > now() - ${accountWindow}::interval
      `
    : [{ n: "0", oldest: null }];

  const [byIp] = ip
    ? await sql<{ n: string; oldest: Date | null }[]>`
        select count(*)::text as n, min(at) as oldest
          from login_attempts
         where ip = ${ip}::inet
           and outcome = any(${FAIL_OUTCOMES})
           and at > now() - ${ipWindow}::interval
      `
    : [{ n: "0", oldest: null }];

  if (Number(account.n) >= config.rateLimit.accountMaxFails) {
    return {
      locked: true,
      reason: "account",
      retryAfterSeconds: secondsUntilClear(account.oldest, config.rateLimit.accountWindowMinutes),
    };
  }
  if (Number(byIp.n) >= config.rateLimit.ipMaxFails) {
    return {
      locked: true,
      reason: "ip",
      retryAfterSeconds: secondsUntilClear(byIp.oldest, config.rateLimit.ipWindowMinutes),
    };
  }
  return { locked: false, reason: null, retryAfterSeconds: 0 };
}

function secondsUntilClear(oldest: Date | null, windowMinutes: number): number {
  if (!oldest) return windowMinutes * 60;
  const clearsAt = new Date(oldest).getTime() + windowMinutes * 60 * 1000;
  return Math.max(1, Math.ceil((clearsAt - Date.now()) / 1000));
}

/**
 * A deliberate delay on every failed attempt.
 *
 * The lockout above bounds a sustained attack; this bounds the *rate* of a slow one that
 * stays under the threshold on purpose. It is applied to failures only, so the one person
 * who signs in successfully never waits.
 */
export function failureDelay(): Promise<void> {
  // 250–750 ms. Jittered so the delay itself carries no information about which check
  // failed or how far through the sequence the attempt got.
  const ms = 250 + Math.floor(Math.random() * 500);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Keeps the attempts table bounded; called on the same timer as the session sweep. */
export async function pruneAttempts(): Promise<void> {
  await sql`delete from login_attempts where at < now() - interval '30 days'`;
}
