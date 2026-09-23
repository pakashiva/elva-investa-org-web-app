-- ELVA Investa schema for Supabase Postgres
-- Run once in Supabase SQL Editor (project rcexagktpinoalceodyc).


-- =============================================================================
-- 001_init.sql
-- =============================================================================
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



-- =============================================================================
-- 002_customers.sql
-- =============================================================================
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



-- =============================================================================
-- 003_investments.sql
-- =============================================================================
CREATE SEQUENCE IF NOT EXISTS investment_code_seq START WITH 200;

CREATE OR REPLACE FUNCTION public.generate_investment_code()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  next_val BIGINT;
BEGIN
  next_val := nextval('investment_code_seq');
  RETURN 'INV-' || lpad(next_val::text, 6, '0');
END;
$$;

CREATE SEQUENCE IF NOT EXISTS transaction_code_seq START WITH 894721;

CREATE OR REPLACE FUNCTION public.generate_transaction_code()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  next_val BIGINT;
BEGIN
  next_val := nextval('transaction_code_seq');
  RETURN 'TXN-' || lpad(next_val::text, 6, '0');
END;
$$;

CREATE TABLE IF NOT EXISTS investments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers (id) ON DELETE RESTRICT,
  code TEXT NOT NULL UNIQUE DEFAULT public.generate_investment_code(),
  request_id TEXT,
  name TEXT NOT NULL DEFAULT 'New Fund Request',
  status TEXT NOT NULL DEFAULT 'Pending'
    CHECK (status IN ('Pending', 'Under Review', 'Active', 'Closed', 'Rejected')),
  fund_amount NUMERIC(15, 2) NOT NULL CHECK (fund_amount > 0),
  current_value NUMERIC(15, 2) NOT NULL,
  invested_date DATE,
  interest_rate NUMERIC(8, 6) NOT NULL,
  tds_percent NUMERIC(8, 6) NOT NULL,
  completed_interest_periods INTEGER NOT NULL DEFAULT 0,
  total_earnings NUMERIC(15, 2) NOT NULL DEFAULT 0,
  tds_deducted_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
  bank_account_id UUID NOT NULL REFERENCES bank_accounts (id),
  nominee_id UUID NOT NULL REFERENCES nominees (id),
  pay_date DATE NOT NULL,
  agreement_charges NUMERIC(15, 2) NOT NULL DEFAULT 0,
  payout_day INTEGER NOT NULL DEFAULT 10
    CHECK (payout_day = ANY (ARRAY[1, 5, 10, 15, 20, 25])),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS investments_request_id_unique
  ON investments (request_id)
  WHERE request_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS investments_customer_name_idx
  ON investments (customer_id, lower(btrim(name)));

CREATE INDEX IF NOT EXISTS investments_client_created_idx
  ON investments (client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS investments_client_status_idx
  ON investments (client_id, status);

CREATE INDEX IF NOT EXISTS investments_customer_idx
  ON investments (customer_id);

CREATE OR REPLACE FUNCTION public.generate_request_id()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  alphabet TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result TEXT;
  i INTEGER;
  attempts INTEGER := 0;
BEGIN
  LOOP
    result := '';
    FOR i IN 1..10 LOOP
      result := result || substr(
        alphabet,
        1 + floor(random() * length(alphabet))::INTEGER,
        1
      );
    END LOOP;

    IF NOT EXISTS (
      SELECT 1 FROM public.investments WHERE request_id = result
    ) THEN
      RETURN result;
    END IF;

    attempts := attempts + 1;
    IF attempts > 40 THEN
      RAISE EXCEPTION 'Could not generate a unique 10-character request id.';
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_set_investment_request_id()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.request_id IS NULL OR btrim(NEW.request_id) = '' THEN
    NEW.request_id := public.generate_request_id();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_investment_set_request_id ON investments;
CREATE TRIGGER trg_investment_set_request_id
  BEFORE INSERT ON investments
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_set_investment_request_id();

CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers (id) ON DELETE RESTRICT,
  transaction_code TEXT NOT NULL UNIQUE DEFAULT public.generate_transaction_code(),
  transaction_type TEXT NOT NULL
    CHECK (transaction_type IN ('instant_credit', 'withdrawal', 'referral_bonus')),
  amount NUMERIC(15, 2) NOT NULL,
  investment_id UUID REFERENCES investments (id),
  investment_plan_id TEXT NOT NULL,
  reference_id TEXT,
  transaction_date DATE NOT NULL,
  source_type TEXT NOT NULL
    CHECK (source_type IN ('investment', 'withdrawal')),
  source_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT transactions_source_unique UNIQUE (source_type, source_id)
);

CREATE INDEX IF NOT EXISTS transactions_client_date_idx
  ON transactions (client_id, transaction_date DESC);

CREATE INDEX IF NOT EXISTS transactions_customer_idx
  ON transactions (customer_id);

CREATE INDEX IF NOT EXISTS transactions_investment_idx
  ON transactions (investment_id);

CREATE OR REPLACE FUNCTION public.create_investment_transaction()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'Active'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    INSERT INTO public.transactions (
      client_id,
      customer_id,
      transaction_type,
      amount,
      investment_id,
      investment_plan_id,
      reference_id,
      transaction_date,
      source_type,
      source_id
    )
    VALUES (
      NEW.client_id,
      NEW.customer_id,
      'instant_credit',
      NEW.fund_amount,
      NEW.id,
      NEW.code,
      NULL,
      COALESCE(NEW.invested_date, NEW.pay_date, (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE),
      'investment',
      NEW.id
    )
    ON CONFLICT (source_type, source_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_investment_active_transaction ON investments;
CREATE TRIGGER trg_investment_active_transaction
  AFTER INSERT OR UPDATE OF status ON investments
  FOR EACH ROW
  EXECUTE FUNCTION public.create_investment_transaction();



-- =============================================================================
-- 004_client_ops.sql
-- =============================================================================
CREATE OR REPLACE FUNCTION public.admin_ist_today()
RETURNS DATE
LANGUAGE sql
STABLE
AS $$
  SELECT (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE;
$$;

CREATE OR REPLACE FUNCTION public.admin_monthly_interest(p_principal NUMERIC, p_rate NUMERIC)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ROUND(COALESCE(p_principal, 0) * COALESCE(p_rate, 0), 2);
$$;

CREATE OR REPLACE FUNCTION public.admin_monthly_tds(p_principal NUMERIC, p_rate NUMERIC, p_tds NUMERIC)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ROUND(public.admin_monthly_interest(p_principal, p_rate) * COALESCE(p_tds, 0), 2);
$$;

CREATE OR REPLACE FUNCTION public.admin_monthly_net(p_principal NUMERIC, p_rate NUMERIC, p_tds NUMERIC)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT public.admin_monthly_interest(p_principal, p_rate)
       - public.admin_monthly_tds(p_principal, p_rate, p_tds);
$$;

CREATE OR REPLACE FUNCTION public.admin_india_fy_start(p_date DATE)
RETURNS DATE
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN EXTRACT(MONTH FROM p_date) >= 4
      THEN make_date(EXTRACT(YEAR FROM p_date)::INT, 4, 1)
    ELSE make_date(EXTRACT(YEAR FROM p_date)::INT - 1, 4, 1)
  END;
$$;

CREATE OR REPLACE FUNCTION public.admin_india_fy_quarter(p_date DATE)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN EXTRACT(MONTH FROM p_date) BETWEEN 4 AND 6 THEN 1
    WHEN EXTRACT(MONTH FROM p_date) BETWEEN 7 AND 9 THEN 2
    WHEN EXTRACT(MONTH FROM p_date) BETWEEN 10 AND 12 THEN 3
    ELSE 4
  END;
$$;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'transactions'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%source_type%'
  LOOP
    EXECUTE 'ALTER TABLE transactions DROP CONSTRAINT ' || quote_ident(r.conname);
  END LOOP;
END
$$;

ALTER TABLE transactions
  ADD CONSTRAINT transactions_source_type_check
  CHECK (source_type IN ('investment', 'withdrawal', 'referral'));

ALTER TABLE investments
  ADD COLUMN IF NOT EXISTS referrer_customer_id UUID REFERENCES customers (id) ON DELETE SET NULL;

ALTER TABLE investments
  ADD COLUMN IF NOT EXISTS referral_code TEXT;

CREATE INDEX IF NOT EXISTS investments_referrer_idx
  ON investments (referrer_customer_id);

CREATE TABLE IF NOT EXISTS withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers (id) ON DELETE RESTRICT,
  investment_id UUID NOT NULL REFERENCES investments (id),
  bank_account_id UUID NOT NULL REFERENCES bank_accounts (id),
  request_id TEXT,
  status TEXT NOT NULL DEFAULT 'Processing'
    CHECK (status IN ('Processing', 'On Hold', 'Approved', 'Paid', 'Rejected')),
  withdrawal_amount NUMERIC(15, 2) NOT NULL CHECK (withdrawal_amount > 0),
  strategy TEXT NOT NULL DEFAULT 'full'
    CHECK (strategy IN ('full', 'partial')),
  requested_on DATE NOT NULL DEFAULT public.admin_ist_today(),
  net_payout NUMERIC(15, 2),
  status_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS withdrawals_request_id_unique
  ON withdrawals (request_id)
  WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS withdrawals_client_created_idx
  ON withdrawals (client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS withdrawals_client_status_idx
  ON withdrawals (client_id, status);

CREATE INDEX IF NOT EXISTS withdrawals_investment_idx
  ON withdrawals (investment_id);

CREATE OR REPLACE FUNCTION public.generate_request_id()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  alphabet TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result TEXT;
  i INTEGER;
  attempts INTEGER := 0;
BEGIN
  LOOP
    result := '';
    FOR i IN 1..10 LOOP
      result := result || substr(
        alphabet,
        1 + floor(random() * length(alphabet))::INTEGER,
        1
      );
    END LOOP;

    IF NOT EXISTS (SELECT 1 FROM public.investments WHERE request_id = result)
       AND NOT EXISTS (SELECT 1 FROM public.withdrawals WHERE request_id = result) THEN
      RETURN result;
    END IF;

    attempts := attempts + 1;
    IF attempts > 40 THEN
      RAISE EXCEPTION 'Could not generate a unique 10-character request id.';
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_set_withdrawal_request_id()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.request_id IS NULL OR btrim(NEW.request_id) = '' THEN
    NEW.request_id := public.generate_request_id();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_withdrawal_set_request_id ON withdrawals;
CREATE TRIGGER trg_withdrawal_set_request_id
  BEFORE INSERT ON withdrawals
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_set_withdrawal_request_id();

CREATE OR REPLACE FUNCTION public.admin_withdrawal_settlement(
  p_strategy TEXT,
  p_withdrawal_amount NUMERIC,
  p_total_earnings NUMERIC,
  p_tds_percent NUMERIC,
  p_stored_net NUMERIC
)
RETURNS JSON
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_tds NUMERIC(15, 2);
  v_net NUMERIC(15, 2);
  v_rate NUMERIC := COALESCE(p_tds_percent, 0.10);
  v_amount NUMERIC := COALESCE(p_withdrawal_amount, 0);
BEGIN
  IF p_stored_net IS NOT NULL THEN
    v_net := p_stored_net;
    v_tds := GREATEST(ROUND(v_amount - v_net, 2), 0);
  ELSE
    IF lower(COALESCE(p_strategy, 'full')) = 'full' THEN
      v_tds := ROUND(GREATEST(COALESCE(p_total_earnings, 0), 0) * v_rate, 2);
    ELSE
      v_tds := 0;
    END IF;
    v_net := GREATEST(ROUND(v_amount - v_tds, 2), 0);
  END IF;

  RETURN json_build_object('tds_amount', v_tds, 'net_payout', v_net);
END;
$$;

CREATE OR REPLACE FUNCTION public.process_investment_interest(p_investment_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  inv RECORD;
  v_today DATE := public.admin_ist_today();
  v_days INTEGER;
  v_completed_periods INTEGER;
  v_new_periods INTEGER;
  v_monthly_interest NUMERIC(15, 2);
  v_monthly_tds NUMERIC(15, 2);
  v_monthly_net NUMERIC(15, 2);
BEGIN
  SELECT
    id,
    fund_amount,
    interest_rate,
    tds_percent,
    invested_date,
    completed_interest_periods,
    total_earnings,
    tds_deducted_amount
  INTO inv
  FROM public.investments
  WHERE id = p_investment_id
    AND status = 'Active'
    AND invested_date IS NOT NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_days := v_today - inv.invested_date;
  IF v_days < 30 THEN
    RETURN;
  END IF;

  v_completed_periods := v_days / 30;
  v_new_periods := v_completed_periods - inv.completed_interest_periods;
  IF v_new_periods <= 0 THEN
    RETURN;
  END IF;

  v_monthly_interest := ROUND(inv.fund_amount * inv.interest_rate, 2);
  v_monthly_tds := ROUND(v_monthly_interest * inv.tds_percent, 2);
  v_monthly_net := v_monthly_interest - v_monthly_tds;

  UPDATE public.investments
  SET
    completed_interest_periods = v_completed_periods,
    tds_deducted_amount = inv.tds_deducted_amount + (v_monthly_tds * v_new_periods),
    total_earnings = inv.total_earnings + (v_monthly_net * v_new_periods),
    current_value = inv.fund_amount + inv.total_earnings + (v_monthly_net * v_new_periods),
    updated_at = NOW()
  WHERE id = inv.id
    AND completed_interest_periods = inv.completed_interest_periods;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_withdrawal_request()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_principal NUMERIC(15, 2);
  v_total_earnings NUMERIC(15, 2);
  v_current_value NUMERIC(15, 2);
  v_full_amount NUMERIC(15, 2);
  v_min NUMERIC(15, 2);
BEGIN
  SELECT fund_amount, total_earnings, current_value
  INTO v_principal, v_total_earnings, v_current_value
  FROM public.investments
  WHERE id = NEW.investment_id
    AND customer_id = NEW.customer_id
    AND client_id = NEW.client_id
    AND status = 'Active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active investment not found for withdrawal.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.withdrawals w
    WHERE w.investment_id = NEW.investment_id
      AND w.status IN ('Processing', 'On Hold')
      AND w.id IS DISTINCT FROM NEW.id
  ) THEN
    RAISE EXCEPTION 'This investment already has an open withdrawal request.';
  END IF;

  SELECT min_investment_amount
  INTO v_min
  FROM public.client_settings
  WHERE client_id = NEW.client_id;

  v_min := COALESCE(v_min, 100000);

  IF NEW.strategy = 'partial' THEN
    IF NEW.withdrawal_amount <= 0 THEN
      RAISE EXCEPTION 'Withdrawal amount must be greater than zero.';
    END IF;
    IF NEW.withdrawal_amount >= v_principal THEN
      RAISE EXCEPTION 'Use full withdrawal to withdraw the entire principal.';
    END IF;
    IF (v_principal - NEW.withdrawal_amount) < v_min THEN
      RAISE EXCEPTION 'Minimum remaining principal after partial withdrawal is â‚¹%.',
        to_char(v_min, 'FM999,999,999,990');
    END IF;
  ELSE
    v_full_amount := COALESCE(v_current_value, v_principal + COALESCE(v_total_earnings, 0));
    IF ABS(NEW.withdrawal_amount - v_full_amount) > 0.01 THEN
      RAISE EXCEPTION 'Full withdrawal amount must equal current investment value.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_withdrawal_request ON withdrawals;
CREATE TRIGGER trg_validate_withdrawal_request
  BEFORE INSERT ON withdrawals
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_withdrawal_request();

CREATE OR REPLACE FUNCTION public.close_investment_on_withdrawal_approved()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_inv RECORD;
  v_new_principal NUMERIC(15, 2);
  v_min NUMERIC(15, 2);
BEGIN
  IF NEW.status = 'Approved'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    IF NEW.strategy = 'partial' THEN
      PERFORM public.process_investment_interest(NEW.investment_id);

      SELECT id, fund_amount, total_earnings, client_id
      INTO v_inv
      FROM public.investments
      WHERE id = NEW.investment_id
        AND status = 'Active'
      FOR UPDATE;

      IF NOT FOUND THEN
        RETURN NEW;
      END IF;

      SELECT min_investment_amount INTO v_min
      FROM public.client_settings
      WHERE client_id = v_inv.client_id;
      v_min := COALESCE(v_min, 100000);

      v_new_principal := v_inv.fund_amount - NEW.withdrawal_amount;
      IF v_new_principal < v_min THEN
        RAISE EXCEPTION 'Partial withdrawal would leave principal below minimum balance.';
      END IF;

      UPDATE public.investments
      SET
        fund_amount = v_new_principal,
        invested_date = public.admin_ist_today(),
        completed_interest_periods = 0,
        current_value = v_new_principal + COALESCE(total_earnings, 0),
        updated_at = NOW()
      WHERE id = NEW.investment_id
        AND status = 'Active';
    ELSE
      UPDATE public.investments
      SET status = 'Closed', updated_at = NOW()
      WHERE id = NEW.investment_id
        AND status = 'Active';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_withdrawal_approved_close_investment ON withdrawals;
CREATE TRIGGER trg_withdrawal_approved_close_investment
  AFTER INSERT OR UPDATE OF status ON withdrawals
  FOR EACH ROW
  EXECUTE FUNCTION public.close_investment_on_withdrawal_approved();

CREATE OR REPLACE FUNCTION public.create_withdrawal_transaction()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  plan_code TEXT;
BEGIN
  IF NEW.status = 'Paid'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    SELECT code INTO plan_code
    FROM public.investments
    WHERE id = NEW.investment_id;

    INSERT INTO public.transactions (
      client_id,
      customer_id,
      transaction_type,
      amount,
      investment_id,
      investment_plan_id,
      reference_id,
      transaction_date,
      source_type,
      source_id
    )
    VALUES (
      NEW.client_id,
      NEW.customer_id,
      'withdrawal',
      COALESCE(NEW.net_payout, NEW.withdrawal_amount),
      NEW.investment_id,
      COALESCE(plan_code, 'â€”'),
      NULL,
      COALESCE(NEW.requested_on, public.admin_ist_today()),
      'withdrawal',
      NEW.id
    )
    ON CONFLICT (source_type, source_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_withdrawal_paid_transaction ON withdrawals;
CREATE TRIGGER trg_withdrawal_paid_transaction
  AFTER INSERT OR UPDATE OF status ON withdrawals
  FOR EACH ROW
  EXECUTE FUNCTION public.create_withdrawal_transaction();

CREATE TABLE IF NOT EXISTS referral_rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  referrer_customer_id UUID NOT NULL REFERENCES customers (id) ON DELETE RESTRICT,
  referred_customer_id UUID NOT NULL REFERENCES customers (id) ON DELETE RESTRICT,
  investment_id UUID NOT NULL UNIQUE REFERENCES investments (id) ON DELETE CASCADE,
  referral_code TEXT NOT NULL,
  capital_amount NUMERIC(15, 2) NOT NULL,
  referral_rate NUMERIC(8, 6) NOT NULL,
  gross_bonus NUMERIC(15, 2) NOT NULL,
  tds_rate NUMERIC(8, 6) NOT NULL,
  tds_amount NUMERIC(15, 2) NOT NULL,
  net_bonus NUMERIC(15, 2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending'
    CHECK (status IN ('Pending', 'Paid')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS referral_rewards_client_idx
  ON referral_rewards (client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS referral_rewards_referrer_idx
  ON referral_rewards (referrer_customer_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.create_referral_reward_on_investment_active()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_settings RECORD;
  v_gross NUMERIC(15, 2);
  v_tds NUMERIC(15, 2);
  v_net NUMERIC(15, 2);
  v_code TEXT;
BEGIN
  IF NEW.status <> 'Active'
     OR NOT (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    RETURN NEW;
  END IF;

  IF NEW.referrer_customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.referrer_customer_id = NEW.customer_id THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM public.referral_rewards WHERE investment_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  SELECT referral_rate, referral_tds_rate
  INTO v_settings
  FROM public.client_settings
  WHERE client_id = NEW.client_id;

  IF v_settings IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT referral_code INTO v_code
  FROM public.customers
  WHERE id = NEW.referrer_customer_id;

  v_gross := ROUND(NEW.fund_amount * v_settings.referral_rate, 2);
  v_tds := ROUND(v_gross * v_settings.referral_tds_rate, 2);
  v_net := ROUND(v_gross - v_tds, 2);

  INSERT INTO public.referral_rewards (
    client_id,
    referrer_customer_id,
    referred_customer_id,
    investment_id,
    referral_code,
    capital_amount,
    referral_rate,
    gross_bonus,
    tds_rate,
    tds_amount,
    net_bonus,
    status
  )
  VALUES (
    NEW.client_id,
    NEW.referrer_customer_id,
    NEW.customer_id,
    NEW.id,
    COALESCE(NULLIF(btrim(NEW.referral_code), ''), v_code, ''),
    NEW.fund_amount,
    v_settings.referral_rate,
    v_gross,
    v_settings.referral_tds_rate,
    v_tds,
    v_net,
    'Pending'
  )
  ON CONFLICT (investment_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_investment_active_referral ON investments;
CREATE TRIGGER trg_investment_active_referral
  AFTER INSERT OR UPDATE OF status ON investments
  FOR EACH ROW
  EXECUTE FUNCTION public.create_referral_reward_on_investment_active();

CREATE TABLE IF NOT EXISTS generated_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  report_name TEXT NOT NULL,
  report_type TEXT NOT NULL,
  date_from DATE,
  date_to DATE,
  date_range_label TEXT NOT NULL,
  generated_by TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('xlsx', 'csv', 'pdf')),
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS generated_reports_client_idx
  ON generated_reports (client_id, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_notification_reads (
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  notice_key TEXT NOT NULL,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, notice_key)
);

CREATE OR REPLACE FUNCTION public.wealth_as_of(p_client_id UUID, p_as_of DATE)
RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(i.fund_amount + COALESCE(i.total_earnings, 0)), 0)
  FROM investments i
  WHERE i.client_id = p_client_id
    AND i.invested_date IS NOT NULL
    AND i.invested_date <= p_as_of
    AND (
      i.status = 'Active'
      OR (
        i.status = 'Closed'
        AND (i.updated_at AT TIME ZONE 'Asia/Kolkata')::DATE > p_as_of
      )
    );
$$;



-- =============================================================================
-- 005_customer_notifications.sql
-- =============================================================================
CREATE TABLE IF NOT EXISTS customer_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('investment', 'withdrawal')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
  reference_id UUID,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS customer_notifications_customer_created_idx
  ON customer_notifications (customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS customer_notifications_customer_unread_idx
  ON customer_notifications (customer_id)
  WHERE is_read = FALSE;

CREATE OR REPLACE FUNCTION public.trg_notify_investment_decision()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.status IS DISTINCT FROM NEW.status
     AND OLD.status IN ('Pending', 'Under Review')
     AND NEW.status IN ('Active', 'Rejected') THEN
    INSERT INTO customer_notifications (
      client_id,
      customer_id,
      kind,
      title,
      body,
      reference_id,
      decision
    ) VALUES (
      NEW.client_id,
      NEW.customer_id,
      'investment',
      CASE
        WHEN NEW.status = 'Active' THEN 'Investment approved'
        ELSE 'Investment rejected'
      END,
      CASE
        WHEN NEW.status = 'Active' THEN
          'Your fund request "' || COALESCE(NEW.name, NEW.code) ||
          '" for â‚¹' || to_char(NEW.fund_amount, 'FM9999999990.00') ||
          ' has been approved.'
        ELSE
          'Your fund request "' || COALESCE(NEW.name, NEW.code) ||
          '" for â‚¹' || to_char(NEW.fund_amount, 'FM9999999990.00') ||
          ' has been rejected.'
      END,
      NEW.id,
      CASE WHEN NEW.status = 'Active' THEN 'approved' ELSE 'rejected' END
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_investment_decision ON investments;
CREATE TRIGGER trg_notify_investment_decision
  AFTER UPDATE OF status ON investments
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_notify_investment_decision();

CREATE OR REPLACE FUNCTION public.trg_notify_withdrawal_decision()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.status IS DISTINCT FROM NEW.status
     AND OLD.status IN ('Processing', 'On Hold')
     AND NEW.status IN ('Approved', 'Rejected') THEN
    INSERT INTO customer_notifications (
      client_id,
      customer_id,
      kind,
      title,
      body,
      reference_id,
      decision
    ) VALUES (
      NEW.client_id,
      NEW.customer_id,
      'withdrawal',
      CASE
        WHEN NEW.status = 'Approved' THEN 'Withdrawal approved'
        ELSE 'Withdrawal rejected'
      END,
      CASE
        WHEN NEW.status = 'Approved' THEN
          'Your withdrawal request for â‚¹' ||
          to_char(NEW.withdrawal_amount, 'FM9999999990.00') ||
          ' has been approved.'
        ELSE
          'Your withdrawal request for â‚¹' ||
          to_char(NEW.withdrawal_amount, 'FM9999999990.00') ||
          ' has been rejected.'
      END,
      NEW.id,
      CASE WHEN NEW.status = 'Approved' THEN 'approved' ELSE 'rejected' END
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_withdrawal_decision ON withdrawals;
CREATE TRIGGER trg_notify_withdrawal_decision
  AFTER UPDATE OF status ON withdrawals
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_notify_withdrawal_decision();



-- =============================================================================
-- 006_nominee_identity.sql
-- =============================================================================
ALTER TABLE nominees
  ADD COLUMN IF NOT EXISTS nominee_pan TEXT;

ALTER TABLE nominees
  ADD COLUMN IF NOT EXISTS nominee_mobile TEXT;



-- =============================================================================
-- 007_investment_referral_rate.sql
-- =============================================================================
ALTER TABLE investments
  ADD COLUMN IF NOT EXISTS referral_rate NUMERIC(8, 6);

UPDATE investments i
SET referral_rate = COALESCE(s.referral_rate, 0.01)
FROM client_settings s
WHERE s.client_id = i.client_id
  AND i.referral_rate IS NULL;

UPDATE investments
SET referral_rate = 0.01
WHERE referral_rate IS NULL;

ALTER TABLE investments
  ALTER COLUMN referral_rate SET DEFAULT 0.01;

ALTER TABLE investments
  ALTER COLUMN referral_rate SET NOT NULL;

CREATE OR REPLACE FUNCTION public.create_referral_reward_on_investment_active()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_settings RECORD;
  v_rate NUMERIC(8, 6);
  v_tds_rate NUMERIC(8, 6);
  v_gross NUMERIC(15, 2);
  v_tds NUMERIC(15, 2);
  v_net NUMERIC(15, 2);
  v_code TEXT;
BEGIN
  IF NEW.status <> 'Active'
     OR NOT (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    RETURN NEW;
  END IF;

  IF NEW.referrer_customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.referrer_customer_id = NEW.customer_id THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM public.referral_rewards WHERE investment_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  SELECT referral_rate, referral_tds_rate
  INTO v_settings
  FROM public.client_settings
  WHERE client_id = NEW.client_id;

  v_rate := COALESCE(NEW.referral_rate, v_settings.referral_rate, 0.01);
  v_tds_rate := COALESCE(v_settings.referral_tds_rate, 0.02);

  IF v_rate <= 0 OR v_rate > 1 THEN
    RAISE EXCEPTION 'Referral rate must be between 0 and 1.';
  END IF;

  SELECT referral_code INTO v_code
  FROM public.customers
  WHERE id = NEW.referrer_customer_id;

  v_gross := ROUND(NEW.fund_amount * v_rate, 2);
  v_tds := ROUND(v_gross * v_tds_rate, 2);
  v_net := ROUND(v_gross - v_tds, 2);

  INSERT INTO public.referral_rewards (
    client_id,
    referrer_customer_id,
    referred_customer_id,
    investment_id,
    referral_code,
    capital_amount,
    referral_rate,
    gross_bonus,
    tds_rate,
    tds_amount,
    net_bonus,
    status
  )
  VALUES (
    NEW.client_id,
    NEW.referrer_customer_id,
    NEW.customer_id,
    NEW.id,
    COALESCE(NULLIF(btrim(NEW.referral_code), ''), v_code, ''),
    NEW.fund_amount,
    v_rate,
    v_gross,
    v_tds_rate,
    v_tds,
    v_net,
    'Pending'
  )
  ON CONFLICT (investment_id) DO NOTHING;

  RETURN NEW;
END;
$$;



-- =============================================================================
-- 008_agreements.sql
-- =============================================================================
-- Tenant-scoped agreements, renewals, and cheque field presets.
-- Every client uses the same Ballari (30-day) / Raichur (60-day) templates.

CREATE TABLE IF NOT EXISTS agreement_renewal_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  investment_id UUID NOT NULL REFERENCES investments (id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  agreement_id TEXT NOT NULL,
  current_amount NUMERIC(15, 2) NOT NULL CHECK (current_amount > 0),
  increment_amount NUMERIC(15, 2) NULL,
  mode TEXT NOT NULL CHECK (mode IN ('same_amount', 'increase')),
  status TEXT NOT NULL DEFAULT 'Pending'
    CHECK (status IN ('Pending', 'Approved', 'Rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS agreement_renewals_pending_unique
  ON agreement_renewal_requests (investment_id)
  WHERE status = 'Pending';

CREATE INDEX IF NOT EXISTS agreement_renewals_client_status_idx
  ON agreement_renewal_requests (client_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS agreement_renewals_customer_idx
  ON agreement_renewal_requests (customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agreement_cheque_field_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  field_kind TEXT NOT NULL
    CHECK (field_kind IN ('cheque_no', 'bank_name', 'bank_address')),
  field_value TEXT NOT NULL,
  used_count INTEGER NOT NULL DEFAULT 1,
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS agreement_cheque_field_presets_unique
  ON agreement_cheque_field_presets (client_id, field_kind, lower(field_value));

CREATE INDEX IF NOT EXISTS agreement_cheque_field_presets_client_idx
  ON agreement_cheque_field_presets (client_id, field_kind, last_used_at DESC);

CREATE TABLE IF NOT EXISTS investment_agreements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  investment_id UUID NOT NULL REFERENCES investments (id) ON DELETE CASCADE,
  renewal_id UUID REFERENCES agreement_renewal_requests (id) ON DELETE CASCADE,
  branch TEXT NOT NULL CHECK (branch IN ('ballari', 'raichur')),
  agreement_date DATE NOT NULL,
  period_from DATE NOT NULL,
  period_to DATE NOT NULL,
  fund_amount NUMERIC(15, 2) NOT NULL,
  cheque_no TEXT NOT NULL,
  cheque_bank_name TEXT NOT NULL,
  cheque_bank_address TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS investment_agreements_original_unique
  ON investment_agreements (investment_id)
  WHERE renewal_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS investment_agreements_renewal_unique
  ON investment_agreements (renewal_id)
  WHERE renewal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS investment_agreements_client_idx
  ON investment_agreements (client_id, investment_id);

ALTER TABLE customer_notifications
  DROP CONSTRAINT IF EXISTS customer_notifications_kind_check;

ALTER TABLE customer_notifications
  ADD CONSTRAINT customer_notifications_kind_check
  CHECK (kind IN ('investment', 'withdrawal', 'renewal'));

CREATE OR REPLACE FUNCTION public.trg_notify_renewal_decision()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.status IS DISTINCT FROM NEW.status
     AND OLD.status = 'Pending'
     AND NEW.status IN ('Approved', 'Rejected') THEN
    INSERT INTO customer_notifications (
      client_id,
      customer_id,
      kind,
      title,
      body,
      reference_id,
      decision
    ) VALUES (
      NEW.client_id,
      NEW.customer_id,
      'renewal',
      CASE
        WHEN NEW.status = 'Approved' THEN 'Agreement renewal approved'
        ELSE 'Agreement renewal rejected'
      END,
      CASE
        WHEN NEW.status = 'Approved' THEN
          'Your agreement renewal for â‚¹' ||
          to_char(
            CASE
              WHEN NEW.mode = 'increase'
                THEN COALESCE(NEW.current_amount, 0) + COALESCE(NEW.increment_amount, 0)
              ELSE NEW.current_amount
            END,
            'FM9999999990.00'
          ) || ' has been approved. A new 365-day term starts today.'
        ELSE
          'Your agreement renewal request has been rejected.'
      END,
      NEW.id,
      CASE WHEN NEW.status = 'Approved' THEN 'approved' ELSE 'rejected' END
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_renewal_decision ON agreement_renewal_requests;
CREATE TRIGGER trg_notify_renewal_decision
  AFTER UPDATE OF status ON agreement_renewal_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_notify_renewal_decision();



-- =============================================================================
-- 009_customer_email_mobile_combo.sql
-- =============================================================================
DROP INDEX IF EXISTS customers_mobile_unique_idx;
DROP INDEX IF EXISTS customers_email_lower_idx;

CREATE UNIQUE INDEX IF NOT EXISTS customers_email_mobile_combo_idx
  ON customers (mobile_number, lower(email_address));



-- =============================================================================
-- 010_email_mobile_combo_per_client.sql
-- =============================================================================
DROP INDEX IF EXISTS customers_email_mobile_combo_idx;

CREATE UNIQUE INDEX IF NOT EXISTS customers_email_mobile_combo_idx
  ON customers (client_id, mobile_number, lower(email_address));



-- =============================================================================
-- 011_tenant_investment_isolation.sql
-- =============================================================================
CREATE UNIQUE INDEX IF NOT EXISTS customers_id_client_idx
  ON customers (id, client_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'investments_customer_client_fk'
  ) THEN
    ALTER TABLE investments
      ADD CONSTRAINT investments_customer_client_fk
      FOREIGN KEY (customer_id, client_id)
      REFERENCES customers (id, client_id)
      ON DELETE RESTRICT;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'withdrawals'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'withdrawals_customer_client_fk'
  ) THEN
    ALTER TABLE withdrawals
      ADD CONSTRAINT withdrawals_customer_client_fk
      FOREIGN KEY (customer_id, client_id)
      REFERENCES customers (id, client_id)
      ON DELETE RESTRICT;
  END IF;
END
$$;



-- =============================================================================
-- 012_client_agreement_party.sql
-- =============================================================================
ALTER TABLE client_settings
  ADD COLUMN IF NOT EXISTS second_party_name TEXT,
  ADD COLUMN IF NOT EXISTS second_party_ballari_address TEXT,
  ADD COLUMN IF NOT EXISTS second_party_ballari_phone TEXT,
  ADD COLUMN IF NOT EXISTS second_party_ballari_email TEXT,
  ADD COLUMN IF NOT EXISTS second_party_raichur_address TEXT,
  ADD COLUMN IF NOT EXISTS second_party_raichur_phone TEXT,
  ADD COLUMN IF NOT EXISTS second_party_raichur_email TEXT,
  ADD COLUMN IF NOT EXISTS second_party_nominee_name TEXT,
  ADD COLUMN IF NOT EXISTS second_party_nominee_aadhaar TEXT,
  ADD COLUMN IF NOT EXISTS second_party_nominee_pan TEXT,
  ADD COLUMN IF NOT EXISTS second_party_nominee_relation TEXT,
  ADD COLUMN IF NOT EXISTS second_party_nominee_phone TEXT;

UPDATE client_settings s
SET
  second_party_name = 'Mr. VENKATESH C',
  second_party_ballari_address = 'Basava Krupa, 1st Floor, House No 13, Ward No 32, Sanjay Gandhi Nagar, Opposite Fire station, Infantry Road, Ballari District, Karnataka-583104',
  second_party_ballari_phone = '8123852228',
  second_party_ballari_email = 'venkateshtradersc@gmail.com',
  second_party_raichur_address = 'Shop No: 13, 1st Floor, Santoshi Hub, Gandhi Chowk, Raichur-District, Karnataka-584101',
  second_party_raichur_phone = '7795707027',
  second_party_raichur_email = 'venkatesh.venku939@gmail.com',
  second_party_nominee_name = 'K C Rama Krishna',
  second_party_nominee_aadhaar = '243721867145',
  second_party_nominee_pan = 'CIEPR7427L',
  second_party_nominee_relation = 'Brother',
  second_party_nominee_phone = '9900210713'
FROM clients c
WHERE c.id = s.client_id
  AND lower(c.client_code) = 'vtinvest'
  AND (s.second_party_name IS NULL OR btrim(s.second_party_name) = '');



-- =============================================================================
-- 013_dynamic_agreement_offices.sql
-- =============================================================================
ALTER TABLE client_settings
  ADD COLUMN IF NOT EXISTS agreement_offices JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE client_settings s
SET agreement_offices = offices.docs
FROM (
  SELECT
    client_id,
    jsonb_agg(office ORDER BY sort_order) AS docs
  FROM (
    SELECT
      client_id,
      1 AS sort_order,
      jsonb_build_object(
        'id', gen_random_uuid()::text,
        'placeName', 'Ballari',
        'address', btrim(second_party_ballari_address),
        'phone', right(regexp_replace(COALESCE(second_party_ballari_phone, ''), '\D', '', 'g'), 10),
        'email', lower(btrim(second_party_ballari_email)),
        'noticeDays', 30
      ) AS office
    FROM client_settings
    WHERE btrim(COALESCE(second_party_ballari_address, '')) <> ''
    UNION ALL
    SELECT
      client_id,
      2 AS sort_order,
      jsonb_build_object(
        'id', gen_random_uuid()::text,
        'placeName', 'Raichur',
        'address', btrim(second_party_raichur_address),
        'phone', right(regexp_replace(COALESCE(second_party_raichur_phone, ''), '\D', '', 'g'), 10),
        'email', lower(btrim(second_party_raichur_email)),
        'noticeDays', 60
      ) AS office
    FROM client_settings
    WHERE btrim(COALESCE(second_party_raichur_address, '')) <> ''
  ) parts
  GROUP BY client_id
) offices
WHERE s.client_id = offices.client_id
  AND COALESCE(jsonb_array_length(s.agreement_offices), 0) = 0;

ALTER TABLE client_settings
  DROP COLUMN IF EXISTS second_party_ballari_address,
  DROP COLUMN IF EXISTS second_party_ballari_phone,
  DROP COLUMN IF EXISTS second_party_ballari_email,
  DROP COLUMN IF EXISTS second_party_raichur_address,
  DROP COLUMN IF EXISTS second_party_raichur_phone,
  DROP COLUMN IF EXISTS second_party_raichur_email;

ALTER TABLE investment_agreements
  DROP CONSTRAINT IF EXISTS investment_agreements_branch_check;

ALTER TABLE investment_agreements
  ADD COLUMN IF NOT EXISTS notice_days INTEGER;

UPDATE investment_agreements
SET notice_days = COALESCE(
  notice_days,
  CASE WHEN lower(branch) = 'raichur' THEN 60 ELSE 30 END
);

UPDATE investment_agreements
SET branch = 'Raichur'
WHERE lower(branch) = 'raichur';

UPDATE investment_agreements
SET branch = 'Ballari'
WHERE lower(branch) = 'ballari';



-- =============================================================================
-- 014_approved_investment_actions.sql
-- =============================================================================
ALTER TABLE bank_accounts
  ADD COLUMN IF NOT EXISTS branch_name TEXT NOT NULL DEFAULT '';


