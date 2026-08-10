#!/usr/bin/env -S deno run --allow-env --allow-net --allow-read --allow-write --allow-run --allow-sys
import { optionString, parseArgs } from "./cli/args.ts";

const HELP = `Appdmin 2.0.0

A self-hosted operations console for software products.

Usage:
  appdmin serve
  appdmin migrate
  appdmin admin create [--username NAME --display-name NAME --password VALUE --totp-code CODE]
  appdmin adapter list
  appdmin adapter add BUNDLED_NAME --accept-permissions
  appdmin adapter add --source PATH|PINNED_SPEC --accept-permissions
  appdmin adapter doctor BUNDLED_NAME
  appdmin doctor
  appdmin install --target docker|systemd [--output PATH] [--dry-run]
  appdmin backup --output FILE
  appdmin restore --input FILE --confirm
  appdmin version

Environment required for service commands:
  DATABASE_URL, APPDMIN_SECRET_KEY, APPDMIN_ORIGIN
`;

async function commandOutput(command: string, args: string[]): Promise<void> {
  const child = new Deno.Command(command, {
    args,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const status = await child.spawn().status;
  if (!status.success) Deno.exit(status.code);
}

export async function main(args = Deno.args): Promise<void> {
  const parsed = parseArgs(args);
  const [primary, secondary, value] = parsed.command;
  if (!primary || primary === "help" || parsed.options.help) return console.log(HELP);
  if (primary === "version") return console.log("Appdmin 2.0.0");
  if (primary === "serve") {
    const { serve } = await import("./main.ts");
    serve();
    return;
  }
  if (primary === "migrate") {
    const { sql } = await import("./db.ts");
    const { runMigrations } = await import("./core/migrations.ts");
    const completed = await runMigrations(sql);
    console.log(
      completed.length ? `Applied migrations: ${completed.join(", ")}` : "Database is current.",
    );
    await sql.end();
    return;
  }
  if (primary === "admin" && secondary === "create") {
    const { createAdmin } = await import("./cli/admin.ts");
    await createAdmin({
      username: optionString(parsed, "username"),
      displayName: optionString(parsed, "display-name"),
      password: optionString(parsed, "password"),
      totpCode: optionString(parsed, "totp-code"),
      nonInteractive: parsed.options["non-interactive"] === true,
    });
    return;
  }
  if (primary === "doctor") {
    const { doctor } = await import("./cli/doctor.ts");
    if (!(await doctor())) Deno.exit(1);
    return;
  }
  if (primary === "install") {
    const target = optionString(parsed, "target");
    if (target !== "docker" && target !== "systemd") {
      throw new Error("--target must be docker or systemd");
    }
    const { installAssets } = await import("./cli/install.ts");
    await installAssets(
      target,
      optionString(parsed, "output", ".")!,
      parsed.options["dry-run"] === true,
    );
    return;
  }
  if (primary === "adapter" && secondary === "list") {
    const { adapters } = await import("./core/repository.ts");
    for (const adapter of await adapters() as Array<Record<string, unknown>>) {
      console.log(
        `${
          adapter.enabled ? "enabled " : "disabled"
        }  ${adapter.adapter_id}  ${adapter.health_status}`,
      );
    }
    return;
  }
  if (primary === "adapter" && secondary === "add") {
    const requestedSource = optionString(parsed, "source") ??
      (value ? `bundled:${value}` : undefined);
    if (!requestedSource) throw new Error("Provide a bundled adapter name or --source.");
    if (parsed.options["accept-permissions"] !== true) {
      throw new Error("Review the manifest and pass --accept-permissions to install.");
    }
    const { resolveAdapterSource } = await import("./adapters/packages.ts");
    const { createAdapter } = await import("./core/repository.ts");
    const pkg = await resolveAdapterSource(requestedSource);
    await createAdapter({
      manifest: pkg.manifest,
      source: pkg.source,
      packageRoot: pkg.root,
      digest: pkg.digest,
      accepted: true,
    });
    console.log(`Installed ${pkg.manifest.name}. Configure its credentials in the GUI.`);
    return;
  }
  if (primary === "adapter" && secondary === "doctor") {
    if (!value) throw new Error("Provide a bundled adapter name.");
    const { bundledAdapter } = await import("./adapters/bundled.ts");
    const pkg = await bundledAdapter(value);
    console.log(
      JSON.stringify(
        {
          id: pkg.manifest.id,
          version: pkg.manifest.version,
          protocol: pkg.manifest.protocol,
          capabilities: pkg.manifest.capabilities,
          permissions: pkg.manifest.permissions,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (primary === "backup") {
    const output = optionString(parsed, "output");
    if (!output) throw new Error("--output is required");
    await commandOutput("pg_dump", [
      "--format=custom",
      `--file=${output}`,
      Deno.env.get("DATABASE_URL") ?? "",
    ]);
    return;
  }
  if (primary === "restore") {
    const input = optionString(parsed, "input");
    if (!input || parsed.options.confirm !== true) {
      throw new Error("--input and --confirm are required");
    }
    await commandOutput("pg_restore", [
      "--clean",
      "--if-exists",
      `--dbname=${Deno.env.get("DATABASE_URL") ?? ""}`,
      input,
    ]);
    return;
  }
  console.error(`Unknown command: ${parsed.command.join(" ")}\n`);
  console.log(HELP);
  Deno.exit(2);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`Error: ${error instanceof Error ? error.message : error}`);
    Deno.exit(1);
  });
}
