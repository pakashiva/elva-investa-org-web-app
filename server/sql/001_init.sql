CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('super_admin', 'client_admin')),
  client_id UUID,
  full_name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT users_role_client_ck CHECK (
    (role = 'super_admin' AND client_id IS NULL)
    OR (role = 'client_admin' AND client_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx
  ON users (lower(username));

CREATE UNIQUE INDEX IF NOT EXISTS users_one_admin_per_client_idx
  ON users (client_id)
  WHERE role = 'client_admin';

CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  client_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  support_email TEXT,
  support_phone TEXT,
  created_by UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS clients_code_lower_idx
  ON clients (lower(client_code));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_client_id_fkey'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_client_id_fkey
      FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS client_settings (
  client_id UUID PRIMARY KEY REFERENCES clients (id) ON DELETE CASCADE,
  min_investment_amount NUMERIC(15, 2) NOT NULL,
  max_investment_amount NUMERIC(15, 2) NOT NULL,
  agreement_charges NUMERIC(15, 2) NOT NULL DEFAULT 1000,
  default_interest_rate NUMERIC(8, 6) NOT NULL DEFAULT 0.05,
  default_tds_percent NUMERIC(8, 6) NOT NULL DEFAULT 0.10,
  default_payout_day INTEGER NOT NULL DEFAULT 10
    CHECK (default_payout_day = ANY (ARRAY[1, 5, 10, 15, 20, 25])),
  referral_rate NUMERIC(8, 6) NOT NULL DEFAULT 0.01,
  referral_tds_rate NUMERIC(8, 6) NOT NULL DEFAULT 0.02,
  default_currency TEXT NOT NULL DEFAULT 'INR',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT client_settings_min_positive CHECK (min_investment_amount > 0),
  CONSTRAINT client_settings_max_gte_min CHECK (max_investment_amount >= min_investment_amount)
);
