import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = process.env.VERCEL
  ? process.cwd()
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(rootDir, '.env') });

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name} in .env`);
  }
  return value;
}

function supabaseProjectRef(): string | null {
  const raw =
    process.env.SUPABASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ||
    '';
  if (!raw) {
    return null;
  }
  try {
    const host = new URL(raw).hostname;
    const ref = host.split('.')[0];
    return ref || null;
  } catch {
    return null;
  }
}

function resolveDatabaseUrl(): string {
  const password =
    process.env.SUPABASE_DB_PASSWORD?.trim() || process.env.SUPABASE_PASSWORD?.trim();
  const ref = supabaseProjectRef();
  if (password && ref) {
    const encoded = encodeURIComponent(password);
    const pooler = process.env.SUPABASE_POOLER_HOST?.trim();
    if (pooler) {
      return `postgresql://postgres.${ref}:${encoded}@${pooler}`;
    }
    // Vercel cannot resolve the IPv6-only db.*.supabase.co host.
    const usePooler =
      Boolean(process.env.VERCEL) || process.env.SUPABASE_USE_POOLER === '1';
    if (usePooler) {
      const region = (process.env.SUPABASE_REGION ?? 'ap-south-1').trim();
      return `postgresql://postgres.${ref}:${encoded}@aws-0-${region}.pooler.supabase.com:6543/postgres?sslmode=require`;
    }
    return `postgresql://postgres:${encoded}@db.${ref}.supabase.co:5432/postgres?sslmode=require`;
  }

  const explicit = process.env.DATABASE_URL?.trim();
  if (explicit) {
    return explicit;
  }

  throw new Error(
    'Set SUPABASE_DB_PASSWORD (Supabase → Project Settings → Database) or DATABASE_URL. The publishable key is not a Postgres password.'
  );
}

export const config = {
  rootDir,
  port: Number(process.env.PORT ?? 4000),
  get databaseUrl() {
    return resolveDatabaseUrl();
  },
  get databaseSsl() {
    return /supabase\.(co|com)|pooler\.supabase|sslmode=require/i.test(this.databaseUrl);
  },
  get jwtSecret() {
    return required('JWT_SECRET');
  },
  cookieName: 'elva_admin_session',
  superAdmin: {
    username: (process.env.SUPER_ADMIN_USERNAME ?? 'superadmin').trim().toLowerCase(),
    password: process.env.SUPER_ADMIN_PASSWORD ?? 'Elva@1234',
    fullName: process.env.SUPER_ADMIN_NAME ?? 'ELVA Super Admin',
  },
  otp: {
    apiBaseUrl: (process.env.OTP_API_BASE_URL ?? 'https://api.notify.elvatech.in').replace(/\/$/, ''),
    appId: process.env.OTP_APP_ID ?? 'eNandi',
    apiKey: process.env.OTP_API_KEY ?? 'eNandi_123',
    brandId: process.env.OTP_BRAND_ID ?? 'elva-sales',
  },
};
