import type { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import * as schema from "./schema";
import { MIGRATIONS } from "./migrations.generated";

export type DB = PgliteDatabase<typeof schema>;

export const LATEST_DB_VERSION = MIGRATIONS.at(-1)?.version ?? 0;

/** Runs every migration newer than the stored version, each in its own transaction (SRS §4.3). */
export async function runMigrations(pg: PGlite): Promise<number> {
  await pg.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    version integer PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
  const res = await pg.query<{ v: number | null }>("SELECT max(version) AS v FROM _migrations");
  const current = res.rows[0]?.v ?? 0;
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    await pg.transaction(async (tx) => {
      for (const stmt of m.statements) await tx.exec(stmt);
      await tx.query("INSERT INTO _migrations (version, name) VALUES ($1, $2)", [m.version, m.name]);
    });
  }
  return LATEST_DB_VERSION;
}

export async function createDb(pg: PGlite): Promise<DB> {
  await runMigrations(pg);
  return drizzle(pg, { schema });
}
