import { Hono } from "hono";
import { sql } from "../db.ts";
import { sanitizeTelemetry } from "../core/observations.ts";
import { saveObservations } from "../core/repository.ts";
import { sha256 } from "../security/crypto.ts";
import type { Observation } from "../core/types.ts";

export const ingest = new Hono();

ingest.post("/usage", async (c) => {
  const authorization = c.req.header("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) return c.json({ error: "unauthenticated" }, 401);
  const [credential] = await sql<{ id: string; adapter_instance_id: string }[]>`
    select id,adapter_instance_id from ingest_tokens
    where token_sha256=${await sha256(token)} and revoked_at is null
  `;
  if (!credential) return c.json({ error: "unauthenticated" }, 401);
  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return c.json({ error: "invalid_payload" }, 400);
  }
  const body = sanitizeTelemetry(raw) as Record<string, unknown>;
  const timestamp = typeof body.timestamp === "string" ? body.timestamp : new Date().toISOString();
  const externalId = typeof body.productExternalId === "string" ? body.productExternalId : null;
  const [product] = externalId
    ? await sql<{ id: string }[]>`select id from products where external_id=${externalId} limit 1`
    : [];
  const dimensions = {
    provider: typeof body.provider === "string" ? body.provider : undefined,
    model: typeof body.model === "string" ? body.model : undefined,
  };
  const metrics: Array<[string, unknown, string | undefined, string]> = [
    [
      "inference.requests",
      body.requests,
      "request",
      "Application-recorded inference request count.",
    ],
    [
      "inference.tokens.input",
      body.inputTokens,
      "token",
      "Application-recorded input token count.",
    ],
    [
      "inference.tokens.output",
      body.outputTokens,
      "token",
      "Application-recorded output token count.",
    ],
    [
      "inference.latency.ms",
      body.latencyMs,
      "millisecond",
      "Application-recorded inference latency.",
    ],
    [
      "inference.cost.usd",
      body.costUsd,
      "currency",
      "Application-attributed inference cost; provider totals remain authoritative.",
    ],
  ];
  const observations: Observation[] = metrics
    .filter(([, value]) => typeof value === "number" && Number.isFinite(value))
    .map(([metric, value, unit, definition]) => ({
      adapterInstanceId: credential.adapter_instance_id,
      productId: product?.id,
      metric,
      value: value as number,
      unit,
      currency: metric === "inference.cost.usd" ? "USD" : undefined,
      collectedAt: timestamp,
      quality: "live",
      source: "OpenTelemetry usage",
      definition,
      notes: [JSON.stringify(dimensions)],
      authority: "telemetry",
    }));
  if (!observations.length) return c.json({ error: "no_numeric_usage" }, 400);
  await saveObservations(observations);
  await sql`update ingest_tokens set last_used_at=now() where id=${credential.id}`;
  return c.json({ accepted: observations.length }, 202);
});
