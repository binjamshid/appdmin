function required(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`missing required environment variable ${name}`);
  return value;
}

function optional(name: string, fallback: string): string {
  return Deno.env.get(name)?.trim() || fallback;
}

function positiveNumber(name: string, fallback: number): number {
  const raw = Deno.env.get(name)?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return value;
}

function secretKey(): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(
      atob(required("APPDMIN_SECRET_KEY")),
      (character) => character.charCodeAt(0),
    );
  } catch {
    throw new Error("APPDMIN_SECRET_KEY must be base64");
  }
  if (bytes.length !== 32) throw new Error("APPDMIN_SECRET_KEY must decode to exactly 32 bytes");
  return bytes;
}

const origin = required("APPDMIN_ORIGIN").replace(/\/+$/, "");
const originUrl = new URL(origin);
const configuredPath = optional(
  "APPDMIN_BASE_PATH",
  originUrl.pathname === "/" ? "/" : originUrl.pathname,
);
const basePath = configuredPath === "/" ? "/" : `/${configuredPath.replace(/^\/+|\/+$/g, "")}`;

export const config = {
  databaseUrl: required("DATABASE_URL"),
  secretKey: secretKey(),
  origin,
  basePath,
  port: positiveNumber("APPDMIN_PORT", 8787),
  hostname: optional("APPDMIN_HOST", "127.0.0.1"),
  rpId: optional("APPDMIN_RP_ID", originUrl.hostname),
  rpName: optional("APPDMIN_RP_NAME", "Appdmin"),
  trustProxy: optional("APPDMIN_TRUST_PROXY", "false") === "true",
  adapterRoot: optional("APPDMIN_ADAPTER_ROOT", "./.appdmin/adapters"),
  denoExecutable: optional("APPDMIN_DENO", Deno.execPath()),
  sourceUrl: optional("APPDMIN_SOURCE_URL", "https://github.com/Ajraba04/appdmin"),
  collectionMinutes: positiveNumber("APPDMIN_COLLECTION_MINUTES", 15),
  session: {
    idleMinutes: positiveNumber("APPDMIN_SESSION_IDLE_MINUTES", 30),
    absoluteHours: positiveNumber("APPDMIN_SESSION_ABSOLUTE_HOURS", 12),
    stepUpMinutes: positiveNumber("APPDMIN_STEPUP_MINUTES", 10),
  },
  rateLimit: {
    accountMaxFails: positiveNumber("APPDMIN_ACCOUNT_MAX_FAILURES", 8),
    accountWindowMinutes: positiveNumber("APPDMIN_ACCOUNT_FAILURE_WINDOW_MINUTES", 15),
    ipMaxFails: positiveNumber("APPDMIN_IP_MAX_FAILURES", 30),
    ipWindowMinutes: positiveNumber("APPDMIN_IP_FAILURE_WINDOW_MINUTES", 15),
  },
};
