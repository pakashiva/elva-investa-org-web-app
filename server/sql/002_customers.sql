CREATE SEQUENCE IF NOT EXISTS customer_code_seq START WITH 1;

CREATE OR REPLACE FUNCTION public.generate_customer_code()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  next_val BIGINT;
BEGIN
  next_val := nextval('customer_code_seq');
  RETURN 'CUST-' || lpad(next_val::text, 2, '0');
END;
$$;

CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  customer_code TEXT NOT NULL UNIQUE DEFAULT public.generate_customer_code(),
  full_name TEXT NOT NULL,
  mobile_number TEXT NOT NULL,
  email_address TEXT NOT NULL,
  date_of_birth DATE NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  pin_code TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  mobile_verified BOOLEAN NOT NULL DEFAULT FALSE,
  authorized BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  referral_code TEXT NOT NULL,
  referred_by_customer_id UUID REFERENCES customers (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT customers_referral_code_format CHECK (referral_code ~ '^[A-Z0-9]{8}$'),
  CONSTRAINT customers_mobile_digits CHECK (mobile_number ~ '^[6-9][0-9]{9}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS customers_email_mobile_combo_idx
  ON customers (mobile_number, lower(email_address));

CREATE UNIQUE INDEX IF NOT EXISTS customers_referral_code_idx
  ON customers (referral_code);

CREATE INDEX IF NOT EXISTS customers_client_created_idx
  ON customers (client_id, created_at DESC);

CREATE TABLE IF NOT EXISTS kyc_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  customer_id UUID NOT NULL UNIQUE REFERENCES customers (id) ON DELETE CASCADE,
  aadhaar_number TEXT,
  pan_number TEXT,
  aadhaar_front_path TEXT,
  aadhaar_back_path TEXT,
  pan_card_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  account_holder_name TEXT NOT NULL DEFAULT '',
  account_number TEXT NOT NULL,
  ifsc_code TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  account_type TEXT NOT NULL DEFAULT 'Savings'
    CHECK (account_type IN ('Savings', 'Current')),
  is_primary BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bank_accounts_customer_idx
  ON bank_accounts (customer_id);

CREATE TABLE IF NOT EXISTS nominees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  nominee_name TEXT NOT NULL,
  relationship TEXT NOT NULL,
  nominee_aadhaar TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS nominees_customer_idx
  ON nominees (customer_id);
