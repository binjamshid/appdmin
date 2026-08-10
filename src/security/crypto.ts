// Small shared primitives. Everything here is Web Crypto underneath — no hand-rolled
// ciphers, hashes or MACs.

import { config } from "../config.ts";

let aesKey: CryptoKey | null = null;

async function key(): Promise<CryptoKey> {
  if (!aesKey) {
    aesKey = await crypto.subtle.importKey(
      "raw",
      config.secretKey as BufferSource,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
  }
  return aesKey;
}

/**
 * AES-256-GCM. The 12-byte nonce is prepended to the ciphertext, which is the standard
 * layout and keeps the stored value a single opaque blob. A fresh random nonce per call
 * is what makes GCM safe here — reuse under the same key would be catastrophic, so it is
 * never derived from anything.
 */
export async function encrypt(plaintext: string): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await key(),
    new TextEncoder().encode(plaintext),
  );
  const out = new Uint8Array(iv.length + ct.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ct), iv.length);
  return out;
}

export async function decrypt(blob: Uint8Array): Promise<string> {
  if (blob.length < 13) throw new Error("ciphertext too short");
  const iv = blob.slice(0, 12);
  const ct = blob.slice(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await key(), ct as BufferSource);
  return new TextDecoder().decode(pt);
}

export async function sha256(input: string | Uint8Array): Promise<Uint8Array> {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
}

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  return toHex(await sha256(input));
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64url(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (ch) => ch.charCodeAt(0));
}

/**
 * Constant-time string comparison. Used wherever a caller-supplied value is compared
 * against a secret — an early return on the first differing byte is a timing oracle that
 * recovers the secret one byte at a time.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  // Length is compared without branching too, by folding it into the accumulator.
  let diff = ab.length ^ bb.length;
  const n = Math.max(ab.length, bb.length);
  for (let i = 0; i < n; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

// ── Base32, for TOTP secrets ────────────────────────────────────────────────────────
// RFC 4648 without padding, which is what authenticator apps expect in otpauth:// URIs.

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Uint8Array {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}
