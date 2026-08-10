import { serveAdapter } from "../_shared/runtime.ts";

void serveAdapter((method) => {
  if (method === "initialize") {
    return { protocol: "1.0", capabilities: ["metrics", "costs", "health"] };
  }
  if (method === "health.check" || method === "configure.validate") {
    return { ok: true, message: "The core ingestion endpoint is ready." };
  }
  if (method === "metrics.collect" || method === "costs.collect") return [];
  if (method === "shutdown") return { ok: true };
  throw new Error(`Unsupported method: ${method}`);
});
