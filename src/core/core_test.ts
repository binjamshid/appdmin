import assert from "node:assert/strict";
import { reconcileCatalog } from "./catalog.ts";
import { sourceIsPinned, validateManifest } from "./manifest.ts";
import {
  reconcileProviderAndTelemetry,
  sanitizeTelemetry,
  validateObservation,
} from "./observations.ts";
import { adapterCommand, adapterEnvironment } from "./sandbox.ts";
import { decryptValue, encryptValue, redactSecrets } from "./secrets.ts";
import type { AdapterManifest, CatalogProduct, Observation } from "./types.ts";

const manifest: AdapterManifest = {
  schemaVersion: 1,
  id: "appdmin.test",
  name: "Test adapter",
  version: "1.2.3",
  entrypoint: "main.ts",
  protocol: "1.0",
  capabilities: ["catalog", "metrics"],
  permissions: { net: ["api.example.test:443"], env: ["TEST_TOKEN"] },
};

Deno.test("adapter manifest is strict and production sources must be pinned", () => {
  assert.deepEqual(validateManifest(manifest), manifest);
  assert.throws(() => validateManifest({ ...manifest, permissions: { all: ["true"] } }));
  assert.ok(sourceIsPinned("jsr:@appdmin/openai@1.2.3"));
  assert.ok(
    sourceIsPinned("https://example.test/adapter.git#0123456789012345678901234567890123456789"),
  );
  assert.ok(!sourceIsPinned("jsr:@appdmin/openai"));
  assert.ok(!sourceIsPinned("https://example.test/adapter.git#main"));
});

Deno.test("sandbox command grants only manifest permissions", () => {
  assert.deepEqual(adapterCommand("deno", "/adapters/test", manifest), [
    "deno",
    "run",
    "--no-prompt",
    "--cached-only",
    "--allow-net=api.example.test:443",
    "--allow-env=TEST_TOKEN",
    "/adapters/test/main.ts",
  ]);
  assert.deepEqual(
    adapterEnvironment({ DENO_DIR: "/var/lib/appdmin/deno-cache", PRIVATE_TOKEN: "secret" }),
    { DENO_DIR: "/var/lib/appdmin/deno-cache" },
  );
});

Deno.test("encrypted configuration round-trips and serializers redact it", async () => {
  const key = crypto.getRandomValues(new Uint8Array(32));
  const encrypted = await encryptValue("private-value", key);
  assert.equal(await decryptValue(encrypted, key), "private-value");
  assert.deepEqual(
    redactSecrets({ apiKey: "private-value", error: "token private-value" }, ["private-value"]),
    {
      apiKey: "••••••••",
      error: "token ••••••••",
    },
  );
  assert.deepEqual(
    redactSecrets({ configSchema: { properties: { apiKey: { type: "string", secret: true } } } }),
    { configSchema: { properties: { apiKey: { type: "string", secret: true } } } },
  );
  await assert.rejects(() => decryptValue(encrypted, crypto.getRandomValues(new Uint8Array(32))));
});

Deno.test("catalog discovery preserves owner metadata and marks missing products", () => {
  const existing: CatalogProduct[] = [{
    id: "local-1",
    adapterInstanceId: "asc-1",
    externalId: "source-1",
    name: "Source name",
    displayName: "Owner name",
    kind: "app",
    groupName: "Primary",
    notes: "Important",
    hidden: true,
    firstSeenAt: "2026-01-01T00:00:00Z",
    lastSeenAt: "2026-01-01T00:00:00Z",
    missingSince: null,
  }];
  const next = reconcileCatalog("asc-1", existing, [{
    externalId: "source-2",
    name: "New",
    kind: "app",
  }], "2026-08-10T00:00:00Z");
  assert.equal(next[0].displayName, "New");
  assert.equal(next[1].displayName, "Owner name");
  assert.equal(next[1].groupName, "Primary");
  assert.equal(next[1].missingSince, "2026-08-10T00:00:00Z");
});

function observation(value: number, authority: "provider" | "telemetry"): Observation {
  return {
    adapterInstanceId: authority,
    metric: "inference.cost.usd",
    value,
    unit: "currency",
    currency: "USD",
    collectedAt: "2026-08-10T00:00:00Z",
    quality: "live",
    source: authority,
    definition: "Settled cost",
    authority,
  };
}

Deno.test("provider totals remain authoritative and discrepancies stay visible", () => {
  const result = reconcileProviderAndTelemetry(
    observation(100, "provider"),
    observation(111, "telemetry"),
  );
  assert.equal(result.authoritative?.value, 100);
  assert.equal(result.attribution?.value, 111);
  assert.equal(result.discrepancy, 11);
  assert.ok(result.warning);
});

Deno.test("missing observations cannot masquerade as zero", () => {
  assert.throws(() =>
    validateObservation({ ...observation(0, "provider"), value: null, quality: "live" })
  );
  assert.equal(
    validateObservation({ ...observation(0, "provider"), value: null, quality: "unavailable" })
      .value,
    null,
  );
});

Deno.test("telemetry sanitizer removes inference content recursively", () => {
  assert.deepEqual(
    sanitizeTelemetry({
      model: "example-model",
      prompt: "secret",
      nested: { output_text: "secret", tokens: 4 },
    }),
    {
      model: "example-model",
      nested: { tokens: 4 },
    },
  );
});
