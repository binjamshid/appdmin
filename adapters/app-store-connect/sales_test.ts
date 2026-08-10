import assert from "node:assert/strict";
import { decodeSalesReport, observationsFromSalesReport, parseSalesReport } from "./sales.ts";

const report = [
  "Title\tProduct Type Identifier\tUnits\tDeveloper Proceeds\tBegin Date\tEnd Date\tCurrency of Proceeds\tApple Identifier",
  "Example App\t1F\t3\t0.70\t08/08/2026\t08/08/2026\tUSD\t123456789",
  "Example App\t1F\t-1\t0.70\t08/08/2026\t08/08/2026\tUSD\t123456789",
  "Example IAP\tIA1\t2\t0.50\t08/08/2026\t08/08/2026\tEUR\t123456789",
  "",
].join("\r\n");

Deno.test("Sales and Trends TSV parser keeps Apple's named fields", () => {
  const rows = parseSalesReport(report);
  assert.equal(rows.length, 3);
  assert.equal(rows[0]["Apple Identifier"], "123456789");
  assert.equal(rows[0]["Developer Proceeds"], "0.70");
});

Deno.test("Sales and Trends observations preserve currency and refund signs", () => {
  const { metrics, costs } = observationsFromSalesReport(
    report,
    "11111111-1111-4111-8111-111111111111",
    "2026-08-10T00:00:00.000Z",
  );
  assert.equal(metrics.length, 1);
  assert.equal(metrics[0].metric, "store.reported_units");
  assert.equal(metrics[0].value, 4);
  assert.deepEqual(
    costs.map((item) => [item.currency, item.value]),
    [["EUR", 1], ["USD", 1.4]],
  );
  assert.equal(costs[0].quality, "delayed");
  assert.equal(costs[0].authority, "provider");
});

Deno.test("a valid empty report is an authoritative zero, not missing data", () => {
  const { metrics, costs } = observationsFromSalesReport(
    report.split("\r\n")[0],
    "11111111-1111-4111-8111-111111111111",
    "2026-08-10T00:00:00.000Z",
  );
  assert.equal(metrics[0].value, 0);
  assert.deepEqual(costs, []);
});

Deno.test("Apple gzip report bodies are decoded before parsing", async () => {
  const compressed = new Blob([report]).stream().pipeThrough(new CompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(compressed).arrayBuffer());
  assert.equal(await decodeSalesReport(bytes), report);
});
