import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { config } from './config';

type PoolCtor = typeof pg.Pool;

function withoutSslMode(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete('sslmode');
    parsed.searchParams.delete('ssl');
    return parsed.toString().replace(/\/\?$/, '/').replace(/\?$/, '');
  } catch {
    return url.replace(/[?&]sslmode=[^&]*/gi, '').replace(/[?&]$/, '');
  }
}

function createPool() {
  const Pool: PoolCtor | undefined =
    pg.Pool ?? (pg as unknown as { default?: { Pool: PoolCtor } }).default?.Pool;
  if (!Pool) {
    throw new Error('The pg driver did not load. Check the Vercel Node runtime.');
  }
  // sslmode=require in the URL makes pg verify CAs and fails on Vercel
  // with "self-signed certificate in certificate chain".
  const connectionString = withoutSslMode(config.databaseUrl);
  const useSsl = config.databaseSsl || Boolean(process.env.VERCEL);
  return new Pool({
    connectionString,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  });
}

let poolInstance: InstanceType<PoolCtor> | undefined;

export const pool = new Proxy({} as InstanceType<PoolCtor>, {
  get(_target, prop, _receiver) {
    if (!poolInstance) {
      poolInstance = createPool();
    }
    const value = Reflect.get(poolInstance, prop, poolInstance) as unknown;
    return typeof value === 'function' ? value.bind(poolInstance) : value;
  },
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
