-- Additive: On Hold status + admin list/decide RPCs for withdrawals.
-- Existing rows keep current status. Do not generate investment codes.

ALTER TABLE public.withdrawals DROP CONSTRAINT IF EXISTS withdrawals_status_check;
ALTER TABLE public.withdrawals
  ADD CONSTRAINT withdrawals_status_check
  CHECK (status IN ('Processing', 'On Hold', 'Approved', 'Paid', 'Rejected'));

COMMENT ON CONSTRAINT withdrawals_status_check ON public.withdrawals IS
  'Processing/On Hold are actionable. Approved then Paid posts the ledger.';

-- ---------------------------------------------------------------------------
-- Settlement: TDS on the interest portion of a full withdrawal.
-- Partial withdrawals are principal-only, so extra TDS is 0.
-- ---------------------------------------------------------------------------

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

REVOKE ALL ON FUNCTION public.admin_withdrawal_settlement(TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_withdrawal_settlement(TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- List
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_list_withdrawals(
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
      w.id,
      w.status,
      w.strategy,
      w.withdrawal_amount,
      w.requested_on,
      w.updated_at,
      w.created_at,
      p.full_name AS customer_name,
      i.code AS investment_code,
      i.name AS plan_name,
      i.fund_amount AS available_principal,
      i.total_earnings,
      i.tds_percent,
      ba.bank_name,
      ba.account_number,
      COALESCE(p.authorized, FALSE) AS agreement_ok,
      public.admin_withdrawal_settlement(
        w.strategy,
        w.withdrawal_amount,
        i.total_earnings,
        i.tds_percent,
        w.net_payout
      ) AS settlement
    FROM public.withdrawals w
    INNER JOIN public.investments i ON i.id = w.investment_id
    INNER JOIN public.profiles p ON p.user_id = w.user_id
    LEFT JOIN public.bank_accounts ba ON ba.id = w.bank_account_id
    WHERE (
        v_search IS NULL
        OR p.full_name ILIKE '%' || v_search || '%'
        OR i.code ILIKE '%' || v_search || '%'
        OR COALESCE(ba.bank_name, '') ILIKE '%' || v_search || '%'
      )
      AND CASE v_filter
        WHEN 'pending' THEN w.status IN ('Processing', 'On Hold')
        WHEN 'approved' THEN w.status IN ('Approved', 'Paid')
        WHEN 'rejected' THEN w.status = 'Rejected'
        ELSE TRUE
      END
  ),
  paged AS (
    SELECT *
    FROM base
    ORDER BY requested_on DESC, created_at DESC
    LIMIT v_limit
    OFFSET v_offset
  )
  SELECT
    (SELECT COUNT(*) FROM base),
    COALESCE(
      (
        SELECT json_agg(json_build_object(
          'id', p.id,
          'status', p.status,
          'strategy', p.strategy,
          'customer_name', p.customer_name,
          'investment_code', p.investment_code,
          'plan_name', p.plan_name,
          'available_principal', p.available_principal,
          'withdrawal_amount', p.withdrawal_amount,
          'tds_amount', (p.settlement->>'tds_amount')::NUMERIC,
          'tds_percent', p.tds_percent,
          'net_payout', (p.settlement->>'net_payout')::NUMERIC,
          'bank_name', p.bank_name,
          'account_number', p.account_number,
          'requested_on', p.requested_on,
          'updated_at', p.updated_at,
          'agreement_ok', p.agreement_ok
        ) ORDER BY p.requested_on DESC, p.created_at DESC)
        FROM paged p
      ),
      '[]'::JSON
    )
  INTO v_total, v_rows;

  RETURN json_build_object(
    'rows', v_rows,
    'total', COALESCE(v_total, 0),
    'limit', v_limit,
    'offset', v_offset
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_withdrawals(TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_withdrawals(TEXT, TEXT, INTEGER, INTEGER) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Approve / Hold / Reject
-- Approve writes Approved first (investment trigger), then Paid (ledger trigger).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_decide_withdrawal(
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
  v_row public.withdrawals%ROWTYPE;
  v_inv public.investments%ROWTYPE;
  v_settlement JSON;
  v_net NUMERIC(15, 2);
BEGIN
  SELECT * INTO v_row
  FROM public.withdrawals
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Withdrawal request not found';
  END IF;

  IF v_row.status NOT IN ('Processing', 'On Hold') THEN
    RAISE EXCEPTION 'This withdrawal has already been decided.';
  END IF;

  SELECT * INTO v_inv
  FROM public.investments
  WHERE id = v_row.investment_id;

  IF v_action = 'approve' THEN
    v_settlement := public.admin_withdrawal_settlement(
      v_row.strategy,
      v_row.withdrawal_amount,
      v_inv.total_earnings,
      v_inv.tds_percent,
      NULL
    );
    v_net := (v_settlement->>'net_payout')::NUMERIC;

    UPDATE public.withdrawals
    SET
      net_payout = v_net,
      status = 'Approved',
      status_date = NOW(),
      updated_at = NOW()
    WHERE id = p_id
    RETURNING * INTO v_row;

    UPDATE public.withdrawals
    SET
      status = 'Paid',
      status_date = NOW(),
      updated_at = NOW()
    WHERE id = p_id
    RETURNING * INTO v_row;
  ELSIF v_action = 'hold' THEN
    UPDATE public.withdrawals
    SET
      status = 'On Hold',
      status_date = NOW(),
      updated_at = NOW()
    WHERE id = p_id
    RETURNING * INTO v_row;
  ELSIF v_action = 'reject' THEN
    UPDATE public.withdrawals
    SET
      status = 'Rejected',
      status_date = NOW(),
      updated_at = NOW()
    WHERE id = p_id
    RETURNING * INTO v_row;
  ELSE
    RAISE EXCEPTION 'Action must be approve, hold, or reject.';
  END IF;

  RETURN json_build_object(
    'id', v_row.id,
    'status', v_row.status,
    'net_payout', v_row.net_payout,
    'withdrawal_amount', v_row.withdrawal_amount,
    'action', v_action
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_decide_withdrawal(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_decide_withdrawal(UUID, TEXT) TO anon, authenticated;
