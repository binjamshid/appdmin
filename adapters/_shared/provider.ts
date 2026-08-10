import type { DiscoveredProduct, Observation } from "../../src/core/types.ts";
import { jsonRequest, required, serveAdapter } from "./runtime.ts";

interface ProviderOptions {
  id: string;
  name: string;
  baseUrl: string;
  modelsPath: string;
  authHeader?: (key: string) => Record<string, string>;
}

export function serveModelProvider(options: ProviderOptions): void {
  let configuration: Record<string, unknown> = {};
  const headers = () => ({
    "content-type": "application/json",
    ...(options.authHeader?.(required(configuration, "apiKey")) ??
      { authorization: `Bearer ${required(configuration, "apiKey")}` }),
  });
  const base = () => String(configuration.baseUrl ?? options.baseUrl).replace(/\/+$/, "");

  void serveAdapter(async (method, params) => {
    if (method === "initialize") {
      configuration = (params.configuration as Record<string, unknown>) ?? {};
      return { protocol: "1.0", capabilities: ["catalog", "costs", "health"] };
    }
    if (method === "shutdown") return { ok: true };
    if (method === "configure.validate" || method === "health.check") {
      await jsonRequest(`${base()}${options.modelsPath}`, { headers: headers() });
      return { ok: true, message: `${options.name} is reachable.` };
    }
    if (method === "catalog.discover") {
      const body = await jsonRequest(`${base()}${options.modelsPath}`, {
        headers: headers(),
      }) as Record<string, unknown>;
      const raw = (body.data ?? body.models ?? []) as Array<Record<string, unknown>>;
      return raw.map((model): DiscoveredProduct => ({
        externalId: String(model.id ?? model.name),
        name: String(model.display_name ?? model.displayName ?? model.id ?? model.name),
        kind: "model",
        platform: options.name,
        sourceUrl: base(),
      }));
    }
    if (method === "costs.collect") {
      const item: Observation = {
        adapterInstanceId: String(params.instanceId ?? options.id),
        metric: "inference.cost.usd",
        value: null,
        currency: "USD",
        collectedAt: new Date().toISOString(),
        quality: "unavailable",
        source: options.name,
        sourceUrl: base(),
        definition:
          "Provider-account cost. This provider or credential exposes no compatible account cost endpoint.",
        authority: "provider",
      };
      return [item];
    }
    throw new Error(`Unsupported method: ${method}`);
  });
}
