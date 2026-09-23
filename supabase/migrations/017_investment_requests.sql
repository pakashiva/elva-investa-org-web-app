-- Additive: request_id (nullable) and admin request statuses Hold/Reject.
-- Existing rows keep request_id NULL. Do not generate IDs here.

ALTER TABLE public.investments
  ADD COLUMN IF NOT EXISTS request_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS investments_request_id_unique
  ON public.investments (request_id)
  WHERE request_id IS NOT NULL;

ALTER TABLE public.investments DROP CONSTRAINT IF EXISTS investments_status_check;
ALTER TABLE public.investments
  ADD CONSTRAINT investments_status_check
  CHECK (status IN ('Pending', 'Under Review', 'Active', 'Closed', 'Rejected'));

COMMENT ON COLUMN public.investments.request_id IS
  'Admin-facing request code. Existing rows are NULL until assigned.';

-- ---------------------------------------------------------------------------
-- List
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_list_investment_requests(
  p_filter TEXT DEFAULT 'pending',
  p_search TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 10,
  p_offset INTEGER DEFAULT 0
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_filter TEXT := lower(COALESCE(p_filter, 'pending'));
  v_search TEXT := NULLIF(trim(COALESCE(p_search, '')), '');
  v_limit INTEGER := GREATEST(1, LEAST(COALESCE(p_limit, 10), 50));
  v_offset INTEGER := GREATEST(0, COALESCE(p_offset, 0));
  v_total BIGINT;
  v_rows JSON;
BEGIN
  WITH base AS (
    SELECT
      i.id,
      i.request_id,
      i.name AS plan_name,
      i.fund_amount,
      i.status,
      i.created_at,
      p.full_name AS customer_name,
      c.customer_id
    FROM public.investments i
    INNER JOIN public.profiles p ON p.user_id = i.user_id
    LEFT JOIN public.customers c ON c.user_id = i.user_id
    WHERE (
        v_search IS NULL
        OR COALESCE(i.request_id, '') ILIKE '%' || v_search || '%'
        OR p.full_name ILIKE '%' || v_search || '%'
        OR COALESCE(c.customer_id, '') ILIKE '%' || v_search || '%'
        OR i.name ILIKE '%' || v_search || '%'
      )
      AND CASE v_filter
        WHEN 'pending' THEN i.status = 'Pending'
        WHEN 'under_review' THEN i.status = 'Under Review'
        WHEN 'approved' THEN i.status IN ('Active', 'Closed')
        WHEN 'rejected' THEN i.status = 'Rejected'
        ELSE TRUE
      END
  ),
  paged AS (
    SELECT *
    FROM base
    ORDER BY created_at DESC
    LIMIT v_limit
    OFFSET v_offset
  )
  SELECT
    (SELECT COUNT(*) FROM base),
    COALESCE((SELECT json_agg(row_to_json(p)) FROM paged p), '[]'::JSON)
  INTO v_total, v_rows;

  RETURN json_build_object(
    'rows', v_rows,
    'total', COALESCE(v_total, 0),
    'limit', v_limit,
    'offset', v_offset
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_investment_requests(TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_investment_requests(TEXT, TEXT, INTEGER, INTEGER) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Detail
-- ---------------------------------------------------------------------------

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
    'created_at', i.created_at,
    'user_id', i.user_id,
    'customer_name', p.full_name,
    'customer_id', c.customer_id,
    'kyc_verified', EXISTS (
      SELECT 1 FROM public.investments x
      WHERE x.user_id = i.user_id
        AND x.status IN ('Active', 'Closed')
    ),
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
      'ifsc_code', ba.ifsc_code,
      'verified', EXISTS (
        SELECT 1
        FROM public.transactions t
        WHERE t.user_id = i.user_id
          AND (
            (
              t.source_type = 'investment'
              AND EXISTS (
                SELECT 1 FROM public.investments ix
                WHERE ix.id = t.source_id AND ix.bank_account_id = ba.id
              )
            )
            OR (
              t.source_type = 'withdrawal'
              AND EXISTS (
                SELECT 1 FROM public.withdrawals w
                WHERE w.id = t.source_id AND w.bank_account_id = ba.id
              )
            )
          )
      )
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

REVOKE ALL ON FUNCTION public.admin_get_investment_request(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_investment_request(UUID) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Update rate / TDS before decision
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_update_investment_terms(
  p_id UUID,
  p_interest_rate NUMERIC,
  p_tds_percent NUMERIC
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.investments%ROWTYPE;
BEGIN
  IF p_interest_rate IS NULL OR p_interest_rate <= 0 OR p_interest_rate > 1 THEN
    RAISE EXCEPTION 'Interest rate must be a decimal between 0 and 1 (e.g. 0.05).';
  END IF;

  IF p_tds_percent IS NULL OR p_tds_percent < 0 OR p_tds_percent > 1 THEN
    RAISE EXCEPTION 'TDS percent must be a decimal between 0 and 1.';
  END IF;

  UPDATE public.investments
  SET
    interest_rate = p_interest_rate,
    tds_percent = p_tds_percent,
    updated_at = NOW()
  WHERE id = p_id
    AND status IN ('Pending', 'Under Review')
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only pending or held requests can have terms updated.';
  END IF;

  RETURN json_build_object(
    'id', v_row.id,
    'interest_rate', v_row.interest_rate,
    'tds_percent', v_row.tds_percent,
    'status', v_row.status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_investment_terms(UUID, NUMERIC, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_investment_terms(UUID, NUMERIC, NUMERIC) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Approve / Hold / Reject
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_decide_investment(
  p_id UUID,
  p_action TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action TEXT := lower(trim(COALESCE(p_action, '')));
  v_row public.investments%ROWTYPE;
  v_today DATE := (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE;
BEGIN
  SELECT * INTO v_row
  FROM public.investments
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Investment request not found';
  END IF;

  IF v_row.status NOT IN ('Pending', 'Under Review') THEN
    RAISE EXCEPTION 'This request has already been decided.';
  END IF;

  IF v_action = 'approve' THEN
    UPDATE public.investments
    SET
      status = 'Active',
      invested_date = COALESCE(invested_date, v_today),
      current_value = fund_amount + COALESCE(total_earnings, 0),
      updated_at = NOW()
    WHERE id = p_id
    RETURNING * INTO v_row;
  ELSIF v_action = 'hold' THEN
    UPDATE public.investments
    SET
      status = 'Under Review',
      updated_at = NOW()
    WHERE id = p_id
    RETURNING * INTO v_row;
  ELSIF v_action = 'reject' THEN
    UPDATE public.investments
    SET
      status = 'Rejected',
      updated_at = NOW()
    WHERE id = p_id
    RETURNING * INTO v_row;
  ELSE
    RAISE EXCEPTION 'Action must be approve, hold, or reject.';
  END IF;

  RETURN json_build_object(
    'id', v_row.id,
    'request_id', v_row.request_id,
    'status', v_row.status,
    'fund_amount', v_row.fund_amount,
    'action', v_action
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_decide_investment(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_decide_investment(UUID, TEXT) TO anon, authenticated;
