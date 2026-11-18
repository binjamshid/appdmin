import { Hono } from "hono";
import { config } from "../config.ts";
import { bundledCatalog } from "../adapters/bundled.ts";
import { resolveAdapterSource } from "../adapters/packages.ts";
import { AdapterProcess } from "../adapters/runner.ts";
import { databaseHealth, sql } from "../db.ts";
import { randomToken, sha256 } from "../security/crypto.ts";
import { actor, requireSession, requireStepUp } from "../security/guard.ts";
import { audit } from "../security/audit.ts";
import { sourceIsPinned, validateManifest } from "../core/manifest.ts";
import { permissionSummary } from "../core/sandbox.ts";
import {
  adapterById,
  adapterConfiguration,
  adapters,
  applyDiscovery,
  createAdapter,
  onboarding,
  overview,
  products,
  saveAdapterSecret,
  saveObservations,
  saveOnboarding,
  saveWorkspace,
  updateAdapterHealth,
  updateProduct,
  workspace,
} from "../core/repository.ts";
import type { DiscoveredProduct, Observation } from "../core/types.ts";
import type { JSONValue } from "postgres";
import { validateMasoonTelemetry } from "../core/masoon_telemetry.ts";

export const api = new Hono();
api.use("*", requireSession);

api.get("/overview", async (c) => c.json(await overview()));
api.get("/workspace", async (c) => c.json(await workspace()));
api.put("/workspace", async (c) => c.json(await saveWorkspace(await c.req.json())));
api.get("/onboarding", async (c) => c.json(await onboarding()));
api.put("/onboarding/:step", async (c) => {
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  return c.json(await saveOnboarding(c.req.param("step"), body.complete === true));
});
api.get("/products", async (c) => c.json(await products()));
api.get("/masoon-telemetry", async (c) => {
  const installed = await adapters() as Array<{
    id: string;
    enabled: boolean;
    manifest?: { capabilities?: string[] };
  }>;
  const adapter = installed.find((item) =>
    item.enabled && item.manifest?.capabilities?.includes("privacy_telemetry")
  );
  if (!adapter) return c.json({ error: "masoon_telemetry_not_configured" }, 404);
  let process: AdapterProcess | null = null;
  try {
    ({ process } = await processFor(String(adapter.id)));
    const value = await process.call("privacy_telemetry.snapshot", { instanceId: adapter.id });
    return c.json(validateMasoonTelemetry(value));
  } finally {
    await process?.stop();
  }
});
api.patch(
  "/products/:id",
  async (c) => c.json(await updateProduct(c.req.param("id"), await c.req.json())),
);
api.get(
  "/adapters",
  async (c) => c.json({ installed: await adapters(), bundled: await bundledCatalog() }),
);

api.post("/adapters/bundled/:slug", async (c) => {
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const pkg = await resolveAdapterSource(`bundled:${c.req.param("slug")}`);
  const row = await createAdapter({
    manifest: pkg.manifest,
    source: `bundled:${c.req.param("slug")}`,
    packageRoot: pkg.root,
    digest: pkg.digest,
    accepted: body.acceptPermissions === true,
  });
  await audit({
    ...actor(c),
    action: "adapter.install",
    target: pkg.manifest.id,
    detail: {
      source: `bundled:${c.req.param("slug")}`,
      permissions: permissionSummary(pkg.manifest),
    },
  });
  return c.json(row, 201);
});

api.post("/adapters/source", async (c) => {
  const body = await c.req.json() as Record<string, unknown>;
  const source = String(body.source ?? "");
  if (!sourceIsPinned(source)) return c.json({ error: "source_not_pinned" }, 400);
  const pkg = await resolveAdapterSource(source);
  const row = await createAdapter({
    manifest: pkg.manifest,
    source: pkg.source,
    packageRoot: pkg.root,
    digest: pkg.digest,
    accepted: body.acceptPermissions === true,
  });
  return c.json(row, 201);
});

api.put("/adapters/:id/config", async (c) => {
  const body = await c.req.json() as Record<string, unknown>;
  const row = await adapterById(c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  const manifest = validateManifest(row.manifest);
  const properties = (manifest.configSchema?.properties ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  for (const [key, value] of Object.entries(body)) {
    if (!(key in properties)) continue;
    await saveAdapterSecret(c.req.param("id"), key, String(value));
  }
  await audit({
    ...actor(c),
    action: "adapter.configure",
    target: String(row.adapter_id),
    detail: { keys: Object.keys(body) },
  });
  return c.json({ ok: true, configuredKeys: Object.keys(body).filter((key) => key in properties) });
});

async function processFor(id: string) {
  const row = await adapterById(id);
  if (!row) throw new Error("Adapter not found.");
  const pkg = { root: String(row.package_root), manifest: validateManifest(row.manifest) };
  const process = new AdapterProcess(pkg);
  await process.start(await adapterConfiguration(id));
  return { process, row };
}

api.post("/adapters/:id/test", async (c) => {
  let process: AdapterProcess | null = null;
  try {
    ({ process } = await processFor(c.req.param("id")));
    const result = await process.call("configure.validate");
    await updateAdapterHealth(c.req.param("id"), "healthy", null);
    return c.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Connection test failed.";
    await updateAdapterHealth(c.req.param("id"), "failing", message);
    return c.json({ ok: false, error: message }, 502);
  } finally {
    await process?.stop();
  }
});

api.post("/adapters/:id/discover", async (c) => {
  let process: AdapterProcess | null = null;
  try {
    const context = await processFor(c.req.param("id"));
    process = context.process;
    const discovered = await process.call("catalog.discover", {
      instanceId: c.req.param("id"),
    }) as DiscoveredProduct[];
    const next = await applyDiscovery(c.req.param("id"), discovered);
    await updateAdapterHealth(c.req.param("id"), "healthy", null);
    return c.json({ products: next });
  } finally {
    await process?.stop();
  }
});

api.post("/adapters/:id/collect", async (c) => {
  let process: AdapterProcess | null = null;
  try {
    const context = await processFor(c.req.param("id"));
    process = context.process;
    const manifest = validateManifest(context.row.manifest);
    const observations: Observation[] = [];
    if (manifest.capabilities.includes("metrics")) {
      observations.push(
        ...await process.call("metrics.collect", {
          instanceId: c.req.param("id"),
        }) as Observation[],
      );
    }
    if (manifest.capabilities.includes("costs")) {
      observations.push(
        ...await process.call("costs.collect", { instanceId: c.req.param("id") }) as Observation[],
      );
    }
    await saveObservations(observations);
    await updateAdapterHealth(c.req.param("id"), "healthy", null);
    return c.json({ collected: observations.length });
  } finally {
    await process?.stop();
  }
});

api.get(
  "/audit",
  async (c) =>
    c.json(
      await sql`select id,at,actor,action,target,detail,outcome from audit_log order by at desc limit 250`,
    ),
);
api.get(
  "/system",
  async (c) =>
    c.json({
      database: await databaseHealth(),
      version: "2.0.0",
      runtime: Deno.version.deno,
      sourceUrl: config.sourceUrl,
      license: "Binjamshid Public Fork License, Version 1.0",
    }),
);

api.post("/adapters/:id/ingest-token", requireStepUp, async (c) => {
  const row = await adapterById(c.req.param("id"));
  if (!row || row.adapter_id !== "appdmin.opentelemetry") {
    return c.json({ error: "not_ingest_adapter" }, 400);
  }
  const token = randomToken(32);
  const [created] = await sql`
    insert into ingest_tokens(adapter_instance_id,name,token_sha256)
    values (${c.req.param("id")},'Default ingestion token',${await sha256(
    token,
  )}) returning id,created_at
  `;
  await audit({ ...actor(c), action: "ingest_token.create", target: String(created.id) });
  return c.json({ token, id: created.id, createdAt: created.created_at }, 201);
});

api.post("/actions/:adapter/:key", requireStepUp, async (c) => {
  const requestActor = actor(c);
  const idempotency = c.req.header("idempotency-key") ?? crypto.randomUUID();
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const [run] = await sql`
    insert into action_runs(adapter_instance_id,action_key,idempotency_key,input_summary,status,requested_by)
    values (${c.req.param("adapter")},${c.req.param("key")},${idempotency},${
    sql.json({ fields: Object.keys(body) })
  },'running',${requestActor.accountId})
    on conflict(idempotency_key) do update set idempotency_key=excluded.idempotency_key returning *
  `;
  let process: AdapterProcess | null = null;
  try {
    ({ process } = await processFor(c.req.param("adapter")));
    const result = await process.call("actions.execute", {
      key: c.req.param("key"),
      input: body,
      idempotencyKey: idempotency,
    });
    await sql`update action_runs set status='succeeded',result_summary=${
      sql.json(JSON.parse(JSON.stringify(result)) as JSONValue)
    },finished_at=now() where id=${run.id}`;
    await audit({
      ...requestActor,
      action: "adapter.action",
      target: c.req.param("key"),
      detail: { runId: run.id },
      outcome: "ok",
    });
    return c.json({ runId: run.id, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Action failed.";
    await sql`update action_runs set status='failed',error=${
      message.slice(0, 500)
    },finished_at=now() where id=${run.id}`;
    await audit({
      ...requestActor,
      action: "adapter.action",
      target: c.req.param("key"),
      detail: { runId: run.id },
      outcome: "failed",
    });
    return c.json({ error: message, runId: run.id }, 502);
  } finally {
    await process?.stop();
  }
});
