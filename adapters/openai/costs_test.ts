import assert from "node:assert/strict";
import { openAICostObservations } from "./costs.ts";

const instanceId = "11111111-1111-4111-8111-111111111111";
const collectedAt = "2026-08-10T00:00:00.000Z";

Deno.test("OpenAI cost line items aggregate into a provider total per currency", () => {
  const observations = openAICostObservations(
    {
      data: [{
        start_time: 1_786_291_200,
        end_time: 1_786_377_600,
        results: [
          { amount: { value: 0.4, currency: "usd" }, line_item: "model-a" },
          { amount: { value: 0.6, currency: "usd" }, line_item: "model-b" },
        ],
      }],
    },
    instanceId,
    collectedAt,
  );
  assert.equal(observations.length, 1);
  assert.equal(observations[0].value, 1);
  assert.equal(observations[0].currency, "USD");
  assert.equal(observations[0].quality, "delayed");
});

Deno.test("missing OpenAI amounts remain unavailable instead of becoming zero", () => {
  const observations = openAICostObservations(
    {
      data: [{ start_time: 1, end_time: 2, results: [{ line_item: "unknown" }] }],
    },
    instanceId,
    collectedAt,
  );
  assert.equal(observations[0].value, null);
  assert.equal(observations[0].quality, "unavailable");
});

Deno.test("an explicit empty OpenAI cost result is an authoritative zero", () => {
  const observations = openAICostObservations({ data: [] }, instanceId, collectedAt);
  assert.equal(observations[0].value, 0);
  assert.equal(observations[0].currency, "USD");
});
