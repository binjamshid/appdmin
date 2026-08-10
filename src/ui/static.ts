import type { Context } from "hono";

const ASSETS: Record<string, string> = {
  "app.css": "text/css; charset=utf-8",
  "app.js": "text/javascript; charset=utf-8",
  "login.js": "text/javascript; charset=utf-8",
  "icon.svg": "image/svg+xml",
  "manifest.webmanifest": "application/manifest+json",
};
const cache = new Map<string, { body: Uint8Array; etag: string }>();
const root = new URL("./static/", import.meta.url);

export async function serveStatic(c: Context): Promise<Response> {
  const name = c.req.path.split("/").at(-1) ?? "";
  const type = ASSETS[name];
  if (!type) return c.json({ error: "not_found" }, 404);
  let entry = cache.get(name);
  if (!entry) {
    const body = await Deno.readFile(new URL(name, root));
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", body as BufferSource));
    entry = {
      body,
      etag: `"${
        Array.from(digest.slice(0, 8), (byte) => byte.toString(16).padStart(2, "0")).join("")
      }"`,
    };
    cache.set(name, entry);
  }
  if (c.req.header("if-none-match") === entry.etag) return c.body(null, 304, { ETag: entry.etag });
  return c.body(entry.body as unknown as ArrayBuffer, 200, {
    "Content-Type": type,
    ETag: entry.etag,
    "Cache-Control": "public,max-age=300,must-revalidate",
  });
}
