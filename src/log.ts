// One structured JSON line per event. journalctl is the only consumer, and the log feed
// panel reads it back out, so the shape has to stay stable and machine-parseable.

type Level = "debug" | "info" | "warn" | "error";

// Field names whose values must never reach the log, whatever the call site passes.
// Belt and braces: nothing here should be logging a secret in the first place, but a
// dashboard that tails its own logs would put any slip straight onto a screen.
const REDACT = new Set([
  "password",
  "token",
  "secret",
  "authorization",
  "cookie",
  "session",
  "csrf",
  "code",
  "challenge",
  "private_key",
  "api_key",
]);

function scrub(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[deep]";
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrub(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = REDACT.has(k.toLowerCase()) ? "[redacted]" : scrub(v, depth + 1);
  }
  return out;
}

function emit(level: Level, message: string, fields?: Record<string, unknown>): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    message,
    ...(fields ? (scrub(fields) as Record<string, unknown>) : {}),
  });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export const log = {
  debug: (m: string, f?: Record<string, unknown>) => emit("debug", m, f),
  info: (m: string, f?: Record<string, unknown>) => emit("info", m, f),
  warn: (m: string, f?: Record<string, unknown>) => emit("warn", m, f),
  error: (m: string, f?: Record<string, unknown>) => emit("error", m, f),
};
