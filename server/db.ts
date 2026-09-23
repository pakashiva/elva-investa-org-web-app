import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { config } from './config.ts';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
});

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForDatabase() {
  let lastError: unknown;
  const attempts = process.env.VERCEL ? 5 : 60;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await pool.query('SELECT 1');
      if (attempt > 1) {
        console.log('Postgres is ready.');
      }
      return;
    } catch (error) {
      lastError = error;
      console.log(`Waiting for Postgres (${attempt}/${attempts})…`);
      await sleep(1000);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(
        'Postgres is not reachable. Check SUPABASE_DB_PASSWORD / DATABASE_URL in .env (cloud Supabase, not Docker).'
      );
}

export async function migrate() {
  const dir = path.join(config.rootDir, 'server', 'sql');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const files = (await fs.readdir(dir))
    .filter((name) => name.endsWith('.sql'))
    .sort();

  for (const filename of files) {
    const already = await pool.query(
      'SELECT 1 FROM schema_migrations WHERE filename = $1',
      [filename]
    );
    if ((already.rowCount ?? 0) > 0) {
      continue;
    }
    const sql = await fs.readFile(path.join(dir, filename), 'utf8');
    await pool.query(sql);
    await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
    console.log(`Applied ${filename}`);
  }
}
