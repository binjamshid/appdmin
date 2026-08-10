import { AdapterProcess } from "../adapters/runner.ts";
import { config } from "../config.ts";
import { sql } from "../db.ts";
import { validateManifest } from "./manifest.ts";
import {
  adapterConfiguration,
  applyDiscovery,
  saveObservations,
  updateAdapterHealth,
} from "./repository.ts";
import type { DiscoveredProduct, Observation } from "./types.ts";

let collecting = false;

export async function collectEnabledAdapters(): Promise<void> {
  if (collecting) return;
  collecting = true;
  try {
    const instances = await sql<
      Array<{ id: string; source: string; package_root: string; manifest: unknown }>
    >`select id,source,package_root,manifest from adapter_instances where enabled order by created_at`;
    for (const instance of instances) {
      let process: AdapterProcess | null = null;
      try {
        const manifest = validateManifest(instance.manifest);
        const pkg = { root: instance.package_root, manifest };
        process = new AdapterProcess(pkg);
        await process.start(await adapterConfiguration(instance.id));
        if (manifest.capabilities.includes("catalog")) {
          const discovered = await process.call("catalog.discover", {
            instanceId: instance.id,
          }) as DiscoveredProduct[];
          await applyDiscovery(instance.id, discovered);
        }
        const observations: Observation[] = [];
        if (manifest.capabilities.includes("metrics")) {
          observations.push(
            ...await process.call("metrics.collect", { instanceId: instance.id }) as Observation[],
          );
        }
        if (manifest.capabilities.includes("costs")) {
          observations.push(
            ...await process.call("costs.collect", { instanceId: instance.id }) as Observation[],
          );
        }
        if (observations.length) await saveObservations(observations);
        await updateAdapterHealth(instance.id, "healthy", null);
      } catch (error) {
        await updateAdapterHealth(
          instance.id,
          "failing",
          error instanceof Error ? error.message.slice(0, 500) : "Collection failed.",
        );
      } finally {
        await process?.stop();
      }
    }
  } finally {
    collecting = false;
  }
}

export function startScheduler(): ReturnType<typeof setInterval> {
  const run = () =>
    void collectEnabledAdapters().catch((error) => {
      console.error(JSON.stringify({
        level: "error",
        scope: "scheduler",
        message: error instanceof Error ? error.message : "Collection cycle failed.",
      }));
    });
  const timer = setInterval(
    run,
    config.collectionMinutes * 60_000,
  );
  setTimeout(run, 5_000);
  return timer;
}
