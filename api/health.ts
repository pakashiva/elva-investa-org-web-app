import type { IncomingMessage, ServerResponse } from 'node:http';

function missingEnv(): string[] {
  const missing: string[] = [];
  if (!process.env.JWT_SECRET?.trim()) {
    missing.push('JWT_SECRET');
  }
  if (!process.env.SUPABASE_URL?.trim() && !process.env.DATABASE_URL?.trim()) {
    missing.push('SUPABASE_URL');
  }
  if (
    !process.env.SUPABASE_DB_PASSWORD?.trim() &&
    !process.env.SUPABASE_PASSWORD?.trim() &&
    !process.env.DATABASE_URL?.trim()
  ) {
    missing.push('SUPABASE_DB_PASSWORD');
  }
  return missing;
}

export default function handler(_req: IncomingMessage, res: ServerResponse) {
  const missing = missingEnv();
  res.statusCode = missing.length ? 503 : 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: missing.length === 0, missing }));
}
