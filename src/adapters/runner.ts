import { config } from "../config.ts";
import { redactSecrets } from "../core/secrets.ts";
import { adapterCommand, adapterEnvironment } from "../core/sandbox.ts";
import type { AdapterHealth, AdapterManifest, RpcRequest, RpcResponse } from "../core/types.ts";

export class AdapterCallError extends Error {
  constructor(message: string, public readonly code = "adapter_failed") {
    super(message);
  }
}

export interface AdapterPackage {
  root: string;
  manifest: AdapterManifest;
}

interface CircuitState {
  failures: number;
  openedAt: number | null;
}

const circuits = new Map<string, CircuitState>();

export class AdapterProcess {
  #child: Deno.ChildProcess | null = null;
  #writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  #reader: ReadableStreamDefaultReader<string> | null = null;
  #sequence = 0;
  #knownSecrets: string[] = [];

  constructor(readonly pkg: AdapterPackage) {}

  async start(configuration: Record<string, unknown> = {}): Promise<void> {
    if (this.#child) return;
    this.#knownSecrets = Object.values(configuration).filter((value): value is string =>
      typeof value === "string"
    );
    const command = adapterCommand(config.denoExecutable, this.pkg.root, this.pkg.manifest);
    this.#child = new Deno.Command(command[0], {
      args: command.slice(1),
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
      env: adapterEnvironment({ DENO_DIR: Deno.env.get("DENO_DIR") }),
      clearEnv: true,
    }).spawn();
    this.#writer = this.#child.stdin.getWriter();
    let pending = "";
    this.#reader = this.#child.stdout.pipeThrough(new TextDecoderStream()).pipeThrough(
      new TransformStream<string, string>({
        transform(chunk, controller) {
          pending += chunk;
          while (pending.includes("\n")) {
            const index = pending.indexOf("\n");
            const line = pending.slice(0, index).trim();
            pending = pending.slice(index + 1);
            if (line) controller.enqueue(line);
          }
        },
        flush(controller) {
          if (pending.trim()) controller.enqueue(pending.trim());
        },
      }),
    ).getReader();
    void this.#consumeLogs(this.#child.stderr);
    await this.call("initialize", {
      protocol: "1.0",
      instanceId: this.pkg.manifest.id,
      configuration,
    });
  }

  async #consumeLogs(stream: ReadableStream<Uint8Array>): Promise<void> {
    const text = stream.pipeThrough(new TextDecoderStream());
    for await (const line of text) {
      const clean = redactSecrets(line.slice(0, 4000), this.#knownSecrets);
      console.error(
        JSON.stringify({ scope: "adapter", adapter: this.pkg.manifest.id, message: clean }),
      );
    }
  }

  async call(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = 20_000,
  ): Promise<unknown> {
    const circuit = circuits.get(this.pkg.manifest.id) ?? { failures: 0, openedAt: null };
    if (circuit.openedAt && Date.now() - circuit.openedAt < 60_000) {
      throw new AdapterCallError(
        "Adapter circuit is open after repeated failures.",
        "circuit_open",
      );
    }
    if (!this.#child || !this.#writer || !this.#reader) {
      throw new AdapterCallError("Adapter is not running.");
    }
    const request: RpcRequest = { jsonrpc: "2.0", id: String(++this.#sequence), method, params };
    await this.#writer.write(new TextEncoder().encode(`${JSON.stringify(request)}\n`));
    try {
      const response = await Promise.race([
        this.#reader.read(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new AdapterCallError("Adapter call timed out.", "timeout")),
            timeoutMs,
          )
        ),
      ]);
      if (response.done) throw new AdapterCallError("Adapter exited before replying.");
      const parsed = JSON.parse(response.value) as RpcResponse;
      if (parsed.id !== request.id) {
        throw new AdapterCallError("Adapter returned an out-of-order response.", "protocol_error");
      }
      if (parsed.error) {
        throw new AdapterCallError(parsed.error.message, `rpc_${parsed.error.code}`);
      }
      circuits.set(this.pkg.manifest.id, { failures: 0, openedAt: null });
      return parsed.result;
    } catch (error) {
      const failures = circuit.failures + 1;
      circuits.set(this.pkg.manifest.id, { failures, openedAt: failures >= 3 ? Date.now() : null });
      throw error;
    }
  }

  async health(): Promise<AdapterHealth> {
    const started = performance.now();
    try {
      const result = await this.call("health.check", {}, 8_000) as Record<string, unknown>;
      return {
        status: result.ok === false ? "degraded" : "healthy",
        checkedAt: new Date().toISOString(),
        latencyMs: Math.round(performance.now() - started),
        message: typeof result.message === "string" ? result.message : undefined,
      };
    } catch (error) {
      return {
        status: "failing",
        checkedAt: new Date().toISOString(),
        latencyMs: Math.round(performance.now() - started),
        message: error instanceof Error ? error.message : "Health check failed.",
      };
    }
  }

  async stop(): Promise<void> {
    if (!this.#child) return;
    try {
      await this.call("shutdown", {}, 2_000);
    } catch { /* process may already be gone */ }
    try {
      this.#child.kill("SIGTERM");
    } catch { /* already exited */ }
    this.#writer?.releaseLock();
    this.#reader?.releaseLock();
    this.#child = null;
    this.#writer = null;
    this.#reader = null;
  }
}
