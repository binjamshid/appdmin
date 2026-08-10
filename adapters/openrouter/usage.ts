import type { Observation } from "../../src/core/types.ts";

export function openRouterUsageObservation(
  body: { data?: { usage?: unknown } },
  adapterInstanceId: string,
  collectedAt = new Date().toISOString(),
): Observation {
  const raw = body.data?.usage;
  const parsed = (typeof raw === "number" || (typeof raw === "string" && raw.trim()))
    ? Number(raw)
    : Number.NaN;
  const value = Number.isFinite(parsed) ? parsed : null;
  return {
    adapterInstanceId,
    metric: "inference.cost",
    value,
    unit: "currency",
    currency: value === null ? undefined : "USD",
    collectedAt,
    quality: value === null ? "unavailable" : "live",
    source: "OpenRouter key",
    sourceUrl: "https://openrouter.ai/settings/keys",
    definition: value === null
      ? "OpenRouter did not return a usable provider usage value for the configured API key."
      : "Provider-reported cumulative usage for the configured API key.",
    authority: "provider",
  };
}
