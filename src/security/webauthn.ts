// WebAuthn — the preferred second factor.
//
// A passkey assertion is bound by the browser to the origin that requested it, so a
// convincing lookalike login page cannot obtain one. That is the whole reason this is the
// primary second factor and TOTP is only the fallback: a phished password plus a phished
// six-digit code is a complete login, a phished password plus no assertion is not.

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { config } from "../config.ts";
import { sql } from "../db.ts";
import { log } from "../log.ts";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export interface StoredCredential {
  id: string;
  account_id: string;
  public_key: Uint8Array;
  counter: string;
  transports: string[];
  nickname: string | null;
  device_type: string | null;
  backed_up: boolean;
  created_at: Date;
  last_used_at: Date | null;
}

async function storeChallenge(
  accountId: string | null,
  challenge: string,
  purpose: "registration" | "authentication",
): Promise<void> {
  await sql`
    insert into webauthn_challenges (account_id, challenge, purpose, expires_at)
    values (${accountId}, ${challenge}, ${purpose}, ${new Date(Date.now() + CHALLENGE_TTL_MS)})
  `;
}

/**
 * Claims a challenge, deleting it in the same statement.
 *
 * The delete is what makes a challenge single-use, and doing it in the returning-delete
 * means two concurrent requests cannot both claim the same one.
 */
async function claimChallenge(
  accountId: string | null,
  challenge: string,
  purpose: "registration" | "authentication",
): Promise<boolean> {
  const rows = await sql`
    delete from webauthn_challenges
     where challenge = ${challenge}
       and purpose = ${purpose}
       and expires_at > now()
       and account_id is not distinct from ${accountId}
    returning id
  `;
  return rows.length > 0;
}

/** Opportunistic cleanup of expired challenges; cheap and keeps the table bounded. */
export async function pruneChallenges(): Promise<void> {
  await sql`delete from webauthn_challenges where expires_at < now() - interval '1 hour'`;
}

export async function credentialsFor(accountId: string): Promise<StoredCredential[]> {
  return await sql<StoredCredential[]>`
    select id, account_id, public_key, counter::text as counter, transports,
           nickname, device_type, backed_up, created_at, last_used_at
      from webauthn_credentials
     where account_id = ${accountId}
     order by created_at
  `;
}

// ── Registration ────────────────────────────────────────────────────────────────────

export async function startRegistration(accountId: string, username: string) {
  const existing = await credentialsFor(accountId);

  const options = await generateRegistrationOptions({
    rpName: config.rpName,
    rpID: config.rpId,
    // The user handle must be an opaque byte string, not the username — it is stored on
    // the authenticator and syncs to the user's other devices.
    userID: new TextEncoder().encode(accountId),
    userName: username,
    userDisplayName: username,
    attestationType: "none",
    // Prevents silently registering a second credential on an authenticator that already
    // holds one for this account, which would leave an orphan the user cannot see.
    excludeCredentials: existing.map((c) => ({
      id: c.id,
      transports: c.transports as AuthenticatorTransportFuture[],
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      // Required, not preferred: user verification is what makes this a *second* factor
      // rather than mere possession of an unlocked phone.
      userVerification: "required",
    },
  });

  await storeChallenge(accountId, options.challenge, "registration");
  return options;
}

export async function finishRegistration(
  accountId: string,
  response: Record<string, unknown>,
  nickname: string | null,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const challenge = extractChallenge(response);
  if (!challenge) return { ok: false, error: "missing client data" };
  if (!(await claimChallenge(accountId, challenge, "registration"))) {
    return { ok: false, error: "challenge expired or already used" };
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      // deno-lint-ignore no-explicit-any
      response: response as any,
      expectedChallenge: challenge,
      expectedOrigin: config.origin,
      expectedRPID: config.rpId,
      requireUserVerification: true,
    });
  } catch (err) {
    log.warn("webauthn registration failed", { error: (err as Error).message });
    return { ok: false, error: (err as Error).message };
  }

  if (!verification.verified || !verification.registrationInfo) {
    return { ok: false, error: "registration not verified" };
  }

  const info = verification.registrationInfo;
  await sql`
    insert into webauthn_credentials
      (id, account_id, public_key, counter, transports, device_type, backed_up, nickname)
    values (
      ${info.credential.id},
      ${accountId},
      ${info.credential.publicKey},
      ${info.credential.counter},
      ${info.credential.transports ?? []},
      ${info.credentialDeviceType},
      ${info.credentialBackedUp},
      ${nickname}
    )
    on conflict (id) do nothing
  `;

  return { ok: true, id: info.credential.id };
}

// ── Authentication ──────────────────────────────────────────────────────────────────

export async function startAuthentication(accountId: string) {
  const creds = await credentialsFor(accountId);
  if (creds.length === 0) return null;

  const options = await generateAuthenticationOptions({
    rpID: config.rpId,
    allowCredentials: creds.map((c) => ({
      id: c.id,
      transports: c.transports as AuthenticatorTransportFuture[],
    })),
    userVerification: "required",
  });

  await storeChallenge(accountId, options.challenge, "authentication");
  return options;
}

export async function finishAuthentication(
  accountId: string,
  response: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const challenge = extractChallenge(response);
  if (!challenge) return { ok: false, error: "missing client data" };
  if (!(await claimChallenge(accountId, challenge, "authentication"))) {
    return { ok: false, error: "challenge expired or already used" };
  }

  const credId = typeof response.id === "string" ? response.id : "";
  const [cred] = await sql<StoredCredential[]>`
    select id, account_id, public_key, counter::text as counter, transports,
           nickname, device_type, backed_up, created_at, last_used_at
      from webauthn_credentials
     where id = ${credId} and account_id = ${accountId}
  `;
  if (!cred) return { ok: false, error: "unknown credential" };

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      // deno-lint-ignore no-explicit-any
      response: response as any,
      expectedChallenge: challenge,
      expectedOrigin: config.origin,
      expectedRPID: config.rpId,
      credential: {
        id: cred.id,
        // Re-wrapped so the view is backed by a plain ArrayBuffer: postgres.js hands back
        // a Uint8Array whose buffer type is wider than the library's signature accepts.
        publicKey: new Uint8Array(cred.public_key),
        counter: Number(cred.counter),
        transports: cred.transports as AuthenticatorTransportFuture[],
      },
      requireUserVerification: true,
    });
  } catch (err) {
    log.warn("webauthn authentication failed", { error: (err as Error).message });
    return { ok: false, error: (err as Error).message };
  }

  if (!verification.verified) return { ok: false, error: "assertion not verified" };

  const newCounter = verification.authenticationInfo.newCounter;
  // A counter that fails to advance is the spec's clone signal — but only when the
  // authenticator uses counters at all. Passkeys synced through iCloud or a password
  // manager legitimately report 0 forever, so a 0 counter is normal and only a
  // non-zero counter going backwards is evidence of anything.
  if (newCounter > 0 && newCounter <= Number(cred.counter)) {
    log.error("webauthn counter did not advance — possible cloned authenticator", {
      credential_id: cred.id,
      stored: cred.counter,
      presented: newCounter,
    });
    return { ok: false, error: "authenticator counter regression" };
  }

  await sql`
    update webauthn_credentials
       set counter = ${newCounter}, last_used_at = now()
     where id = ${cred.id}
  `;
  return { ok: true };
}

// ── Helpers ─────────────────────────────────────────────────────────────────────────

type AuthenticatorTransportFuture =
  | "ble"
  | "cable"
  | "hybrid"
  | "internal"
  | "nfc"
  | "smart-card"
  | "usb";

/**
 * Reads the challenge back out of the client data the browser signed.
 *
 * The value is only used to *look up* the stored challenge; it is never trusted as the
 * expected value. SimpleWebAuthn re-checks it against `expectedChallenge` inside the
 * signature verification, so a forged clientDataJSON fails there.
 */
function extractChallenge(response: Record<string, unknown>): string | null {
  const res = response.response as Record<string, unknown> | undefined;
  const clientDataB64 = typeof res?.clientDataJSON === "string" ? res.clientDataJSON : null;
  if (!clientDataB64) return null;
  try {
    const padded = clientDataB64.replace(/-/g, "+").replace(/_/g, "/") +
      "=".repeat((4 - (clientDataB64.length % 4)) % 4);
    const json = JSON.parse(atob(padded)) as { challenge?: string };
    return typeof json.challenge === "string" ? json.challenge : null;
  } catch {
    return null;
  }
}
