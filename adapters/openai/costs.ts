import type { Observation } from "../../src/core/types.ts";

interface CostResult {
  amount?: { value?: unknown; currency?: unknown };
  line_item?: unknown;
}

interface CostBucket {
  start_time?: unknown;
  end_time?: unknown;
  results?: CostResult[];
}

function numberOrNull(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rounded(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

export function openAICostObservations(
  body: { data?: CostBucket[] },
  adapterInstanceId: string,
  collectedAt = new Date().toISOString(),
): Observation[] {
  const buckets = body.data ?? [];
  const results = buckets.flatMap((bucket) => bucket.results ?? []);
  const totals = new Map<string, number>();
  let incomplete = 0;
  for (const result of results) {
    const value = numberOrNull(result.amount?.value);
    const currency = typeof result.amount?.currency === "string"
      ? result.amount.currency.trim().toUpperCase()
      : "";
    if (value === null || !currency) {
      incomplete++;
      continue;
    }
    totals.set(currency, (totals.get(currency) ?? 0) + value);
  }
  const times = buckets.flatMap((bucket) => [
    numberOrNull(bucket.start_time),
    numberOrNull(bucket.end_time),
  ]).filter((value): value is number => value !== null);
  const intervalStart = times.length
    ? new Date(Math.min(...times) * 1000).toISOString()
    : undefined;
  const intervalEnd = times.length ? new Date(Math.max(...times) * 1000).toISOString() : undefined;
  const common = {
    adapterInstanceId,
    metric: "inference.cost",
    unit: "currency",
    collectedAt,
    intervalStart,
    intervalEnd,
    source: "OpenAI organization costs",
    sourceUrl: "https://platform.openai.com/usage",
    authority: "provider" as const,
  };
  if (!results.length) {
    return [{
      ...common,
      value: 0,
      currency: "USD",
      quality: "delayed",
      definition: "Provider-reported organization cost total for the requested period.",
      notes: ["The provider returned no cost line items for the requested period."],
    }];
  }
  if (!totals.size) {
    return [{
      ...common,
      value: null,
      quality: "unavailable",
      definition: "OpenAI returned cost line items without a usable amount and currency.",
      notes: [`${incomplete} line item${incomplete === 1 ? " was" : "s were"} incomplete.`],
    }];
  }
  return [...totals.entries()].sort(([left], [right]) => left.localeCompare(right)).map(
    ([currency, total]): Observation => ({
      ...common,
      value: rounded(total),
      currency,
      quality: incomplete ? "partial" : "delayed",
      definition:
        "Provider-reported organization cost total, aggregated from OpenAI cost line items for the requested period.",
      notes: incomplete
        ? [
          `Excluded ${incomplete} line item${
            incomplete === 1 ? "" : "s"
          } without an amount or currency.`,
        ]
        : [],
      providerRecordId: `organization-costs:${intervalStart ?? "unknown"}:${
        intervalEnd ?? "unknown"
      }:${currency}`,
    }),
  );
}
