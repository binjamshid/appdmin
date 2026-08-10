import postgres from "postgres";
import { config } from "./config.ts";

export const sql = postgres(config.databaseUrl, {
  max: 8,
  idle_timeout: 30,
  connect_timeout: 10,
  onnotice: () => {},
  connection: { statement_timeout: 30_000 },
});

export async function databaseHealth(): Promise<
  { ok: boolean; latencyMs: number; error?: string }
> {
  const started = performance.now();
  try {
    await sql`select 1`;
    return { ok: true, latencyMs: Math.round(performance.now() - started) };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - started),
      error: error instanceof Error ? error.message : "database connection failed",
    };
  }
}

export async function closeDatabase(): Promise<void> {
  await sql.end({ timeout: 5 });
}
