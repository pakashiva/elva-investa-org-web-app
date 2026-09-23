import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(rootDir, '.env') });

const ref = new URL(process.env.SUPABASE_URL).hostname.split('.')[0];
const password = process.env.SUPABASE_DB_PASSWORD?.trim();
if (!password) {
  throw new Error('SUPABASE_DB_PASSWORD is empty');
}
const encoded = encodeURIComponent(password);

const candidates = [
  `postgresql://postgres:${encoded}@db.${ref}.supabase.co:5432/postgres`,
  `postgresql://postgres.${ref}:${encoded}@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`,
  `postgresql://postgres.${ref}:${encoded}@aws-0-ap-south-1.pooler.supabase.com:6543/postgres`,
  `postgresql://postgres.${ref}:${encoded}@aws-1-ap-south-1.pooler.supabase.com:5432/postgres`,
  `postgresql://postgres.${ref}:${encoded}@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`,
  `postgresql://postgres.${ref}:${encoded}@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
  `postgresql://postgres.${ref}:${encoded}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`,
];

async function tryConnect(url) {
  const client = new pg.Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  });
  await client.connect();
  await client.query('SELECT 1');
  return client;
}

const sqlDir = path.join(rootDir, 'server', 'sql');
const files = (await fs.readdir(sqlDir)).filter((name) => name.endsWith('.sql')).sort();

let client = null;
let used = '';
for (const url of candidates) {
  const host = url.split('@')[1];
  process.stdout.write(`Trying ${host} … `);
  try {
    client = await tryConnect(url);
    used = url;
    console.log('ok');
    break;
  } catch (error) {
    console.log(String(error.message || error).split('\n')[0]);
  }
}

if (!client) {
  throw new Error('Could not reach Supabase Postgres on any host.');
}

await client.query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`);

for (const filename of files) {
  const already = await client.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [
    filename,
  ]);
  if ((already.rowCount ?? 0) > 0) {
    console.log(`skip ${filename}`);
    continue;
  }
  const sql = await fs.readFile(path.join(sqlDir, filename), 'utf8');
  await client.query(sql);
  await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
  console.log(`applied ${filename}`);
}

const tables = await client.query(`
  SELECT tablename
  FROM pg_tables
  WHERE schemaname = 'public'
  ORDER BY tablename
`);
console.log(`tables: ${tables.rows.map((row) => row.tablename).join(', ')}`);

const host = used.split('@')[1];
if (!host.startsWith(`db.${ref}.supabase.co`)) {
  const envPath = path.join(rootDir, '.env');
  let env = await fs.readFile(envPath, 'utf8');
  if (!/^SUPABASE_POOLER_HOST=/m.test(env)) {
    env += `\nSUPABASE_POOLER_HOST=${host}\n`;
  } else {
    env = env.replace(/^SUPABASE_POOLER_HOST=.*$/m, `SUPABASE_POOLER_HOST=${host}`);
  }
  await fs.writeFile(envPath, env);
  console.log(`saved SUPABASE_POOLER_HOST=${host}`);
}

await client.end();
console.log('schema apply complete');
