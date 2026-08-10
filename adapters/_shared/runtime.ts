import type { RpcRequest, RpcResponse } from "../../src/core/types.ts";

export type Handler = (
  method: string,
  params: Record<string, unknown>,
) => Promise<unknown> | unknown;

export async function serveAdapter(handler: Handler): Promise<void> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  for await (const chunk of Deno.stdin.readable) {
    buffer += decoder.decode(chunk, { stream: true });
    while (buffer.includes("\n")) {
      const index = buffer.indexOf("\n");
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      let response: RpcResponse;
      try {
        const request = JSON.parse(line) as RpcRequest;
        const result = await handler(request.method, request.params ?? {});
        response = { jsonrpc: "2.0", id: request.id, result };
      } catch (error) {
        let id = "unknown";
        try {
          id = String((JSON.parse(line) as RpcRequest).id);
        } catch { /* malformed request */ }
        response = {
          jsonrpc: "2.0",
          id,
          error: {
            code: -32000,
            message: error instanceof Error ? error.message : "Adapter request failed.",
          },
        };
      }
      await Deno.stdout.write(encoder.encode(`${JSON.stringify(response)}\n`));
      if (line.includes('"method":"shutdown"')) return;
    }
  }
}

export async function jsonRequest(url: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(url, init);
  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { detail: text.slice(0, 500) };
  }
  if (!response.ok) {
    const retry = response.headers.get("retry-after");
    throw new Error(
      `Upstream request failed (${response.status})${retry ? `; retry after ${retry}s` : ""}.`,
    );
  }
  return body;
}

export function required(config: Record<string, unknown>, key: string): string {
  const value = String(config[key] ?? "").trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}
