import type { Observation } from "./types.ts";

export function validateObservation(observation: Observation): Observation {
  if (!/^[a-z][a-z0-9_.-]+$/.test(observation.metric)) throw new Error("invalid metric key");
  if (!observation.source.trim()) throw new Error("observation source is required");
  if (!observation.definition.trim()) throw new Error("observation definition is required");
  if (observation.value === null && !["unavailable", "no_source"].includes(observation.quality)) {
    throw new Error("a null value must be unavailable or no_source");
  }
  if (observation.value !== null && ["unavailable", "no_source"].includes(observation.quality)) {
    throw new Error("unavailable and no_source observations cannot carry a value");
  }
  if (Number.isNaN(observation.value)) throw new Error("observation value cannot be NaN");
  if (!Number.isFinite(new Date(observation.collectedAt).getTime())) {
    throw new Error("collectedAt must be an ISO timestamp");
  }
  return observation;
}

export function staleCopy(observation: Observation, now = Date.now()): string {
  if (observation.quality !== "stale") return "";
  const age = Math.max(0, now - new Date(observation.collectedAt).getTime());
  const minutes = Math.round(age / 60_000);
  return `Last successful value, collected ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
}

export interface Reconciliation {
  authoritative: Observation | null;
  attribution: Observation | null;
  discrepancy: number | null;
  warning: string | null;
}

export function reconcileProviderAndTelemetry(
  provider: Observation | null,
  telemetry: Observation | null,
): Reconciliation {
  if (!provider) {
    return { authoritative: null, attribution: telemetry, discrepancy: null, warning: null };
  }
  if (!telemetry) {
    return { authoritative: provider, attribution: null, discrepancy: null, warning: null };
  }
  const p = typeof provider.value === "number" ? provider.value : null;
  const t = typeof telemetry.value === "number" ? telemetry.value : null;
  const discrepancy = p !== null && t !== null ? t - p : null;
  const ratio = p && discrepancy !== null ? Math.abs(discrepancy) / Math.abs(p) : 0;
  return {
    authoritative: provider,
    attribution: telemetry,
    discrepancy,
    warning: ratio > 0.05
      ? "Telemetry attribution does not reconcile with the provider total."
      : null,
  };
}

const CONTENT_KEYS = /(prompt|completion|response|message|input|output|content|body|text)/i;

export function sanitizeTelemetry(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeTelemetry);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !CONTENT_KEYS.test(key))
      .map(([key, child]) => [key, sanitizeTelemetry(child)]),
  );
}
