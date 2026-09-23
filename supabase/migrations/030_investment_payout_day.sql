-- Persist Monthly Payout Cycle (day of month) from Investment Approval Console.
-- Mobile performs interest/payout calculations; admin only stores the selected day.

ALTER TABLE public.investments
  ADD COLUMN IF NOT EXISTS payout_day INTEGER;

UPDATE public.investments
SET payout_day = 10
WHERE payout_day IS NULL;

ALTER TABLE public.investments
  ALTER COLUMN payout_day SET DEFAULT 10;

ALTER TABLE public.investments
  ALTER COLUMN payout_day SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'investments_payout_day_allowed'
      AND conrelid = 'public.investments'::regclass
  ) THEN
    ALTER TABLE public.investments
      ADD CONSTRAINT investments_payout_day_allowed
      CHECK (payout_day = ANY (ARRAY[1, 5, 10, 15, 20, 25]));
  END IF;
END;
$$;

-- Detail payload includes payout_day
CREATE OR REPLACE FUNCTION public.admin_get_investment_request(p_id UUID)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSON;
BEGIN
  SELECT json_build_object(
    'id', i.id,
    'request_id', i.request_id,
    'status', i.status,
    'plan_name', i.name,
    'fund_amount', i.fund_amount,
    'interest_rate', i.interest_rate,
    'tds_percent', i.tds_percent,
    'payout_day', i.payout_day,
    'created_at', i.created_at,
    'user_id', i.user_id,
    'customer_name', p.full_name,
    'customer_id', c.customer_id,
    'active_portfolio', COALESCE((
      SELECT SUM(x.fund_amount) FROM public.investments x
      WHERE x.user_id = i.user_id AND x.status = 'Active'
    ), 0),
    'active_plans', COALESCE((
      SELECT COUNT(*) FROM public.investments x
      WHERE x.user_id = i.user_id AND x.status = 'Active'
    ), 0),
    'bank', CASE WHEN ba.id IS NULL THEN NULL ELSE json_build_object(
      'bank_name', ba.bank_name,
      'account_number', ba.account_number,
      'ifsc_code', ba.ifsc_code
    ) END
  )
  INTO v_result
  FROM public.investments i
  INNER JOIN public.profiles p ON p.user_id = i.user_id
  LEFT JOIN public.customers c ON c.user_id = i.user_id
  LEFT JOIN public.bank_accounts ba ON ba.id = i.bank_account_id
  WHERE i.id = p_id;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Investment request not found';
  END IF;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_investment_request(UUID) TO anon, authenticated;

-- Terms update now also saves payout_day
DROP FUNCTION IF EXISTS public.admin_update_investment_terms(UUID, NUMERIC, NUMERIC);

CREATE OR REPLACE FUNCTION public.admin_update_investment_terms(
  p_id UUID,
  p_interest_rate NUMERIC,
  p_tds_percent NUMERIC,
  p_payout_day INTEGER DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.investments%ROWTYPE;
  v_payout_day INTEGER;
BEGIN
  IF p_interest_rate IS NULL OR p_interest_rate <= 0 OR p_interest_rate > 1 THEN
    RAISE EXCEPTION 'Interest rate must be a decimal between 0 and 1 (e.g. 0.05).';
  END IF;

  IF p_tds_percent IS NULL OR p_tds_percent < 0 OR p_tds_percent > 1 THEN
    RAISE EXCEPTION 'TDS percent must be a decimal between 0 and 1.';
  END IF;

  SELECT * INTO v_row
  FROM public.investments
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Investment request not found';
  END IF;

  IF v_row.status NOT IN ('Pending', 'Under Review') THEN
    RAISE EXCEPTION 'Only pending or held requests can have terms updated.';
  END IF;

  v_payout_day := COALESCE(p_payout_day, v_row.payout_day, 10);

  IF NOT (v_payout_day = ANY (ARRAY[1, 5, 10, 15, 20, 25])) THEN
    RAISE EXCEPTION 'Payout day must be one of 1, 5, 10, 15, 20, or 25.';
  END IF;

  UPDATE public.investments
  SET
    interest_rate = p_interest_rate,
    tds_percent = p_tds_percent,
    payout_day = v_payout_day,
    updated_at = NOW()
  WHERE id = p_id
  RETURNING * INTO v_row;

  RETURN json_build_object(
    'id', v_row.id,
    'interest_rate', v_row.interest_rate,
    'tds_percent', v_row.tds_percent,
    'payout_day', v_row.payout_day,
    'status', v_row.status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_investment_terms(UUID, NUMERIC, NUMERIC, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_investment_terms(UUID, NUMERIC, NUMERIC, INTEGER) TO anon, authenticated;
