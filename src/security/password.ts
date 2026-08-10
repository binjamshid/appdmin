import { argon2id, argon2Verify } from "hash-wasm";

// Argon2id parameters. OWASP's floor is m=19 MiB, t=2, p=1; this goes above it because
// the login rate here is a handful per day, so the extra ~100 ms is invisible to the one
// person who signs in and expensive for anyone grinding a stolen hash offline.
//
// The parameters are encoded into the hash string, so raising them later re-hashes
// gradually on next login rather than invalidating anything.
const MEMORY_KIB = 65536; // 64 MiB
const ITERATIONS = 3;
const PARALLELISM = 1;
const HASH_LENGTH = 32;

export async function hashPassword(password: string): Promise<string> {
  return await argon2id({
    password,
    salt: crypto.getRandomValues(new Uint8Array(16)),
    parallelism: PARALLELISM,
    iterations: ITERATIONS,
    memorySize: MEMORY_KIB,
    hashLength: HASH_LENGTH,
    outputType: "encoded",
  });
}

/**
 * Verifies a password. Never throws for a bad password — a malformed or truncated stored
 * hash is a configuration failure, not an authentication decision, and both must come
 * back as a plain `false` so the caller has one code path and no timing tell.
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await argon2Verify({ password, hash });
  } catch {
    return false;
  }
}

/**
 * A dummy verification, run when the submitted username matches no account.
 *
 * Without this, "no such user" returns in microseconds while a real user costs the full
 * Argon2 work factor — which turns the login form into a user-enumeration oracle. Doing
 * the same work for a miss makes the two indistinguishable from outside.
 */
const DUMMY_HASH = await hashPassword(
  "u2vT7#dummy-never-a-real-password-" + crypto.randomUUID(),
);

export async function burnTime(password: string): Promise<void> {
  await verifyPassword(password, DUMMY_HASH);
}

/**
 * Minimum bar for a new password. Length is the only requirement that reliably buys
 * entropy; composition rules mostly push people toward predictable substitutions.
 */
export function validatePasswordStrength(password: string): string | null {
  if (password.length < 14) return "password must be at least 14 characters";
  if (password.length > 1024) return "password must be at most 1024 characters";
  if (/^\s+$/.test(password)) return "password cannot be only whitespace";
  return null;
}
