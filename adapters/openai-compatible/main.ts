import { serveModelProvider } from "../_shared/provider.ts";
serveModelProvider({
  id: "appdmin.openai-compatible",
  name: "OpenAI-compatible endpoint",
  baseUrl: "http://127.0.0.1:8080/v1",
  modelsPath: "/models",
});
