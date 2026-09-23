-- Generated-report history + live report builders (additive).

CREATE TABLE IF NOT EXISTS public.admin_generated_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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

CREATE INDEX IF NOT EXISTS admin_generated_reports_created_at
  ON public.admin_generated_reports (created_at DESC);

ALTER TABLE public.admin_generated_reports ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Sheet builders
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_report_sheet_investments(p_from DATE, p_to DATE)
RETURNS JSON
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(json_agg(row_obj ORDER BY created_at DESC), '[]'::JSON)
  FROM (
    SELECT
      json_build_object(
        'Customer Name', p.full_name,
        'Investment ID', i.code,
        'Plan', i.name,
        'Status', i.status,
        'Principal', i.fund_amount,
        'Current Value', COALESCE(i.current_value, i.fund_amount + COALESCE(i.total_earnings, 0)),
        'Net Earnings', COALESCE(i.total_earnings, 0),
        'TDS Deducted', COALESCE(i.tds_deducted_amount, 0),
        'Interest Rate', i.interest_rate,
        'Invested Date', i.invested_date,
        'Created', (i.created_at AT TIME ZONE 'Asia/Kolkata')::DATE
      ) AS row_obj,
      i.created_at
    FROM public.investments i
    INNER JOIN public.profiles p ON p.user_id = i.user_id
    WHERE (i.created_at AT TIME ZONE 'Asia/Kolkata')::DATE <= p_to
    LIMIT 2000
  ) src;
$$;

CREATE OR REPLACE FUNCTION public.admin_report_sheet_interest(p_from DATE, p_to DATE)
RETURNS JSON
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(json_agg(row_obj ORDER BY period_end DESC, customer_name), '[]'::JSON)
  FROM (
    SELECT
      json_build_object(
        'Customer Name', p.full_name,
        'Investment ID', i.code,
        'Principal', i.fund_amount,
        'Rate', i.interest_rate,
        'Period End', (i.invested_date + (period_no * 30)),
        'Gross Interest', public.admin_monthly_interest(i.fund_amount, i.interest_rate),
        'TDS', public.admin_monthly_tds(i.fund_amount, i.interest_rate, i.tds_percent),
        'Net Interest', public.admin_monthly_net(i.fund_amount, i.interest_rate, i.tds_percent)
      ) AS row_obj,
      (i.invested_date + (period_no * 30)) AS period_end,
      p.full_name AS customer_name
    FROM public.investments i
    INNER JOIN public.profiles p ON p.user_id = i.user_id
    CROSS JOIN LATERAL generate_series(1, GREATEST(i.completed_interest_periods, 0)) AS period_no
    WHERE i.invested_date IS NOT NULL
      AND i.completed_interest_periods > 0
      AND (i.invested_date + (period_no * 30)) BETWEEN p_from AND p_to
    LIMIT 2000
  ) src;
$$;

CREATE OR REPLACE FUNCTION public.admin_report_sheet_withdrawals(p_from DATE, p_to DATE)
RETURNS JSON
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(json_agg(row_obj ORDER BY requested_on DESC), '[]'::JSON)
  FROM (
    SELECT
      json_build_object(
        'Customer Name', p.full_name,
        'Investment ID', i.code,
        'Strategy', w.strategy,
        'Requested Amount', w.withdrawal_amount,
        'Net Payout', COALESCE(w.net_payout, w.withdrawal_amount),
        'Status', w.status,
        'Bank', ba.bank_name,
        'Requested On', w.requested_on
      ) AS row_obj,
      w.requested_on
    FROM public.withdrawals w
    INNER JOIN public.profiles p ON p.user_id = w.user_id
    LEFT JOIN public.investments i ON i.id = w.investment_id
    LEFT JOIN public.bank_accounts ba ON ba.id = w.bank_account_id
    WHERE w.requested_on BETWEEN p_from AND p_to
    LIMIT 2000
  ) src;
$$;

CREATE OR REPLACE FUNCTION public.admin_report_sheet_tds(p_from DATE, p_to DATE)
RETURNS JSON
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(json_agg(row_obj ORDER BY period_end DESC), '[]'::JSON)
  FROM (
    SELECT
      json_build_object(
        'Customer Name', p.full_name,
        'Investment ID', i.code,
        'Principal', i.fund_amount,
        'Gross Interest', public.admin_monthly_interest(i.fund_amount, i.interest_rate),
        'TDS Rate', i.tds_percent,
        'TDS Amount', public.admin_monthly_tds(i.fund_amount, i.interest_rate, i.tds_percent),
        'Period End', (i.invested_date + (period_no * 30))
      ) AS row_obj,
      (i.invested_date + (period_no * 30)) AS period_end
    FROM public.investments i
    INNER JOIN public.profiles p ON p.user_id = i.user_id
    CROSS JOIN LATERAL generate_series(1, GREATEST(i.completed_interest_periods, 0)) AS period_no
    WHERE i.invested_date IS NOT NULL
      AND i.completed_interest_periods > 0
      AND (i.invested_date + (period_no * 30)) BETWEEN p_from AND p_to
    LIMIT 2000
  ) src;
$$;

CREATE OR REPLACE FUNCTION public.admin_report_sheet_referrals(p_from DATE, p_to DATE)
RETURNS JSON
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(json_agg(row_obj ORDER BY created_at DESC), '[]'::JSON)
  FROM (
    SELECT
      json_build_object(
        'Referrer', COALESCE(ref.full_name, 'Referrer'),
        'Referred Customer', COALESCE(cust.full_name, 'Customer'),
        'Investment ID', i.code,
        'Investment Amount', rr.capital_amount,
        'Commission Rate', rr.referral_rate,
        'Gross Commission', rr.gross_bonus,
        'TDS Rate', rr.tds_rate,
        'TDS', rr.tds_amount,
        'Net Commission', rr.net_bonus,
        'Status', rr.status,
        'Date', (rr.created_at AT TIME ZONE 'Asia/Kolkata')::DATE
      ) AS row_obj,
      rr.created_at
    FROM public.referral_rewards rr
    LEFT JOIN public.profiles ref ON ref.user_id = rr.referrer_user_id
    LEFT JOIN public.profiles cust ON cust.user_id = rr.referred_user_id
    LEFT JOIN public.investments i ON i.id = rr.investment_id
    WHERE (rr.created_at AT TIME ZONE 'Asia/Kolkata')::DATE BETWEEN p_from AND p_to
    LIMIT 2000
  ) src;
$$;

CREATE OR REPLACE FUNCTION public.admin_report_sheet_wealth(p_from DATE, p_to DATE)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_aum NUMERIC(15, 2);
  v_invested NUMERIC(15, 2);
  v_active BIGINT;
  v_inflow NUMERIC(15, 2);
  v_outflow NUMERIC(15, 2);
  v_tds NUMERIC(15, 2);
  v_referral_net NUMERIC(15, 2);
BEGIN
  SELECT public.admin_wealth_as_of(p_to) INTO v_aum;

  SELECT
    COALESCE(SUM(i.fund_amount), 0),
    COUNT(*)
  INTO v_invested, v_active
  FROM public.investments i
  WHERE i.status = 'Active';

  SELECT
    COALESCE(SUM(t.amount) FILTER (WHERE t.transaction_type = 'instant_credit'), 0),
    COALESCE(SUM(t.amount) FILTER (WHERE t.transaction_type = 'withdrawal'), 0)
  INTO v_inflow, v_outflow
  FROM public.transactions t
  WHERE t.transaction_date BETWEEN p_from AND p_to;

  SELECT COALESCE(SUM(i.tds_deducted_amount), 0) INTO v_tds FROM public.investments i;

  SELECT COALESCE(SUM(rr.net_bonus), 0)
  INTO v_referral_net
  FROM public.referral_rewards rr
  WHERE rr.status = 'Paid';

  RETURN json_build_array(
    json_build_object('Metric', 'AUM as of period end', 'Value', COALESCE(v_aum, 0)),
    json_build_object('Metric', 'Active principal', 'Value', v_invested),
    json_build_object('Metric', 'Active plans', 'Value', v_active),
    json_build_object('Metric', 'Inflow in range', 'Value', v_inflow),
    json_build_object('Metric', 'Outflow in range', 'Value', v_outflow),
    json_build_object('Metric', 'Lifetime investment TDS', 'Value', v_tds),
    json_build_object('Metric', 'Lifetime paid referral net', 'Value', v_referral_net)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_build_report(
  p_kind TEXT,
  p_from DATE,
  p_to DATE
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kind TEXT := lower(trim(COALESCE(p_kind, '')));
  v_from DATE := COALESCE(p_from, DATE '2000-01-01');
  v_to DATE := COALESCE(p_to, public.admin_ist_today());
  v_name TEXT;
  v_type TEXT;
  v_sheets JSON;
BEGIN
  IF v_from > v_to THEN
    RAISE EXCEPTION 'Start date must be on or before end date.';
  END IF;

  IF v_kind = 'investment' THEN
    v_name := 'Investment Master Ledger';
    v_type := 'Investment';
    v_sheets := json_build_array(json_build_object(
      'name', 'Investments',
      'rows', public.admin_report_sheet_investments(v_from, v_to)
    ));
  ELSIF v_kind = 'interest' THEN
    v_name := 'Interest Accrual Report';
    v_type := 'Interest';
    v_sheets := json_build_array(json_build_object(
      'name', 'Interest',
      'rows', public.admin_report_sheet_interest(v_from, v_to)
    ));
  ELSIF v_kind = 'withdrawal' THEN
    v_name := 'Withdrawal Status Report';
    v_type := 'Withdrawal';
    v_sheets := json_build_array(json_build_object(
      'name', 'Withdrawals',
      'rows', public.admin_report_sheet_withdrawals(v_from, v_to)
    ));
  ELSIF v_kind = 'tds' THEN
    v_name := 'TDS Deduction Ledger';
    v_type := 'TDS';
    v_sheets := json_build_array(json_build_object(
      'name', 'TDS',
      'rows', public.admin_report_sheet_tds(v_from, v_to)
    ));
  ELSIF v_kind = 'referral' THEN
    v_name := 'Referral Commission Report';
    v_type := 'Referral';
    v_sheets := json_build_array(json_build_object(
      'name', 'Referrals',
      'rows', public.admin_report_sheet_referrals(v_from, v_to)
    ));
  ELSIF v_kind = 'wealth' THEN
    v_name := 'AUM and Portfolio Health';
    v_type := 'Wealth';
    v_sheets := json_build_array(json_build_object(
      'name', 'Wealth',
      'rows', public.admin_report_sheet_wealth(v_from, v_to)
    ));
  ELSIF v_kind = 'bulk' THEN
    v_name := 'Bulk Audit Export';
    v_type := 'Bulk';
    v_sheets := json_build_array(
      json_build_object('name', 'Investments', 'rows', public.admin_report_sheet_investments(v_from, v_to)),
      json_build_object('name', 'Interest', 'rows', public.admin_report_sheet_interest(v_from, v_to)),
      json_build_object('name', 'Withdrawals', 'rows', public.admin_report_sheet_withdrawals(v_from, v_to)),
      json_build_object('name', 'TDS', 'rows', public.admin_report_sheet_tds(v_from, v_to)),
      json_build_object('name', 'Referrals', 'rows', public.admin_report_sheet_referrals(v_from, v_to)),
      json_build_object('name', 'Wealth', 'rows', public.admin_report_sheet_wealth(v_from, v_to))
    );
  ELSE
    RAISE EXCEPTION 'Unknown report type.';
  END IF;

  RETURN json_build_object(
    'name', v_name,
    'type', v_type,
    'sheets', v_sheets
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_save_generated_report(
  p_name TEXT,
  p_type TEXT,
  p_from DATE,
  p_to DATE,
  p_range_label TEXT,
  p_generated_by TEXT,
  p_format TEXT,
  p_payload JSONB
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.admin_generated_reports%ROWTYPE;
BEGIN
  IF p_format NOT IN ('xlsx', 'csv', 'pdf') THEN
    RAISE EXCEPTION 'Format must be xlsx, csv, or pdf.';
  END IF;

  INSERT INTO public.admin_generated_reports (
    report_name,
    report_type,
    date_from,
    date_to,
    date_range_label,
    generated_by,
    format,
    payload
  )
  VALUES (
    COALESCE(NULLIF(trim(p_name), ''), 'Report'),
    COALESCE(NULLIF(trim(p_type), ''), 'Report'),
    p_from,
    p_to,
    COALESCE(NULLIF(trim(p_range_label), ''), 'Custom'),
    COALESCE(NULLIF(trim(p_generated_by), ''), 'Admin'),
    p_format,
    COALESCE(p_payload, '{}'::JSONB)
  )
  RETURNING * INTO v_row;

  RETURN json_build_object(
    'id', v_row.id,
    'report_name', v_row.report_name,
    'report_type', v_row.report_type,
    'date_range_label', v_row.date_range_label,
    'generated_by', v_row.generated_by,
    'generated_date', (v_row.created_at AT TIME ZONE 'Asia/Kolkata')::DATE,
    'format', v_row.format,
    'created_at', v_row.created_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_generated_reports()
RETURNS JSON
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(json_agg(row_obj ORDER BY created_at DESC), '[]'::JSON)
  FROM (
    SELECT
      json_build_object(
        'id', r.id,
        'report_name', r.report_name,
        'report_type', r.report_type,
        'date_range_label', r.date_range_label,
        'generated_by', r.generated_by,
        'generated_date', (r.created_at AT TIME ZONE 'Asia/Kolkata')::DATE,
        'format', r.format,
        'created_at', r.created_at
      ) AS row_obj,
      r.created_at
    FROM public.admin_generated_reports r
    ORDER BY r.created_at DESC
    LIMIT 25
  ) src;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_generated_report(p_id UUID)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.admin_generated_reports%ROWTYPE;
BEGIN
  SELECT * INTO v_row
  FROM public.admin_generated_reports
  WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report not found';
  END IF;

  RETURN json_build_object(
    'id', v_row.id,
    'report_name', v_row.report_name,
    'report_type', v_row.report_type,
    'date_range_label', v_row.date_range_label,
    'generated_by', v_row.generated_by,
    'format', v_row.format,
    'payload', v_row.payload,
    'created_at', v_row.created_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_report_sheet_investments(DATE, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_report_sheet_interest(DATE, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_report_sheet_withdrawals(DATE, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_report_sheet_tds(DATE, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_report_sheet_referrals(DATE, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_report_sheet_wealth(DATE, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_build_report(TEXT, DATE, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_save_generated_report(TEXT, TEXT, DATE, DATE, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_generated_reports() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_generated_report(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_build_report(TEXT, DATE, DATE) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_generated_report(TEXT, TEXT, DATE, DATE, TEXT, TEXT, TEXT, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_generated_reports() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_generated_report(UUID) TO anon, authenticated;
