import { jsonRequest, required, serveAdapter } from "../_shared/runtime.ts";
import { openAICostObservations } from "./costs.ts";

let configuration: Record<string, unknown> = {};
const headers = () => ({ authorization: `Bearer ${required(configuration, "apiKey")}` });

void serveAdapter(async (method, params) => {
  if (method === "initialize") {
    configuration = (params.configuration as Record<string, unknown>) ?? {};
    return { protocol: "1.0", capabilities: ["catalog", "costs", "health"] };
  }
  if (method === "shutdown") return { ok: true };
  if (method === "configure.validate" || method === "health.check") {
    await jsonRequest("https://api.openai.com/v1/models", { headers: headers() });
    return { ok: true, message: "OpenAI is reachable." };
  }
  if (method === "catalog.discover") {
    const body = await jsonRequest("https://api.openai.com/v1/models", { headers: headers() }) as {
      data?: Array<{ id: string }>;
    };
    return (body.data ?? []).map((model) => ({
      externalId: model.id,
      name: model.id,
      kind: "model",
      platform: "OpenAI",
      sourceUrl: "https://platform.openai.com",
    }));
  }
  if (method === "costs.collect") {
    const end = Math.floor(Date.now() / 1000);
    const start = Number(params.startTime ?? end - 30 * 86400);
    const body = await jsonRequest(
      `https://api.openai.com/v1/organization/costs?start_time=${start}&end_time=${end}&bucket_width=1d&limit=31`,
      { headers: headers() },
    ) as { data?: Array<Record<string, unknown>> };
    return openAICostObservations(body, String(params.instanceId ?? "appdmin.openai"));
  }
  throw new Error(`Unsupported method: ${method}`);
});
