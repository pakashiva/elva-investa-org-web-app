-- Customer IDs, withdrawal request codes, registration uniqueness,
-- KYC paths optional, withdrawal open-request rules, mobile login lookup

-- ---------------------------------------------------------------------------
-- 1. Customers table (CUST-0001, CUST-0002, ...)
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS customer_id_seq START WITH 1;

CREATE OR REPLACE FUNCTION public.generate_customer_id()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  next_val BIGINT;
BEGIN
  next_val := nextval('customer_id_seq');
  RETURN 'CUST-' || lpad(next_val::text, 4, '0');
END;
$$;

CREATE TABLE IF NOT EXISTS public.customers (
  user_id UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL UNIQUE DEFAULT public.generate_customer_id(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "customers_select_own" ON public.customers;
CREATE POLICY "customers_select_own"
  ON public.customers FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.ensure_customer_for_user(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id TEXT;
BEGIN
  SELECT customer_id INTO v_customer_id
  FROM public.customers
  WHERE user_id = p_user_id;

  IF v_customer_id IS NOT NULL THEN
    RETURN v_customer_id;
  END IF;

  INSERT INTO public.customers (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
  RETURNING customer_id INTO v_customer_id;

  RETURN v_customer_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_ensure_customer_on_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.ensure_customer_for_user(NEW.user_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profile_ensure_customer ON public.profiles;
CREATE TRIGGER trg_profile_ensure_customer
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_ensure_customer_on_profile();

-- Backfill customers for existing profiles
INSERT INTO public.customers (user_id)
SELECT p.user_id
FROM public.profiles p
WHERE NOT EXISTS (
  SELECT 1 FROM public.customers c WHERE c.user_id = p.user_id
)
ON CONFLICT (user_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Withdrawal request_id via existing-style `code` column (INV already has code)
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS withdrawal_code_seq START WITH 1;

CREATE OR REPLACE FUNCTION public.generate_withdrawal_code()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  next_val BIGINT;
BEGIN
  next_val := nextval('withdrawal_code_seq');
  RETURN 'WDR-' || lpad(next_val::text, 6, '0');
END;
$$;

ALTER TABLE public.withdrawals
  ADD COLUMN IF NOT EXISTS code TEXT;

UPDATE public.withdrawals
SET code = public.generate_withdrawal_code()
WHERE code IS NULL;

ALTER TABLE public.withdrawals
  ALTER COLUMN code SET DEFAULT public.generate_withdrawal_code();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'withdrawals_code_key'
  ) THEN
    ALTER TABLE public.withdrawals ADD CONSTRAINT withdrawals_code_key UNIQUE (code);
  END IF;
END $$;

ALTER TABLE public.withdrawals
  ALTER COLUMN code SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. KYC document image paths optional (numbers only at registration)
-- ---------------------------------------------------------------------------
ALTER TABLE public.kyc_documents
  ALTER COLUMN aadhaar_front_path DROP NOT NULL;

ALTER TABLE public.kyc_documents
  ALTER COLUMN aadhaar_back_path DROP NOT NULL;

ALTER TABLE public.kyc_documents
  ALTER COLUMN pan_card_path DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Unique email + phone combination (normalized)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_mobile_digits(p_mobile TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN length(digits) = 12 AND left(digits, 2) = '91' THEN right(digits, 10)
    WHEN length(digits) > 10 THEN right(digits, 10)
    ELSE digits
  END
  FROM (
    SELECT regexp_replace(COALESCE(p_mobile, ''), '\D', '', 'g') AS digits
  ) s;
$$;

CREATE OR REPLACE FUNCTION public.normalize_email(p_email TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(trim(COALESCE(p_email, '')));
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_email_mobile_combo
  ON public.profiles (
    public.normalize_email(email_address),
    public.normalize_mobile_digits(mobile_number)
  );

CREATE OR REPLACE FUNCTION public.is_email_mobile_combo_available(
  p_email TEXT,
  p_mobile TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE public.normalize_email(email_address) = public.normalize_email(p_email)
      AND public.normalize_mobile_digits(mobile_number) = public.normalize_mobile_digits(p_mobile)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_email_mobile_combo_available(TEXT, TEXT) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Login helper: resolve email from mobile number
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_login_email_by_mobile(p_mobile TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
  v_digits TEXT := public.normalize_mobile_digits(p_mobile);
BEGIN
  IF v_digits IS NULL OR length(v_digits) < 10 THEN
    RETURN NULL;
  END IF;

  SELECT email_address
  INTO v_email
  FROM public.profiles
  WHERE public.normalize_mobile_digits(mobile_number) = v_digits
  ORDER BY created_at ASC
  LIMIT 1;

  RETURN v_email;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_login_email_by_mobile(TEXT) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Withdrawal open-request rules (full blocks; partial limited to remaining)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_withdrawal_request()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_principal NUMERIC(15, 2);
  v_total_earnings NUMERIC(15, 2);
  v_current_value NUMERIC(15, 2);
  v_full_amount NUMERIC(15, 2);
  v_open_full_count INTEGER;
  v_open_partial_sum NUMERIC(15, 2);
  v_available_principal NUMERIC(15, 2);
BEGIN
  SELECT fund_amount, total_earnings, current_value
  INTO v_principal, v_total_earnings, v_current_value
  FROM public.investments
  WHERE id = NEW.investment_id
    AND user_id = NEW.user_id
    AND status = 'Active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active investment not found for withdrawal.';
  END IF;

  SELECT COUNT(*)
  INTO v_open_full_count
  FROM public.withdrawals
  WHERE investment_id = NEW.investment_id
    AND status IN ('Processing', 'Approved')
    AND strategy = 'full';

  IF v_open_full_count > 0 THEN
    RAISE EXCEPTION 'A full withdrawal request is already open for this fund. Wait for it to be rejected before requesting again.';
  END IF;

  SELECT COALESCE(SUM(withdrawal_amount), 0)
  INTO v_open_partial_sum
  FROM public.withdrawals
  WHERE investment_id = NEW.investment_id
    AND status = 'Processing'
    AND strategy = 'partial';

  v_available_principal := v_principal - v_open_partial_sum;

  IF NEW.strategy = 'partial' THEN
    IF NEW.withdrawal_amount <= 0 THEN
      RAISE EXCEPTION 'Withdrawal amount must be greater than zero.';
    END IF;

    IF NEW.withdrawal_amount > v_available_principal THEN
      RAISE EXCEPTION 'Withdrawal amount exceeds available principal for this fund (₹%).',
        to_char(GREATEST(v_available_principal, 0), 'FM9999999990.00');
    END IF;

    IF NEW.withdrawal_amount >= v_principal THEN
      RAISE EXCEPTION 'Use full withdrawal to withdraw the entire principal.';
    END IF;

    IF (v_principal - v_open_partial_sum - NEW.withdrawal_amount) < 100000 THEN
      RAISE EXCEPTION 'Minimum remaining principal after partial withdrawal is ₹1,00,000.';
    END IF;
  ELSE
    IF v_open_partial_sum > 0 THEN
      RAISE EXCEPTION 'Clear or wait for open partial withdrawal requests before requesting a full withdrawal.';
    END IF;

    v_full_amount := COALESCE(v_current_value, v_principal + COALESCE(v_total_earnings, 0));
    IF ABS(NEW.withdrawal_amount - v_full_amount) > 0.01 THEN
      RAISE EXCEPTION 'Full withdrawal amount must equal current investment value.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_withdrawal_request ON public.withdrawals;
CREATE TRIGGER trg_validate_withdrawal_request
  BEFORE INSERT ON public.withdrawals
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_withdrawal_request();
