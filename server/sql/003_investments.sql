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
