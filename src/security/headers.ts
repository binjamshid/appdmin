import type { Context, MiddlewareHandler } from "hono";
import { config } from "../config.ts";

/**
 * Content Security Policy.
 *
 * `default-src 'none'` and no `unsafe-inline` anywhere is the reason this dashboard has
 * no build step and no inline `<script>`: every byte of script and style is served from
 * the static asset allowlist, so an injected string can never execute. That constraint shaped the
 * frontend rather than the other way round.
 */
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "manifest-src 'self'",
  "upgrade-insecure-requests",
].join("; ");

export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();

  c.header("Content-Security-Policy", CSP);
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Frame-Options", "DENY");
  c.header("Cross-Origin-Opener-Policy", "same-origin");
  c.header("Cross-Origin-Resource-Policy", "same-origin");
  c.header("Cross-Origin-Embedder-Policy", "require-corp");
  c.header("Strict-Transport-Security", "max-age=31536000");

  // Everything is denied except the two WebAuthn features, which must be explicitly
  // allowed for `self` — a blanket-deny policy silently breaks passkey sign-in, and the
  // browser reports it only as a generic NotAllowedError.
  c.header(
    "Permissions-Policy",
    [
      "publickey-credentials-get=(self)",
      "publickey-credentials-create=(self)",
      "accelerometer=()",
      "camera=()",
      "geolocation=()",
      "gyroscope=()",
      "magnetometer=()",
      "microphone=()",
      "payment=()",
      "usb=()",
      "interest-cohort=()",
    ].join(", "),
  );

  // Static assets are the one thing worth caching; everything else is either a live
  // number or an authenticated view and must never sit in a shared cache.
  if (!c.req.path.includes("/static/")) {
    c.header("Cache-Control", "no-store, no-cache, must-revalidate, private");
    c.header("Pragma", "no-cache");
  }
};

/**
 * The client's real IP.
 *
 * nginx is configured with `set_real_ip_from` over Cloudflare's ranges and
 * `real_ip_header CF-Connecting-IP`, so by the time a request reaches this service
 * `X-Real-IP` already holds the true client address. That is why CF-Connecting-IP is
 * NOT read here: this service is reachable only from loopback, so trusting the one
 * header its own proxy sets is safe, whereas trusting a header a direct-to-origin
 * caller could forge would hand an attacker a free rate-limit bypass.
 */
export function clientIp(c: Context): string | null {
  if (!config.trustProxy) return null;
  const raw = c.req.header("x-real-ip")?.trim();
  if (!raw) return null;
  // Reject anything that is not a bare address, so a malformed value can never reach
  // Postgres as an ::inet cast and error out mid-request.
  return /^[0-9a-fA-F:.]+$/.test(raw) && raw.length <= 45 ? raw : null;
}

export function userAgent(c: Context): string | null {
  const ua = c.req.header("user-agent");
  return ua ? ua.slice(0, 512) : null;
}
