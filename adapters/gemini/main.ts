import { jsonRequest, required, serveAdapter } from "../_shared/runtime.ts";
import type { Observation } from "../../src/core/types.ts";
let configuration: Record<string, unknown> = {};
const url = () =>
  `https://generativelanguage.googleapis.com/v1beta/models?key=${
    encodeURIComponent(required(configuration, "apiKey"))
  }`;
void serveAdapter(async (method, params) => {
  if (method === "initialize") {
    configuration = (params.configuration as Record<string, unknown>) ?? {};
    return { protocol: "1.0", capabilities: ["catalog", "costs", "health"] };
  }
  if (method === "shutdown") return { ok: true };
  if (method === "configure.validate" || method === "health.check") {
    await jsonRequest(url());
    return { ok: true, message: "Gemini is reachable." };
  }
  if (method === "catalog.discover") {
    const body = await jsonRequest(url()) as {
      models?: Array<{ name: string; displayName?: string }>;
    };
    return (body.models ?? []).map((model) => ({
      externalId: model.name,
      name: model.displayName ?? model.name,
      kind: "model",
      platform: "Google Gemini",
      sourceUrl: "https://ai.google.dev",
    }));
  }
  if (method === "costs.collect") {
    const item: Observation = {
      adapterInstanceId: String(params.instanceId ?? "appdmin.gemini"),
      metric: "inference.cost.usd",
      value: null,
      currency: "USD",
      collectedAt: new Date().toISOString(),
      quality: "unavailable",
      source: "Google Gemini API",
      sourceUrl: "https://ai.google.dev",
      definition: "The configured Gemini API does not expose authoritative account cost totals.",
      authority: "provider",
    };
    return [item];
  }
  throw new Error(`Unsupported method: ${method}`);
});
