import { config } from "../config.ts";
import { sourceIsPinned, validateManifest } from "../core/manifest.ts";
import { sha256Hex } from "../security/crypto.ts";
import type { AdapterManifest } from "../core/types.ts";
import { bundledAdapter } from "./bundled.ts";

export interface ResolvedAdapterPackage {
  source: string;
  root: string;
  manifest: AdapterManifest;
  digest: string;
}

async function digestDirectory(root: string, manifest: AdapterManifest): Promise<string> {
  const chunks: string[] = [];
  async function visit(path: string, prefix = "") {
    const entries = [];
    for await (const entry of Deno.readDir(path)) entries.push(entry);
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const full = `${path}/${entry.name}`;
      const relative = `${prefix}${entry.name}`;
      if (entry.isDirectory) await visit(full, `${relative}/`);
      else if (entry.isFile) chunks.push(`${relative}\0${await Deno.readTextFile(full)}\0`);
    }
  }
  await visit(root);
  return await sha256Hex(`${JSON.stringify(manifest)}\0${chunks.join("")}`);
}

async function localPackage(
  source: string,
  originalSource = source,
): Promise<ResolvedAdapterPackage> {
  const root = await Deno.realPath(source);
  const manifest = validateManifest(
    JSON.parse(await Deno.readTextFile(`${root}/appdmin.adapter.json`)),
  );
  await Deno.stat(`${root}/${manifest.entrypoint}`);
  return { source: originalSource, root, manifest, digest: await digestDirectory(root, manifest) };
}

async function cacheEntrypoint(pkg: ResolvedAdapterPackage): Promise<ResolvedAdapterPackage> {
  await run(config.denoExecutable, [
    "cache",
    `${pkg.root.replace(/\/$/, "")}/${pkg.manifest.entrypoint}`,
  ]);
  return pkg;
}

async function run(command: string, args: string[]): Promise<void> {
  const output = await new Deno.Command(command, {
    args,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(new TextDecoder().decode(output.stderr).trim() || `${command} failed`);
  }
}

export async function resolveAdapterSource(source: string): Promise<ResolvedAdapterPackage> {
  if (source.startsWith("bundled:")) {
    const pkg = await bundledAdapter(source.slice("bundled:".length));
    return { source, ...pkg, digest: await digestDirectory(pkg.root, pkg.manifest) };
  }
  if (!sourceIsPinned(source)) {
    throw new Error("Adapter source must be local or pinned to an immutable version or commit.");
  }
  if (source.startsWith("./") || source.startsWith("../") || source.startsWith("/")) {
    return await cacheEntrypoint(await localPackage(source));
  }
  if (source.startsWith("jsr:") || source.startsWith("npm:")) {
    const manifestModule = await import(`${source}/appdmin.adapter.json`, {
      with: { type: "json" },
    });
    const manifest = validateManifest(manifestModule.default);
    await run(config.denoExecutable, ["cache", `${source}/${manifest.entrypoint}`]);
    return { source, root: source, manifest, digest: await sha256Hex(JSON.stringify(manifest)) };
  }
  const match = source.match(/^((?:git\+)?https:\/\/.+)#([0-9a-f]{40})$/i);
  if (!match) throw new Error("Unsupported adapter source.");
  const repository = match[1].replace(/^git\+/, "");
  const commit = match[2].toLowerCase();
  const root = `${config.adapterRoot.replace(/\/$/, "")}/community/${commit}`;
  try {
    await Deno.stat(root);
  } catch {
    await Deno.mkdir(`${config.adapterRoot.replace(/\/$/, "")}/community`, { recursive: true });
    await run("git", ["clone", "--no-checkout", repository, root]);
    await run("git", ["-C", root, "checkout", "--detach", commit]);
  }
  const resolved = await cacheEntrypoint(await localPackage(root, source));
  const output = await new Deno.Command("git", {
    args: ["-C", root, "rev-parse", "HEAD"],
    stdout: "piped",
  }).output();
  const head = new TextDecoder().decode(output.stdout).trim();
  if (head !== commit) throw new Error("Resolved Git adapter does not match the pinned commit.");
  return resolved;
}
