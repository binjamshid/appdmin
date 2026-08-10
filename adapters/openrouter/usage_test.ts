import assert from "node:assert/strict";
import { openRouterUsageObservation } from "./usage.ts";

const instanceId = "11111111-1111-4111-8111-111111111111";
const collectedAt = "2026-08-10T00:00:00.000Z";

Deno.test("OpenRouter preserves an explicit zero usage value", () => {
  const item = openRouterUsageObservation({ data: { usage: 0 } }, instanceId, collectedAt);
  assert.equal(item.value, 0);
  assert.equal(item.quality, "live");
});

Deno.test("OpenRouter missing usage remains unavailable", () => {
  const item = openRouterUsageObservation({ data: {} }, instanceId, collectedAt);
  assert.equal(item.value, null);
  assert.equal(item.quality, "unavailable");
});
