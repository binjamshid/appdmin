import type { Sql } from "postgres";

export interface Migration {
  version: string;
  path: string;
  sql: string;
}

export async function discoverMigrations(
  root = new URL("../../migrations/", import.meta.url),
): Promise<Migration[]> {
  const migrations: Migration[] = [];
  for await (const entry of Deno.readDir(root)) {
    if (!entry.isFile || !/^\d{4}_[a-z0-9_]+\.sql$/.test(entry.name)) continue;
    migrations.push({
      version: entry.name.slice(0, 4),
      path: new URL(entry.name, root).pathname,
      sql: await Deno.readTextFile(new URL(entry.name, root)),
    });
  }
  return migrations.sort((left, right) => left.version.localeCompare(right.version));
}

export async function runMigrations(
  database: Sql,
  suppliedMigrations?: Migration[],
): Promise<string[]> {
  const migrations = suppliedMigrations ?? await discoverMigrations();
  const connection = await database.reserve();
  await connection.unsafe(
    "create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())",
  );
  const appliedRows = await connection<
    { version: string }[]
  >`select version from schema_migrations`;
  const applied = new Set(appliedRows.map((row) => row.version));
  const completed: string[] = [];
  await connection.unsafe("select pg_advisory_lock(701399245)");
  try {
    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;
      await connection.unsafe(migration.sql);
      await connection`insert into schema_migrations (version) values (${migration.version})`;
      completed.push(migration.version);
    }
  } finally {
    await connection.unsafe("select pg_advisory_unlock(701399245)");
    await connection.release();
  }
  return completed;
}
