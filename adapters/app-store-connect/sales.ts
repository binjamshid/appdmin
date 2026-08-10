import type { Observation } from "../../src/core/types.ts";

export type SalesReportRow = Record<string, string>;

export function parseSalesReport(report: string): SalesReportRow[] {
  const lines = report.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.length > 0);
  if (!lines.length) return [];
  const headers = lines[0].split("\t").map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const values = line.split("\t");
    return Object.fromEntries(
      headers.map((header, index) => [header, values[index]?.trim() ?? ""]),
    );
  });
}

function finiteNumber(value: string | undefined): number {
  const parsed = Number(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function rounded(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

export function observationsFromSalesReport(
  report: string,
  adapterInstanceId: string,
  collectedAt = new Date().toISOString(),
): { metrics: Observation[]; costs: Observation[] } {
  const rows = parseSalesReport(report);
  const reportDates = [...new Set(rows.flatMap((row) => [row["Begin Date"], row["End Date"]]))]
    .filter(Boolean);
  const notes = [
    `Aggregated from ${rows.length} row${
      rows.length === 1 ? "" : "s"
    } in Apple's daily Summary Sales Report.`,
    ...(reportDates.length ? [`Report dates: ${reportDates.join(" to ")}.`] : []),
  ];
  const units = rounded(rows.reduce((sum, row) => sum + finiteNumber(row.Units), 0));
  const byCurrency = new Map<string, number>();
  for (const row of rows) {
    const currency = row["Currency of Proceeds"]?.toUpperCase();
    if (!currency) continue;
    const proceeds = finiteNumber(row.Units) * finiteNumber(row["Developer Proceeds"]);
    byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + proceeds);
  }
  const common = {
    adapterInstanceId,
    collectedAt,
    quality: "delayed" as const,
    source: "App Store Connect Sales and Trends",
    sourceUrl: "https://appstoreconnect.apple.com/trends/reports",
    authority: "provider" as const,
    timezone: "America/Los_Angeles",
    notes,
  };
  return {
    metrics: [{
      ...common,
      metric: "store.reported_units",
      value: units,
      unit: "units",
      definition:
        "Aggregated units in Apple's daily Summary Sales Report, including the report's transaction types and signed refunds.",
      providerRecordId: `sales-daily:units:${reportDates.join(":") || collectedAt.slice(0, 10)}`,
    }],
    costs: [...byCurrency.entries()].sort(([left], [right]) => left.localeCompare(right)).map(
      ([currency, value]): Observation => ({
        ...common,
        metric: "store.estimated_proceeds",
        value: rounded(value),
        unit: "currency",
        currency,
        definition:
          "Estimated developer proceeds from Apple's daily Summary Sales Report: signed units multiplied by developer proceeds per unit.",
        providerRecordId: `sales-daily:proceeds:${currency}:${
          reportDates.join(":") || collectedAt.slice(0, 10)
        }`,
      }),
    ),
  };
}

export async function decodeSalesReport(bytes: Uint8Array): Promise<string> {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return new TextDecoder().decode(bytes);
  const compressed = new Blob([Uint8Array.from(bytes).buffer]).stream();
  return await new Response(compressed.pipeThrough(new DecompressionStream("gzip"))).text();
}

export async function downloadSalesReport(
  authorization: string,
  vendorNumber: string,
): Promise<string | null> {
  const query = new URLSearchParams({
    "filter[frequency]": "DAILY",
    "filter[reportSubType]": "SUMMARY",
    "filter[reportType]": "SALES",
    "filter[vendorNumber]": vendorNumber,
    "filter[version]": "1_0",
  });
  const response = await fetch(`https://api.appstoreconnect.apple.com/v1/salesReports?${query}`, {
    headers: { authorization: `Bearer ${authorization}` },
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    const retry = response.headers.get("retry-after");
    throw new Error(
      `Sales report request failed (${response.status})${retry ? `; retry after ${retry}s` : ""}.`,
    );
  }
  return await decodeSalesReport(new Uint8Array(await response.arrayBuffer()));
}
