export interface MasoonTelemetryRow {
  day: string;
  release: string;
  build: string;
  metric: string;
  count: number;
}

export interface MasoonTelemetrySnapshot {
  source: string;
  suppressionThreshold: 20;
  rawRetentionDays: 7;
  aggregateRetentionDays: 90;
  rows: MasoonTelemetryRow[];
}

const METRICS = new Set([
  "app_launch",
  "tab_opened",
  "mushaf_opened",
  "audio_download_succeeded",
  "audio_download_failed",
  "reference_download_succeeded",
  "reference_download_failed",
  "share_completed",
]);

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

export function validateMasoonTelemetry(value: unknown): MasoonTelemetrySnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid telemetry snapshot");
  }
  const body = value as Record<string, unknown>;
  if (
    !exactKeys(body, [
      "source",
      "suppression_threshold",
      "raw_retention_days",
      "aggregate_retention_days",
      "rows",
    ])
  ) throw new Error("unexpected telemetry field");
  if (
    body.source !== "Masoon first-party anonymous daily aggregates" ||
    body.suppression_threshold !== 20 || body.raw_retention_days !== 7 ||
    body.aggregate_retention_days !== 90 || !Array.isArray(body.rows) || body.rows.length > 1_000
  ) {
    throw new Error("invalid telemetry contract");
  }
  const rows = body.rows.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("invalid telemetry row");
    }
    const row = item as Record<string, unknown>;
    if (
      !exactKeys(row, ["day", "release", "build", "metric", "count"]) ||
      typeof row.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.day) ||
      typeof row.release !== "string" || !/^[0-9A-Za-z][0-9A-Za-z._+-]{0,31}$/.test(row.release) ||
      typeof row.build !== "string" || !/^[0-9A-Za-z][0-9A-Za-z._+-]{0,31}$/.test(row.build) ||
      typeof row.metric !== "string" || !METRICS.has(row.metric) ||
      !Number.isSafeInteger(row.count) || (row.count as number) < 20
    ) {
      throw new Error("invalid or unsuppressed telemetry row");
    }
    return row as unknown as MasoonTelemetryRow;
  });
  return {
    source: body.source,
    suppressionThreshold: 20,
    rawRetentionDays: 7,
    aggregateRetentionDays: 90,
    rows,
  };
}
