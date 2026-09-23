-- Remove KYC / bank verification workflow from admin surfaces.
-- Keep kyc_documents for identity fields (e.g. pan_number) used by registration
-- and customer profile display — do NOT drop that table.

-- ---------------------------------------------------------------------------
-- 1. Drop KYC document upload path columns (verification workflow artifacts)
-- ---------------------------------------------------------------------------
ALTER TABLE public.kyc_documents
  DROP COLUMN IF EXISTS aadhaar_front_path,
  DROP COLUMN IF EXISTS aadhaar_back_path,
  DROP COLUMN IF EXISTS pan_card_path;

-- Optional verification status columns if they exist on mobile-era schemas
ALTER TABLE public.kyc_documents
  DROP COLUMN IF EXISTS verification_status,
  DROP COLUMN IF EXISTS verified,
  DROP COLUMN IF EXISTS verified_at,
  DROP COLUMN IF EXISTS kyc_status;

ALTER TABLE public.bank_accounts
  DROP COLUMN IF EXISTS verified,
  DROP COLUMN IF EXISTS verification_status,
  DROP COLUMN IF EXISTS penny_verified,
  DROP COLUMN IF EXISTS verified_at;

-- ---------------------------------------------------------------------------
-- 2. Drop admin KYC storage policies (document review workflow)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "kyc_storage_select_admin" ON storage.objects;
DROP POLICY IF EXISTS "admin_select_kyc_documents" ON public.kyc_documents;

-- ---------------------------------------------------------------------------
-- 3. Customer details: no kyc_verified / bank verified flags
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_get_customer_details(p_user_id UUID)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile JSON;
  v_banks JSON;
  v_transactions JSON;
  v_active_count BIGINT;
  v_total_invested NUMERIC(15, 2);
  v_returns NUMERIC(15, 2);
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Customer not found';
  END IF;

  SELECT json_build_object(
    'user_id', c.user_id,
    'customer_id', c.customer_id,
    'full_name', p.full_name,
    'mobile_number', p.mobile_number,
    'email_address', p.email_address,
    'date_of_birth', p.date_of_birth,
    'address', p.address,
    'city', p.city,
    'state', p.state,
    'pin_code', p.pin_code,
    'pan_number', k.pan_number
  )
  INTO v_profile
  FROM public.customers c
  INNER JOIN public.profiles p ON p.user_id = c.user_id
  LEFT JOIN public.kyc_documents k ON k.user_id = c.user_id
  WHERE c.user_id = p_user_id;

  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Customer not found';
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE i.status = 'Active'),
    COALESCE(SUM(i.fund_amount) FILTER (WHERE i.status = 'Active'), 0),
    COALESCE(SUM(i.total_earnings) FILTER (WHERE i.status IN ('Active', 'Closed')), 0)
  INTO v_active_count, v_total_invested, v_returns
  FROM public.investments i
  WHERE i.user_id = p_user_id;

  SELECT COALESCE(json_agg(bank_row ORDER BY is_primary DESC, created_at ASC), '[]'::JSON)
  INTO v_banks
  FROM (
    SELECT
      json_build_object(
        'id', ba.id,
        'bank_name', ba.bank_name,
        'account_number', ba.account_number,
        'ifsc_code', ba.ifsc_code,
        'account_type', ba.account_type,
        'is_primary', ba.is_primary
      ) AS bank_row,
      ba.is_primary,
      ba.created_at
    FROM public.bank_accounts ba
    WHERE ba.user_id = p_user_id
  ) banks;

  SELECT COALESCE(json_agg(txn_row ORDER BY sort_date DESC, sort_ts DESC), '[]'::JSON)
  INTO v_transactions
  FROM (
    SELECT
      json_build_object(
        'id', t.id,
        'occurred_on', t.transaction_date,
        'transaction_type', t.transaction_type,
        'amount', t.amount,
        'status', 'Completed'
      ) AS txn_row,
      t.transaction_date::TIMESTAMPTZ AS sort_date,
      t.created_at AS sort_ts
    FROM public.transactions t
    WHERE t.user_id = p_user_id

    UNION ALL

    SELECT
      json_build_object(
        'id', w.id,
        'occurred_on', w.requested_on,
        'transaction_type', 'withdrawal',
        'amount', COALESCE(w.net_payout, w.withdrawal_amount),
        'status', 'Pending'
      ) AS txn_row,
      w.requested_on::TIMESTAMPTZ AS sort_date,
      w.created_at AS sort_ts
    FROM public.withdrawals w
    WHERE w.user_id = p_user_id
      AND w.status IN ('Processing', 'Approved')
      AND NOT EXISTS (
        SELECT 1
        FROM public.transactions t
        WHERE t.source_type = 'withdrawal'
          AND t.source_id = w.id
      )
  ) ledger;

  RETURN json_build_object(
    'profile', v_profile,
    'account_active', COALESCE(v_active_count, 0) > 0,
    'summary', json_build_object(
      'total_invested', COALESCE(v_total_invested, 0),
      'active_plans', COALESCE(v_active_count, 0),
      'returns_earned', COALESCE(v_returns, 0)
    ),
    'banks', v_banks,
    'transactions', v_transactions
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_customer_details(UUID) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Investment request detail: no kyc / bank verification flags
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

-- ---------------------------------------------------------------------------
-- 5. Dashboard: total customers (not "verified")
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_get_dashboard(p_months INTEGER DEFAULT 6)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today DATE := public.admin_ist_today();
  v_year_start DATE;
  v_week_start DATE;
  v_months INTEGER;
  v_wealth NUMERIC(15, 2);
  v_invested NUMERIC(15, 2);
  v_active_count BIGINT;
  v_active_week BIGINT;
  v_interest_ytd NUMERIC(15, 2);
  v_tds_ytd NUMERIC(15, 2);
  v_withdrawals NUMERIC(15, 2);
  v_total_customers BIGINT;
  v_new_regs BIGINT;
  v_pending_inv BIGINT;
  v_pending_wd BIGINT;
  v_wealth_series JSON;
  v_flow_series JSON;
  v_month_start DATE;
BEGIN
  v_months := GREATEST(1, LEAST(COALESCE(p_months, 6), 24));
  v_year_start := date_trunc('year', v_today)::DATE;
  v_week_start := v_today - 6;

  SELECT
    COALESCE(SUM(i.fund_amount + COALESCE(i.total_earnings, 0)), 0),
    COALESCE(SUM(i.fund_amount), 0),
    COUNT(*)
  INTO v_wealth, v_invested, v_active_count
  FROM public.investments i
  WHERE i.status = 'Active';

  SELECT COUNT(*)
  INTO v_active_week
  FROM public.investments i
  WHERE i.status = 'Active'
    AND i.invested_date IS NOT NULL
    AND i.invested_date >= v_week_start;

  SELECT
    COALESCE(SUM(public.admin_monthly_net(i.fund_amount, i.interest_rate, i.tds_percent)), 0),
    COALESCE(SUM(public.admin_monthly_tds(i.fund_amount, i.interest_rate, i.tds_percent)), 0)
  INTO v_interest_ytd, v_tds_ytd
  FROM public.investments i
  CROSS JOIN LATERAL generate_series(1, GREATEST(i.completed_interest_periods, 0)) AS period_no
  WHERE i.invested_date IS NOT NULL
    AND i.completed_interest_periods > 0
    AND (i.invested_date + (period_no * 30)) >= v_year_start
    AND (i.invested_date + (period_no * 30)) <= v_today;

  SELECT COALESCE(SUM(COALESCE(w.net_payout, w.withdrawal_amount)), 0)
  INTO v_withdrawals
  FROM public.withdrawals w
  WHERE w.status = 'Paid';

  SELECT COUNT(*)
  INTO v_total_customers
  FROM public.customers;

  SELECT COUNT(*)
  INTO v_new_regs
  FROM public.profiles p
  WHERE (p.created_at AT TIME ZONE 'Asia/Kolkata')::DATE >= v_week_start;

  SELECT COUNT(*) INTO v_pending_inv
  FROM public.investments
  WHERE status = 'Pending';

  SELECT COUNT(*) INTO v_pending_wd
  FROM public.withdrawals
  WHERE status = 'Processing';

  v_month_start := date_trunc('month', v_today)::DATE - ((v_months - 1) * INTERVAL '1 month');

  SELECT COALESCE(json_agg(row_json ORDER BY month_end), '[]'::JSON)
  INTO v_wealth_series
  FROM (
    SELECT
      month_end,
      json_build_object(
        'month', to_char(month_end, 'YYYY-MM'),
        'label', to_char(month_end, 'Mon'),
        'wealth', public.admin_wealth_as_of(month_end)
      ) AS row_json
    FROM generate_series(
      v_month_start,
      date_trunc('month', v_today)::DATE,
      INTERVAL '1 month'
    ) AS month_start
    CROSS JOIN LATERAL (
      SELECT (
        (month_start + INTERVAL '1 month')::DATE - 1
      ) AS month_end
    ) bounds
  ) series;

  SELECT COALESCE(json_agg(row_json ORDER BY month_start), '[]'::JSON)
  INTO v_flow_series
  FROM (
    SELECT
      month_start,
      json_build_object(
        'month', to_char(month_start, 'YYYY-MM'),
        'label', to_char(month_start, 'Mon'),
        'inflow', COALESCE(flows.inflow, 0),
        'outflow', COALESCE(flows.outflow, 0)
      ) AS row_json
    FROM generate_series(
      v_month_start,
      date_trunc('month', v_today)::DATE,
      INTERVAL '1 month'
    ) AS month_start
    LEFT JOIN LATERAL (
      SELECT
        COALESCE(SUM(t.amount) FILTER (WHERE t.transaction_type = 'instant_credit'), 0) AS inflow,
        COALESCE(SUM(t.amount) FILTER (WHERE t.transaction_type = 'withdrawal'), 0) AS outflow
      FROM public.transactions t
      WHERE t.transaction_date >= month_start::DATE
        AND t.transaction_date < (month_start + INTERVAL '1 month')::DATE
    ) flows ON TRUE
  ) series;

  RETURN json_build_object(
    'kpis', json_build_object(
      'totalWealthManaged', v_wealth,
      'totalInvested', v_invested,
      'activeInvestments', v_active_count,
      'activeInvestmentsThisWeek', v_active_week,
      'interestPaidYtd', v_interest_ytd,
      'tdsDeductedYtd', v_tds_ytd,
      'totalWithdrawals', v_withdrawals,
      'totalCustomers', v_total_customers,
      'newRegistrationsThisWeek', v_new_regs,
      'pendingRequests', v_pending_inv + v_pending_wd,
      'pendingInvestments', v_pending_inv,
      'pendingWithdrawals', v_pending_wd
    ),
    'wealthSeries', v_wealth_series,
    'flowSeries', v_flow_series
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_dashboard(INTEGER) TO anon, authenticated;
