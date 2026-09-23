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
      RAISE EXCEPTION 'Minimum remaining principal after partial withdrawal is ₹%.',
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
      COALESCE(plan_code, '—'),
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
