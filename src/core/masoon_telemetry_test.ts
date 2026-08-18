import { strict as assert } from "node:assert";
import { validateMasoonTelemetry } from "./masoon_telemetry.ts";

const valid = {
  source: "Masoon first-party anonymous daily aggregates",
  suppression_threshold: 20,
  raw_retention_days: 7,
  aggregate_retention_days: 90,
  rows: [{ day: "2026-08-18", release: "2.1", build: "13", metric: "app_launch", count: 20 }],
};

Deno.test("Masoon telemetry accepts only thresholded aggregate rows", () => {
  const result = validateMasoonTelemetry(valid);
  assert.equal(result.rows[0].count, 20);
  assert.equal(result.suppressionThreshold, 20);
});

Deno.test("Masoon telemetry rejects low volume, identifiers, and unknown metrics", () => {
  for (
    const candidate of [
      { ...valid, rows: [{ ...valid.rows[0], count: 19 }] },
      { ...valid, rows: [{ ...valid.rows[0], account_id: "person", count: 20 }] },
      { ...valid, rows: [{ ...valid.rows[0], metric: "ayah_opened", count: 20 }] },
    ]
  ) assert.throws(() => validateMasoonTelemetry(candidate));
});
