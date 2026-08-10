import { jsonRequest, required, serveAdapter } from "../_shared/runtime.ts";
import { openRouterUsageObservation } from "./usage.ts";
let configuration: Record<string, unknown> = {};
const headers = () => ({ authorization: `Bearer ${required(configuration, "apiKey")}` });
void serveAdapter(async (method, params) => {
  if (method === "initialize") {
    configuration = (params.configuration as Record<string, unknown>) ?? {};
    return { protocol: "1.0", capabilities: ["catalog", "costs", "health"] };
  }
  if (method === "shutdown") return { ok: true };
  if (method === "configure.validate" || method === "health.check") {
    await jsonRequest("https://openrouter.ai/api/v1/key", { headers: headers() });
    return { ok: true, message: "OpenRouter is reachable." };
  }
  if (method === "catalog.discover") {
    const body = await jsonRequest("https://openrouter.ai/api/v1/models", {
      headers: headers(),
    }) as { data?: Array<{ id: string; name?: string }> };
    return (body.data ?? []).map((model) => ({
      externalId: model.id,
      name: model.name ?? model.id,
      kind: "model",
      platform: "OpenRouter",
      sourceUrl: `https://openrouter.ai/${model.id}`,
    }));
  }
  if (method === "costs.collect") {
    const body = await jsonRequest("https://openrouter.ai/api/v1/key", { headers: headers() }) as {
      data?: { usage?: number };
    };
    return [
      openRouterUsageObservation(body, String(params.instanceId ?? "appdmin.openrouter")),
    ];
  }
  throw new Error(`Unsupported method: ${method}`);
});
