import { ADAPTER_PROTOCOL_VERSION, type AdapterManifest, type Capability } from "./types.ts";

const ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const CAPABILITIES = new Set<Capability>([
  "catalog",
  "metrics",
  "costs",
  "people",
  "actions",
  "mail",
  "infrastructure",
  "health",
]);

export class ManifestError extends Error {}

function strings(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new ManifestError(`${field} must be an array of non-empty strings`);
  }
  return [...new Set(value.map((item) => item.trim()))];
}

export function validateManifest(value: unknown): AdapterManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ManifestError("manifest must be an object");
  }
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== 1) throw new ManifestError("schemaVersion must be 1");
  const id = String(raw.id ?? "");
  if (!ID.test(id)) throw new ManifestError("id must be a lowercase namespaced identifier");
  const name = String(raw.name ?? "").trim();
  if (!name || name.length > 80) throw new ManifestError("name must be 1 to 80 characters");
  const version = String(raw.version ?? "");
  if (!VERSION.test(version)) throw new ManifestError("version must be semantic versioning");
  const entrypoint = String(raw.entrypoint ?? "");
  if (!entrypoint.endsWith(".ts") || entrypoint.startsWith("/") || entrypoint.includes("..")) {
    throw new ManifestError("entrypoint must be a relative TypeScript path inside the package");
  }
  const protocol = String(raw.protocol ?? "");
  if (!protocol) throw new ManifestError("protocol is required");
  const capabilities = strings(raw.capabilities, "capabilities") as Capability[];
  for (const capability of capabilities) {
    if (!CAPABILITIES.has(capability)) throw new ManifestError(`unknown capability: ${capability}`);
  }
  const permissionsRaw = raw.permissions ?? {};
  if (typeof permissionsRaw !== "object" || Array.isArray(permissionsRaw)) {
    throw new ManifestError("permissions must be an object");
  }
  const permissionsObject = permissionsRaw as Record<string, unknown>;
  const allowedPermissionKeys = new Set(["net", "env", "read", "write", "run"]);
  for (const key of Object.keys(permissionsObject)) {
    if (!allowedPermissionKeys.has(key)) throw new ManifestError(`unknown permission: ${key}`);
  }
  const permissions = Object.fromEntries(
    Object.entries(permissionsObject).map((
      [key, list],
    ) => [key, strings(list, `permissions.${key}`)]),
  );
  const manifest: AdapterManifest = {
    schemaVersion: 1,
    id,
    name,
    version,
    entrypoint,
    protocol,
    capabilities,
    permissions,
  };
  if (typeof raw.description === "string") {
    manifest.description = raw.description.trim().slice(0, 500);
  }
  if (raw.configSchema && typeof raw.configSchema === "object") {
    manifest.configSchema = raw.configSchema as Record<string, unknown>;
  }
  return manifest;
}

export function manifestNeedsAcceptance(
  previousDigest: string | null,
  nextDigest: string,
): boolean {
  return previousDigest !== nextDigest;
}

export function protocolCompatible(protocol: string): boolean {
  return protocol.split(".")[0] === ADAPTER_PROTOCOL_VERSION.split(".")[0];
}

export function sourceIsPinned(source: string): boolean {
  if (source.startsWith("./") || source.startsWith("../") || source.startsWith("/")) return true;
  if (/^(?:jsr|npm):.+@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(source)) return true;
  if (/^(?:git\+)?https:\/\/.+#[0-9a-f]{40}$/i.test(source)) return true;
  return false;
}
