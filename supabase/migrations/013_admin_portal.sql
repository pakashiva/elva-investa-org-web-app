-- =============================================================================
-- 013_admin_portal.sql
-- Additive Admin Portal schema. Safe to re-run.
-- Does NOT recreate or replace mobile tables, triggers, or investor RLS.
--
-- After this migration, grant portal access (SQL Editor):
--   INSERT INTO public.admin_users (user_id, role, full_name, is_active)
--   SELECT id, 'super_admin', 'Your Name', TRUE
--   FROM auth.users
--   WHERE lower(email) = 'you@example.com'
--   ON CONFLICT (user_id) DO UPDATE
--     SET role = EXCLUDED.role, full_name = EXCLUDED.full_name, is_active = TRUE;
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Admin allow-list
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.admin_users (
  user_id UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('super_admin', 'operator')),
  full_name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL REFERENCES public.admin_users (user_id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_json JSONB,
  after_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created_at
  ON public.admin_audit_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_entity
  ON public.admin_audit_logs (entity_type, entity_id);

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- customers: 1-to-1 extension of auth.users (customer_id assigned later)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.customers (
  user_id UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  customer_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS customers_customer_id_unique
  ON public.customers (customer_id)
  WHERE customer_id IS NOT NULL;

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

INSERT INTO public.customers (user_id)
SELECT id FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.trg_ensure_customer_row()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.customers (user_id)
  VALUES (NEW.user_id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profile_ensure_customer ON public.profiles;
CREATE TRIGGER trg_profile_ensure_customer
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_ensure_customer_row();

-- ---------------------------------------------------------------------------
-- Authorization helper (SECURITY DEFINER bypasses RLS on admin_users)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_users
    WHERE user_id = auth.uid()
      AND is_active = TRUE
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Admin SELECT policies (OR'd with existing own-row investor policies)
-- No admin INSERT/UPDATE/DELETE on financial tables — future RPCs will mutate.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "admin_select_profiles" ON public.profiles;
CREATE POLICY "admin_select_profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "admin_select_kyc_documents" ON public.kyc_documents;
CREATE POLICY "admin_select_kyc_documents"
  ON public.kyc_documents FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "admin_select_bank_accounts" ON public.bank_accounts;
CREATE POLICY "admin_select_bank_accounts"
  ON public.bank_accounts FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "admin_select_nominees" ON public.nominees;
CREATE POLICY "admin_select_nominees"
  ON public.nominees FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "admin_select_investments" ON public.investments;
CREATE POLICY "admin_select_investments"
  ON public.investments FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "admin_select_withdrawals" ON public.withdrawals;
CREATE POLICY "admin_select_withdrawals"
  ON public.withdrawals FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "admin_select_transactions" ON public.transactions;
CREATE POLICY "admin_select_transactions"
  ON public.transactions FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "admin_select_referral_codes" ON public.referral_codes;
CREATE POLICY "admin_select_referral_codes"
  ON public.referral_codes FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "admin_select_referral_rewards" ON public.referral_rewards;
CREATE POLICY "admin_select_referral_rewards"
  ON public.referral_rewards FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "admin_select_customers" ON public.customers;
CREATE POLICY "admin_select_customers"
  ON public.customers FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "admin_select_admin_users" ON public.admin_users;
CREATE POLICY "admin_select_admin_users"
  ON public.admin_users FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "admin_select_audit_logs" ON public.admin_audit_logs;
CREATE POLICY "admin_select_audit_logs"
  ON public.admin_audit_logs FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "kyc_storage_select_admin" ON storage.objects;
CREATE POLICY "kyc_storage_select_admin"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'kyc-documents'
    AND public.is_admin()
  );

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_ist_today()
RETURNS DATE
LANGUAGE sql
STABLE
AS $$
  SELECT (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE;
$$;

CREATE OR REPLACE FUNCTION public.admin_monthly_interest(p_fund NUMERIC, p_rate NUMERIC)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ROUND(p_fund * p_rate, 2);
$$;

CREATE OR REPLACE FUNCTION public.admin_monthly_tds(p_fund NUMERIC, p_rate NUMERIC, p_tds NUMERIC)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ROUND(ROUND(p_fund * p_rate, 2) * p_tds, 2);
$$;

CREATE OR REPLACE FUNCTION public.admin_monthly_net(p_fund NUMERIC, p_rate NUMERIC, p_tds NUMERIC)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ROUND(p_fund * p_rate, 2) - ROUND(ROUND(p_fund * p_rate, 2) * p_tds, 2);
$$;

-- Historical wealth as of a calendar date (IST).
-- Active-at-date = invested_date set, invested on or before date, and either
-- still Active or Closed after that date.
-- Earnings estimated from completed 30-day periods that had ended by `p_as_of`,
-- using the SAME rounding as process_user_investment_interest.
-- Partial withdrawals reset invested_date; pre-partial principal is not snapshotted.
CREATE OR REPLACE FUNCTION public.admin_wealth_as_of(p_as_of DATE)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(
    i.fund_amount
    + (
        LEAST(
          i.completed_interest_periods,
          GREATEST(0, (p_as_of - i.invested_date) / 30)
        )
        * public.admin_monthly_net(i.fund_amount, i.interest_rate, i.tds_percent)
      )
  ), 0)
  FROM public.investments i
  WHERE i.invested_date IS NOT NULL
    AND i.invested_date <= p_as_of
    AND (
      i.status = 'Active'
      OR (
        i.status = 'Closed'
        AND (i.updated_at AT TIME ZONE 'Asia/Kolkata')::DATE > p_as_of
      )
    );
$$;

-- ---------------------------------------------------------------------------
-- RPC: current admin identity
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_get_me()
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.admin_users%ROWTYPE;
  v_email TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_row
  FROM public.admin_users
  WHERE user_id = auth.uid()
    AND is_active = TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT email INTO v_email
  FROM auth.users
  WHERE id = auth.uid();

  RETURN json_build_object(
    'user_id', v_row.user_id,
    'role', v_row.role,
    'full_name', v_row.full_name,
    'email', v_email
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_me() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_me() TO authenticated;

-- ---------------------------------------------------------------------------
-- RPC: operational dashboard
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
  v_verified BIGINT;
  v_new_regs BIGINT;
  v_pending_inv BIGINT;
  v_pending_wd BIGINT;
  v_wealth_series JSON;
  v_flow_series JSON;
  v_month_start DATE;
BEGIN
  -- Admin login is not enabled yet; this RPC is granted to anon for development.
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

  -- YTD interest / TDS: sum each completed 30-day period whose end date falls
  -- in the current calendar year. Matches mobile accrual rounding.
  -- After a partial withdrawal, invested_date and completed_interest_periods
  -- reset, so pre-partial periods in a prior year cannot be reconstructed.
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

  SELECT COUNT(DISTINCT i.user_id)
  INTO v_verified
  FROM public.investments i
  WHERE i.status = 'Active';

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
      'verifiedCustomers', v_verified,
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

REVOKE ALL ON FUNCTION public.admin_get_dashboard(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_dashboard(INTEGER) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPC: paginated customer list
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_list_customers(
  p_filter TEXT DEFAULT 'all',
  p_search TEXT DEFAULT NULL,
  p_join_from DATE DEFAULT NULL,
  p_join_to DATE DEFAULT NULL,
  p_sort TEXT DEFAULT 'joined_desc',
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
  v_filter TEXT := lower(COALESCE(p_filter, 'all'));
  v_search TEXT := NULLIF(trim(COALESCE(p_search, '')), '');
  v_limit INTEGER := GREATEST(1, LEAST(COALESCE(p_limit, 10), 50));
  v_offset INTEGER := GREATEST(0, COALESCE(p_offset, 0));
  v_total BIGINT;
  v_rows JSON;
BEGIN
  -- Admin login is not enabled yet; this RPC is granted to anon for development.

  WITH base AS (
    SELECT
      c.user_id,
      c.customer_id,
      p.full_name,
      p.mobile_number,
      p.email_address,
      p.created_at AS joined_at,
      k.pan_number,
      COUNT(i.id) FILTER (WHERE i.status = 'Active') AS active_investments,
      COUNT(i.id) FILTER (WHERE i.status = 'Pending') AS pending_investments,
      COUNT(i.id) FILTER (WHERE i.status = 'Closed') AS closed_investments,
      COUNT(i.id) AS total_investments,
      COALESCE(SUM(i.fund_amount) FILTER (WHERE i.status = 'Active'), 0) AS total_invested
    FROM public.customers c
    INNER JOIN public.profiles p ON p.user_id = c.user_id
    LEFT JOIN public.kyc_documents k ON k.user_id = c.user_id
    LEFT JOIN public.investments i ON i.user_id = c.user_id
    WHERE (p_join_from IS NULL OR (p.created_at AT TIME ZONE 'Asia/Kolkata')::DATE >= p_join_from)
      AND (p_join_to IS NULL OR (p.created_at AT TIME ZONE 'Asia/Kolkata')::DATE <= p_join_to)
      AND (
        v_search IS NULL
        OR p.full_name ILIKE '%' || v_search || '%'
        OR p.mobile_number ILIKE '%' || v_search || '%'
        OR p.email_address ILIKE '%' || v_search || '%'
        OR COALESCE(k.pan_number, '') ILIKE '%' || v_search || '%'
        OR COALESCE(c.customer_id, '') ILIKE '%' || v_search || '%'
      )
    GROUP BY
      c.user_id,
      c.customer_id,
      p.full_name,
      p.mobile_number,
      p.email_address,
      p.created_at,
      k.pan_number
  ),
  filtered AS (
    SELECT *
    FROM base
    WHERE CASE v_filter
      WHEN 'active' THEN active_investments > 0
      WHEN 'inactive' THEN active_investments = 0
      WHEN 'with_investments' THEN total_investments > 0
      WHEN 'no_investment' THEN total_investments = 0
      ELSE TRUE
    END
  ),
  paged AS (
    SELECT
      user_id,
      customer_id,
      full_name,
      mobile_number,
      email_address,
      pan_number,
      active_investments,
      pending_investments,
      closed_investments,
      total_investments,
      total_invested,
      joined_at
    FROM filtered
    ORDER BY
      CASE WHEN p_sort = 'joined_asc' THEN joined_at END ASC,
      CASE WHEN p_sort = 'joined_desc' THEN joined_at END DESC,
      joined_at DESC
    LIMIT v_limit
    OFFSET v_offset
  )
  SELECT
    (SELECT COUNT(*) FROM filtered),
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

REVOKE ALL ON FUNCTION public.admin_list_customers(TEXT, TEXT, DATE, DATE, TEXT, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_customers(TEXT, TEXT, DATE, DATE, TEXT, INTEGER, INTEGER) TO anon, authenticated;
