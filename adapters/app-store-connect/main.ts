import type { Observation } from "../../src/core/types.ts";
import { jsonRequest, required, serveAdapter } from "../_shared/runtime.ts";
import { downloadSalesReport, observationsFromSalesReport } from "./sales.ts";

let configuration: Record<string, unknown> = {};
let cachedReport: { value: string | null; fetchedAt: number } | null = null;
const bytes = (value: string) => new TextEncoder().encode(value);
const b64url = (value: Uint8Array) => {
  let raw = "";
  for (const byte of value) raw += String.fromCharCode(byte);
  return btoa(raw).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};

async function token(): Promise<string> {
  const pem = required(configuration, "privateKey");
  const der = Uint8Array.from(
    atob(pem.replace(/-----[^-]+-----|\s/g, "")),
    (character) => character.charCodeAt(0),
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    der as BufferSource,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(
    bytes(JSON.stringify({ alg: "ES256", kid: required(configuration, "keyId"), typ: "JWT" })),
  );
  const payload = b64url(
    bytes(
      JSON.stringify({
        iss: required(configuration, "issuerId"),
        iat: now,
        exp: now + 15 * 60,
        aud: "appstoreconnect-v1",
      }),
    ),
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      bytes(`${header}.${payload}`),
    ),
  );
  return `${header}.${payload}.${b64url(signature)}`;
}

async function apps() {
  return await jsonRequest("https://api.appstoreconnect.apple.com/v1/apps?limit=200", {
    headers: { authorization: `Bearer ${await token()}` },
  }) as {
    data?: Array<{ id: string; attributes?: { name?: string; bundleId?: string; sku?: string } }>;
  };
}

async function salesReport(): Promise<string | null> {
  const vendorNumber = String(configuration.vendorNumber ?? "").trim();
  if (!vendorNumber) return null;
  if (cachedReport && Date.now() - cachedReport.fetchedAt < 60_000) return cachedReport.value;
  const value = await downloadSalesReport(await token(), vendorNumber);
  cachedReport = { value, fetchedAt: Date.now() };
  return value;
}

function unavailable(method: string, instanceId: string, reason: string): Observation[] {
  return [{
    adapterInstanceId: instanceId,
    metric: method === "costs.collect" ? "store.estimated_proceeds" : "store.reported_units",
    value: null,
    unit: method === "costs.collect" ? "currency" : "units",
    collectedAt: new Date().toISOString(),
    quality: "unavailable",
    source: "App Store Connect Sales and Trends",
    sourceUrl: "https://appstoreconnect.apple.com/trends/reports",
    definition: reason,
    authority: "provider",
    timezone: "America/Los_Angeles",
  }];
}

void serveAdapter(async (method, params) => {
  if (method === "initialize") {
    configuration = (params.configuration as Record<string, unknown>) ?? {};
    cachedReport = null;
    return { protocol: "1.0", capabilities: ["catalog", "metrics", "costs", "health"] };
  }
  if (method === "shutdown") return { ok: true };
  if (method === "configure.validate" || method === "health.check") {
    await apps();
    return { ok: true, message: "App Store Connect is reachable." };
  }
  if (method === "catalog.discover") {
    const body = await apps();
    return (body.data ?? []).map((app) => ({
      externalId: app.id,
      name: app.attributes?.name ?? app.attributes?.bundleId ?? app.id,
      kind: "app",
      platform: "Apple",
      sourceUrl: `https://appstoreconnect.apple.com/apps/${app.id}`,
      metadata: { bundleId: app.attributes?.bundleId, sku: app.attributes?.sku },
    }));
  }
  if (method === "metrics.collect" || method === "costs.collect") {
    const instanceId = String(params.instanceId ?? "appdmin.app-store-connect");
    if (!String(configuration.vendorNumber ?? "").trim()) {
      return unavailable(
        method,
        instanceId,
        "Add the optional vendor number to enable Apple's daily Summary Sales Report.",
      );
    }
    const report = await salesReport();
    if (report === null) {
      return unavailable(
        method,
        instanceId,
        "Apple has not made a daily Summary Sales Report available for the current report window.",
      );
    }
    const observations = observationsFromSalesReport(report, instanceId);
    return method === "costs.collect" ? observations.costs : observations.metrics;
  }
  throw new Error(`Unsupported method: ${method}`);
});
