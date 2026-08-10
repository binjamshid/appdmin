import { sql } from "../db.ts";
import { reconcileCatalog } from "./catalog.ts";
import { decryptValue, type EncryptedValue, encryptValue, redactSecrets } from "./secrets.ts";
import type { AdapterManifest, CatalogProduct, DiscoveredProduct, Observation } from "./types.ts";
import { validateObservation } from "./observations.ts";
import { config } from "../config.ts";
import type { JSONValue } from "postgres";

function asJson(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

export async function workspace() {
  const [row] = await sql`select * from workspace_settings where singleton`;
  return row;
}

export async function saveWorkspace(input: Record<string, unknown>) {
  const name = String(input.name ?? "Appdmin").trim().slice(0, 80) || "Appdmin";
  const compact = String(input.compactName ?? name).trim().slice(0, 20) || "Appdmin";
  const accent = String(input.accent ?? "indigo").trim().slice(0, 24);
  const timezone = String(input.timezone ?? "UTC").trim().slice(0, 80);
  const currency = String(input.currency ?? "USD").trim().toUpperCase().slice(0, 3);
  const [row] = await sql`
    update workspace_settings set name=${name}, compact_name=${compact}, accent=${accent},
      timezone=${timezone}, currency=${currency}, updated_at=now() where singleton returning *
  `;
  return row;
}

export async function onboarding() {
  const [row] = await sql`select * from onboarding_state where singleton`;
  return row;
}

export async function saveOnboarding(step: string, complete: boolean) {
  const allowed = ["workspace", "security", "products", "providers", "review"];
  if (!allowed.includes(step)) throw new Error("unknown onboarding step");
  const [row] = await sql`
    update onboarding_state
       set current_step=${step},
           completed_steps=case when ${complete} and not (${step}=any(completed_steps))
             then array_append(completed_steps, ${step}) else completed_steps end,
           completed_at=case when ${step}='review' and ${complete} then now() else completed_at end,
           updated_at=now()
     where singleton returning *
  `;
  return row;
}

export async function saveAdapterSecret(instanceId: string, key: string, plaintext: string) {
  const encrypted = await encryptValue(plaintext, config.secretKey);
  await sql`
    insert into encrypted_settings(namespace,key,value_enc,is_secret)
    values (${`adapter:${instanceId}`},${key},${sql.json(asJson(encrypted))},true)
    on conflict(namespace,key) do update set value_enc=excluded.value_enc, updated_at=now()
  `;
}

export async function adapterConfiguration(instanceId: string): Promise<Record<string, unknown>> {
  const rows = await sql<{ key: string; value_enc: EncryptedValue }[]>`
    select key,value_enc from encrypted_settings where namespace=${`adapter:${instanceId}`}
  `;
  const entries = await Promise.all(
    rows.map(async (row) =>
      [row.key, await decryptValue(row.value_enc, config.secretKey)] as const
    ),
  );
  return Object.fromEntries(entries);
}

export async function adapterById(instanceId: string) {
  const [row] = await sql`select * from adapter_instances where id=${instanceId}`;
  return row ? redactSecrets(row) as Record<string, unknown> : null;
}

export async function updateAdapterHealth(
  instanceId: string,
  status: string,
  message: string | null,
) {
  await sql`
    update adapter_instances set health_status=${status},health_message=${message},last_checked_at=now(),
      last_success_at=case when ${status}='healthy' then now() else last_success_at end,
      consecutive_failures=case when ${status}='healthy' then 0 else consecutive_failures+1 end,
      updated_at=now() where id=${instanceId}
  `;
}

export async function adapters() {
  const rows = await sql`select * from adapter_instances order by name`;
  return redactSecrets(rows);
}

export async function createAdapter(input: {
  manifest: AdapterManifest;
  source: string;
  packageRoot: string;
  digest: string;
  accepted: boolean;
}) {
  const accepted = input.accepted ? input.digest : null;
  const [row] = await sql`
    insert into adapter_instances(adapter_id,name,source,package_root,source_digest,manifest,accepted_manifest_digest,enabled,health_status)
    values (${input.manifest.id},${input.manifest.name},${input.source},${input.packageRoot},${input.digest},${
    sql.json(asJson(input.manifest))
  },${accepted},${input.accepted},${input.accepted ? "degraded" : "disabled"})
    on conflict(adapter_id) do update set name=excluded.name, source=excluded.source, package_root=excluded.package_root,
      source_digest=excluded.source_digest, manifest=excluded.manifest,
      accepted_manifest_digest=case when adapter_instances.source_digest=excluded.source_digest
        then adapter_instances.accepted_manifest_digest else null end,
      enabled=case when adapter_instances.source_digest=excluded.source_digest
        then adapter_instances.enabled else false end, updated_at=now()
    returning *
  `;
  return redactSecrets(row);
}

export async function products(): Promise<CatalogProduct[]> {
  const rows =
    await sql`select * from products order by hidden, group_name nulls last, display_name`;
  return rows.map((row) => ({
    id: String(row.id),
    adapterInstanceId: String(row.adapter_instance_id),
    externalId: String(row.external_id),
    name: String(row.source_name),
    displayName: String(row.display_name),
    kind: row.kind,
    platform: row.platform ?? undefined,
    iconUrl: row.icon_url ?? undefined,
    sourceUrl: row.source_url ?? undefined,
    groupName: row.group_name,
    notes: row.notes,
    hidden: row.hidden,
    metadata: row.metadata,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    missingSince: row.missing_since,
  })) as CatalogProduct[];
}

export async function updateProduct(id: string, input: Record<string, unknown>) {
  const [row] = await sql`
    update products set
      display_name=coalesce(${
    typeof input.displayName === "string" ? input.displayName.trim().slice(0, 100) : null
  },display_name),
      group_name=${
    typeof input.groupName === "string" ? input.groupName.trim().slice(0, 80) || null : null
  },
      notes=${typeof input.notes === "string" ? input.notes.trim().slice(0, 1000) || null : null},
      hidden=coalesce(${typeof input.hidden === "boolean" ? input.hidden : null},hidden)
    where id=${id} returning *
  `;
  return row;
}

export async function applyDiscovery(adapterInstanceId: string, discovered: DiscoveredProduct[]) {
  const current = (await products()).filter((product) =>
    product.adapterInstanceId === adapterInstanceId
  );
  const next = reconcileCatalog(adapterInstanceId, current, discovered);
  await sql.begin(async (tx) => {
    for (const product of next) {
      await tx`
        insert into products(id,adapter_instance_id,external_id,source_name,display_name,kind,platform,icon_url,source_url,group_name,notes,hidden,metadata,first_seen_at,last_seen_at,missing_since)
        values (${product.id},${product.adapterInstanceId},${product.externalId},${product.name},${product.displayName},${product.kind},${
        product.platform ?? null
      },${product.iconUrl ?? null},${
        product.sourceUrl ?? null
      },${product.groupName},${product.notes},${product.hidden},${
        tx.json(asJson(product.metadata ?? {}))
      },${product.firstSeenAt},${product.lastSeenAt},${product.missingSince})
        on conflict(adapter_instance_id,external_id) do update set source_name=excluded.source_name,
          kind=excluded.kind, platform=excluded.platform, icon_url=excluded.icon_url,
          source_url=excluded.source_url, metadata=excluded.metadata, last_seen_at=excluded.last_seen_at,
          missing_since=excluded.missing_since
      `;
    }
  });
  return next;
}

export async function saveObservations(observations: Observation[]) {
  for (const raw of observations) {
    const item = validateObservation(raw);
    await sql`
      insert into observations(adapter_instance_id,product_id,metric,value,unit,currency,interval_start,interval_end,collected_at,quality,source,source_url,definition,timezone,notes,provider_record_id,authority)
      values (${item.adapterInstanceId},${item.productId ?? null},${item.metric},${
      sql.json(asJson(item.value))
    },${item.unit ?? null},${item.currency ?? null},${item.intervalStart ?? null},${
      item.intervalEnd ?? null
    },${item.collectedAt},${item.quality},${item.source},${
      item.sourceUrl ?? null
    },${item.definition},${item.timezone ?? null},${sql.json(asJson(item.notes ?? []))},${
      item.providerRecordId ?? null
    },${item.authority ?? null})
    `;
  }
}

export async function overview() {
  const [catalog, adapterRows, latest, workspaceRow] = await Promise.all([
    products(),
    adapters(),
    sql`select distinct on (adapter_instance_id,metric,product_id,currency)
          adapter_instance_id,metric,product_id,value,unit,currency,collected_at,quality,source,definition,notes
        from observations
        order by adapter_instance_id,metric,product_id,currency,collected_at desc`,
    workspace(),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    workspace: workspaceRow,
    products: catalog,
    adapters: adapterRows,
    observations: latest,
  };
}
