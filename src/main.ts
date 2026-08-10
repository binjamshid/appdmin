import { Hono } from "hono";
import { config } from "./config.ts";
import { api } from "./routes/api.ts";
import { auth } from "./routes/auth.ts";
import { pages } from "./routes/pages.ts";
import { serveStatic } from "./ui/static.ts";
import { databaseHealth } from "./db.ts";
import { ingest } from "./routes/ingest.ts";
import { startScheduler } from "./core/scheduler.ts";

export const app = new Hono();
const base = config.basePath === "/" ? "" : config.basePath;

app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Frame-Options", "DENY");
  c.header(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), publickey-credentials-get=(self), publickey-credentials-create=(self)",
  );
  c.header(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
});

app.get(`${base}/health`, (c) => c.json({ ok: true, service: "appdmin" }));
app.get(`${base}/health/db`, async (c) => {
  const health = await databaseHealth();
  return c.json(health, health.ok ? 200 : 503);
});
app.get(`${base}/static/:name`, serveStatic);
app.route(`${base}/v1/ingest`, ingest);
app.route(`${base}/api/auth`, auth);
app.route(`${base}/api`, api);
app.route(base || "/", pages);

app.onError((error, c) => {
  console.error(JSON.stringify({ level: "error", path: c.req.path, message: error.message }));
  return c.json({ error: "internal_error" }, 500);
});

export function serve(): Deno.HttpServer {
  startScheduler();
  return Deno.serve({ port: config.port, hostname: config.hostname }, app.fetch);
}

if (import.meta.main) {
  serve();
}
