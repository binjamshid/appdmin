import assert from "node:assert/strict";
import { bundledCatalog } from "./bundled.ts";
import { protocolCompatible } from "../core/manifest.ts";

Deno.test("every bundled adapter has a compatible strict manifest", async () => {
  const catalog = await bundledCatalog();
  assert.equal(catalog.length, 8);
  assert.equal(new Set(catalog.map((entry) => entry.manifest.id)).size, catalog.length);
  for (const entry of catalog) {
    assert.ok(protocolCompatible(entry.manifest.protocol));
    assert.ok(entry.manifest.capabilities.includes("health"));
    assert.match(entry.manifest.version, /^\d+\.\d+\.\d+$/);
  }
});
