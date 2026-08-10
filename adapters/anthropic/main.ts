import { serveModelProvider } from "../_shared/provider.ts";
serveModelProvider({
  id: "appdmin.anthropic",
  name: "Anthropic",
  baseUrl: "https://api.anthropic.com",
  modelsPath: "/v1/models",
  authHeader: (key) => ({ "x-api-key": key, "anthropic-version": "2023-06-01" }),
});
