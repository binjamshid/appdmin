import type { AdapterManifest } from "./types.ts";

function flag(name: string, values: string[] | undefined): string[] {
  if (!values?.length) return [];
  if (values.includes("*")) return [`--allow-${name}`];
  return [`--allow-${name}=${values.join(",")}`];
}

export function adapterCommand(
  denoExecutable: string,
  packageRoot: string,
  manifest: AdapterManifest,
): string[] {
  const entrypoint = `${packageRoot.replace(/\/$/, "")}/${manifest.entrypoint}`;
  return [
    denoExecutable,
    "run",
    "--no-prompt",
    "--cached-only",
    ...flag("net", manifest.permissions.net),
    ...flag("env", manifest.permissions.env),
    ...flag("read", manifest.permissions.read),
    ...flag("write", manifest.permissions.write),
    ...flag("run", manifest.permissions.run),
    entrypoint,
  ];
}

/**
 * Preserve only the runtime cache location when spawning an adapter with a clean
 * environment. Deno needs this before it evaluates adapter permissions; application
 * secrets and host configuration must never be inherited by the subprocess.
 */
export function adapterEnvironment(
  environment: Record<string, string | undefined>,
): Record<string, string> {
  const denoDir = environment.DENO_DIR?.trim();
  return denoDir ? { DENO_DIR: denoDir } : {};
}

export function permissionSummary(manifest: AdapterManifest): string[] {
  const p = manifest.permissions;
  const rows: string[] = [];
  if (p.net?.length) rows.push(`Network: ${p.net.join(", ")}`);
  if (p.env?.length) rows.push(`Environment: ${p.env.join(", ")}`);
  if (p.read?.length) rows.push(`Read files: ${p.read.join(", ")}`);
  if (p.write?.length) rows.push(`Write files: ${p.write.join(", ")}`);
  if (p.run?.length) rows.push(`Run programs: ${p.run.join(", ")}`);
  return rows.length ? rows : ["No external permissions"];
}
