// RFC 6238 TOTP over RFC 4226 HOTP, with HMAC-SHA1 from Web Crypto.
//
// SHA-1 is correct here and is not the broken use of SHA-1: HOTP depends on HMAC-SHA1's
// PRF security, which collision attacks do not touch, and every authenticator app in
// circulation assumes it. Choosing SHA-256 would produce codes that Google Authenticator
// and iOS Passwords silently compute differently.

import { base32Decode, base32Encode } from "./crypto.ts";

const STEP_SECONDS = 30;
const DIGITS = 6;

/** How many steps either side of "now" are accepted, to absorb clock drift. */
const DRIFT_STEPS = 1;

export function generateSecret(): string {
  // 20 bytes = 160 bits, the RFC 4226 recommended length and what authenticator apps
  // expect from a 32-character base32 string.
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)));
}

export function currentStep(at: Date = new Date()): number {
  return Math.floor(at.getTime() / 1000 / STEP_SECONDS);
}

async function hotp(secret: Uint8Array, counter: number): Promise<string> {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  // Counter is a 64-bit big-endian integer. Split across two 32-bit writes because
  // setBigUint64 would need the value as a BigInt for no benefit at these magnitudes.
  view.setUint32(0, Math.floor(counter / 2 ** 32));
  view.setUint32(4, counter >>> 0);

  const key = await crypto.subtle.importKey(
    "raw",
    secret as BufferSource,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, buf));

  // Dynamic truncation, RFC 4226 §5.3.
  const offset = mac[mac.length - 1] & 0x0f;
  const binary = ((mac[offset] & 0x7f) << 24) |
    ((mac[offset + 1] & 0xff) << 16) |
    ((mac[offset + 2] & 0xff) << 8) |
    (mac[offset + 3] & 0xff);

  return (binary % 10 ** DIGITS).toString().padStart(DIGITS, "0");
}

export interface TotpResult {
  valid: boolean;
  /** The step the code matched, so the caller can reject a replay of it. */
  step: number | null;
}

/**
 * Verifies a code against the accepted drift window.
 *
 * `minStep` is the replay guard: pass the last step this account already used, and any
 * code from that step or earlier is refused. Without it a code stays valid for its whole
 * 30-second window, so an attacker who observes one — over the shoulder, from a
 * screenshot, from a phished form — can still spend it.
 */
export async function verifyTotp(
  secretBase32: string,
  code: string,
  minStep: number | null,
  at: Date = new Date(),
): Promise<TotpResult> {
  const cleaned = code.replace(/\D/g, "");
  if (cleaned.length !== DIGITS) return { valid: false, step: null };

  const secret = base32Decode(secretBase32);
  const now = currentStep(at);

  let matched: number | null = null;
  // Every candidate is computed even after a match, so the time taken does not reveal
  // which step matched (and therefore how far the client's clock is off).
  for (let delta = -DRIFT_STEPS; delta <= DRIFT_STEPS; delta++) {
    const step = now + delta;
    const expected = await hotp(secret, step);
    let diff = 0;
    for (let i = 0; i < DIGITS; i++) diff |= expected.charCodeAt(i) ^ cleaned.charCodeAt(i);
    if (diff === 0 && matched === null) matched = step;
  }

  if (matched === null) return { valid: false, step: null };
  if (minStep !== null && matched <= minStep) return { valid: false, step: null };
  return { valid: true, step: matched };
}

/** The otpauth:// URI an authenticator app scans. */
export function otpauthUri(secretBase32: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
