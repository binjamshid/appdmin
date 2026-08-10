import { databaseHealth } from "../db.ts";
import { config } from "../config.ts";
import { bundledCatalog } from "../adapters/bundled.ts";

export async function doctor(): Promise<boolean> {
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
  const database = await databaseHealth();
  checks.push({
    name: "Database",
    ok: database.ok,
    detail: database.ok ? `${database.latencyMs} ms` : database.error ?? "Unavailable",
  });
  checks.push({
    name: "Master key",
    ok: config.secretKey.length === 32,
    detail: "32-byte AES key",
  });
  checks.push({
    name: "Public origin",
    ok: ["http:", "https:"].includes(new URL(config.origin).protocol),
    detail: config.origin,
  });
  try {
    const status = await new Deno.Command(config.denoExecutable, {
      args: ["--version"],
      stdout: "null",
      stderr: "null",
    }).output();
    checks.push({ name: "Adapter runtime", ok: status.success, detail: config.denoExecutable });
  } catch (error) {
    checks.push({
      name: "Adapter runtime",
      ok: false,
      detail: error instanceof Error ? error.message : "Not executable",
    });
  }
  try {
    checks.push({
      name: "Bundled adapters",
      ok: (await bundledCatalog()).length >= 6,
      detail: `${(await bundledCatalog()).length} manifests valid`,
    });
  } catch (error) {
    checks.push({
      name: "Bundled adapters",
      ok: false,
      detail: error instanceof Error ? error.message : "Invalid manifest",
    });
  }
  console.log("\nAppdmin doctor\n");
  for (const check of checks) {
    console.log(`${check.ok ? "✓" : "✗"} ${check.name.padEnd(18)} ${check.detail}`);
  }
  const ok = checks.every((check) => check.ok);
  console.log(ok ? "\nAll required checks passed." : "\nOne or more required checks failed.");
  return ok;
}
