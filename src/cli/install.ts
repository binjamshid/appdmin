export type InstallTarget = "docker" | "systemd";

const ROOT = new URL("../../", import.meta.url);

async function copy(source: string, destination: string): Promise<void> {
  await Deno.copyFile(new URL(source, ROOT), destination);
}

export async function installAssets(
  target: InstallTarget,
  output: string,
  dryRun: boolean,
): Promise<void> {
  const files = target === "docker"
    ? [["compose.yaml", "compose.yaml"], [".env.example", ".env.example"]]
    : [["deploy/appdmin.service", "appdmin.service"], [
      "deploy/appdmin.env.example",
      "appdmin.env.example",
    ], ["deploy/appdmin.tmpfiles", "appdmin.tmpfiles"]];
  if (!dryRun) await Deno.mkdir(output, { recursive: true });
  console.log(`Target: ${target}`);
  for (const [source, name] of files) {
    const destination = `${output.replace(/\/$/, "")}/${name}`;
    console.log(`${dryRun ? "Would write" : "Writing"}: ${destination}`);
    if (!dryRun) await copy(source, destination);
  }
  if (dryRun) return;
  console.log(
    target === "docker"
      ? "\nCopy .env.example to .env, fill its values, then run: docker compose up -d"
      : "\nReview appdmin.env.example, install the unit as documented, then run appdmin doctor.",
  );
}
