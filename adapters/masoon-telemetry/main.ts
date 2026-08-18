import { jsonRequest, required, serveAdapter } from "../_shared/runtime.ts";

let configuration: Record<string, unknown> = {};

async function snapshot() {
  return await jsonRequest("https://masoon-api.binjamshid.com/v1/admin/telemetry/summary", {
    headers: { authorization: `Bearer ${required(configuration, "adminToken")}` },
  });
}

void serveAdapter(async (method, params) => {
  if (method === "initialize") {
    configuration = (params.configuration as Record<string, unknown>) ?? {};
    return { protocol: "1.0", capabilities: ["privacy_telemetry", "health"] };
  }
  if (method === "shutdown") return { ok: true };
  if (method === "configure.validate" || method === "health.check") {
    await snapshot();
    return { ok: true, message: "Masoon thresholded telemetry is reachable." };
  }
  if (method === "privacy_telemetry.snapshot") return await snapshot();
  throw new Error(`Unsupported method: ${method}`);
});
