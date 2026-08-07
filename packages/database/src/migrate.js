import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, "../migrations");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required to run database migrations.");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  await pool.query(`
    create table if not exists schema_migrations (
      id text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const entries = (await fs.readdir(migrationsDir))
    .filter((entry) => entry.endsWith(".sql"))
    .sort();

  for (const entry of entries) {
    const applied = await pool.query("select 1 from schema_migrations where id = $1", [
      entry,
    ]);
    if (applied.rowCount) {
      console.log(`skip ${entry}`);
      continue;
    }

    const sql = await fs.readFile(path.join(migrationsDir, entry), "utf8");
    await pool.query("begin");
    try {
      await pool.query(sql);
      await pool.query("insert into schema_migrations (id) values ($1)", [entry]);
      await pool.query("commit");
      console.log(`applied ${entry}`);
    } catch (error) {
      await pool.query("rollback");
      throw error;
    }
  }
} finally {
  await pool.end();
}
