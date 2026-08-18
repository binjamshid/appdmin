import { validateManifest } from "../core/manifest.ts";
import type { AdapterManifest } from "../core/types.ts";

export const BUNDLED_ADAPTERS = [
  "app-store-connect",
  "openai",
  "anthropic",
  "gemini",
  "openrouter",
  "openai-compatible",
  "opentelemetry",
  "masoon-telemetry",
] as const;

export async function bundledAdapter(
  name: string,
): Promise<{ root: string; manifest: AdapterManifest }> {
  if (!(BUNDLED_ADAPTERS as readonly string[]).includes(name)) {
    throw new Error(`unknown bundled adapter: ${name}`);
  }
  const rootUrl = new URL(`../../adapters/${name}/`, import.meta.url);
  const raw = JSON.parse(await Deno.readTextFile(new URL("appdmin.adapter.json", rootUrl)));
  return { root: rootUrl.pathname.replace(/\/$/, ""), manifest: validateManifest(raw) };
}

export async function bundledCatalog() {
  return await Promise.all(BUNDLED_ADAPTERS.map(async (name) => {
    const pkg = await bundledAdapter(name);
    return { slug: name, manifest: pkg.manifest, source: `bundled:${name}` };
  }));
}
