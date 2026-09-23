-- Admin referrals console + payout status.
-- Mobile shows SUM of Paid net_bonus (after TDS). Each Active referred fund
-- creates one reward row; amounts are stored and accumulated, never replaced.
-- Pay writes the referral_bonus ledger once. Hold returns the row to Pending
-- and removes that ledger row so Pay can credit again without doubling.

ALTER TABLE public.referral_rewards DROP CONSTRAINT IF EXISTS referral_rewards_status_check;

UPDATE public.referral_rewards
SET status = 'Paid'
WHERE status = 'credited';

ALTER TABLE public.referral_rewards
  ADD CONSTRAINT referral_rewards_status_check
  CHECK (status IN ('Pending', 'Paid'));

-- ---------------------------------------------------------------------------
-- When a referred fund becomes Active: store the bonus as Pending.
-- Do not write the ledger until admin Pays.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_referral_reward_on_investment_active()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings RECORD;
  v_gross NUMERIC(15, 2);
  v_tds NUMERIC(15, 2);
  v_net NUMERIC(15, 2);
BEGIN
  IF NEW.status <> 'Active'
     OR NOT (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    RETURN NEW;
  END IF;

  IF NEW.referrer_user_id IS NULL OR NEW.referral_code IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.referrer_user_id = NEW.user_id THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.referral_rewards WHERE investment_id = NEW.id
  ) THEN
    RETURN NEW;
  END IF;

  SELECT referral_rate, tds_rate
  INTO v_settings
  FROM public.referral_settings
  WHERE id = 1;

  IF v_settings IS NULL THEN
    RAISE EXCEPTION 'Referral settings are not configured.';
  END IF;

  v_gross := round(NEW.fund_amount * v_settings.referral_rate, 2);
  v_tds := round(v_gross * v_settings.tds_rate, 2);
  v_net := round(v_gross - v_tds, 2);

  INSERT INTO public.referral_rewards (
    referrer_user_id,
    referred_user_id,
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
    NEW.referrer_user_id,
    NEW.user_id,
    NEW.id,
    NEW.referral_code,
    NEW.fund_amount,
    v_settings.referral_rate,
    v_gross,
    v_settings.tds_rate,
    v_tds,
    v_net,
    'Pending'
  )
  ON CONFLICT (investment_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Mobile: only Paid nets are "current earnings". Pending rewards + unactivated
-- referred funds stay in pending_earnings. Totals SUM rows; they are not overwritten.

CREATE OR REPLACE FUNCTION public.get_my_referral_stats()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_total_referrals BIGINT;
  v_total_earnings NUMERIC(15, 2);
  v_pending_earnings NUMERIC(15, 2);
  v_referral_rate NUMERIC(8, 6);
  v_tds_rate NUMERIC(8, 6);
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  PERFORM public.ensure_user_referral_code(v_user_id);

  SELECT referral_rate, tds_rate
  INTO v_referral_rate, v_tds_rate
  FROM public.referral_settings
  WHERE id = 1;

  SELECT COUNT(DISTINCT referred_user_id)::BIGINT
  INTO v_total_referrals
  FROM public.referral_rewards
  WHERE referrer_user_id = v_user_id;

  SELECT COALESCE(SUM(net_bonus), 0)
  INTO v_total_earnings
  FROM public.referral_rewards
  WHERE referrer_user_id = v_user_id
    AND status = 'Paid';

  SELECT
    COALESCE((
      SELECT SUM(round(i.fund_amount * v_referral_rate * (1 - v_tds_rate), 2))
      FROM public.investments i
      WHERE i.referrer_user_id = v_user_id
        AND i.status = 'Pending'
        AND NOT EXISTS (
          SELECT 1 FROM public.referral_rewards rr WHERE rr.investment_id = i.id
        )
    ), 0)
    + COALESCE((
      SELECT SUM(rr.net_bonus)
      FROM public.referral_rewards rr
      WHERE rr.referrer_user_id = v_user_id
        AND rr.status = 'Pending'
    ), 0)
  INTO v_pending_earnings;

  RETURN json_build_object(
    'total_referrals', v_total_referrals,
    'total_earnings', v_total_earnings,
    'pending_earnings', v_pending_earnings,
    'referral_rate', v_referral_rate,
    'tds_rate', v_tds_rate
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_referral_history()
RETURNS TABLE (
  id UUID,
  referred_name TEXT,
  investment_code TEXT,
  capital_amount NUMERIC,
  net_bonus NUMERIC,
  referral_code TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  SELECT
    rr.id,
    p.full_name AS referred_name,
    i.code AS investment_code,
    rr.capital_amount,
    rr.net_bonus,
    rr.referral_code,
    rr.created_at
  FROM public.referral_rewards rr
  JOIN public.profiles p ON p.user_id = rr.referred_user_id
  LEFT JOIN public.investments i ON i.id = rr.investment_id
  WHERE rr.referrer_user_id = auth.uid()
    AND rr.status = 'Paid'
  ORDER BY rr.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_referral_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_referral_history() TO authenticated;

-- ---------------------------------------------------------------------------
-- Admin list
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_list_referrals(
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
  v_limit INTEGER := GREATEST(1, LEAST(COALESCE(p_limit, 10), 50));
  v_offset INTEGER := GREATEST(0, COALESCE(p_offset, 0));
  v_settings RECORD;
  v_kpis JSON;
  v_rows JSON;
  v_total BIGINT;
BEGIN
  SELECT referral_rate, tds_rate
  INTO v_settings
  FROM public.referral_settings
  WHERE id = 1;

  SELECT json_build_object(
    'totalReferrals', (SELECT COUNT(DISTINCT referred_user_id) FROM public.referral_rewards),
    'grossCommission', (SELECT COALESCE(SUM(gross_bonus), 0) FROM public.referral_rewards),
    'tdsAmount', (SELECT COALESCE(SUM(tds_amount), 0) FROM public.referral_rewards),
    'netCommission', (SELECT COALESCE(SUM(net_bonus), 0) FROM public.referral_rewards)
  )
  INTO v_kpis;

  SELECT COUNT(*) INTO v_total FROM public.referral_rewards;

  SELECT COALESCE(json_agg(row_json ORDER BY created_at DESC), '[]'::JSON)
  INTO v_rows
  FROM (
    SELECT
      json_build_object(
        'id', rr.id,
        'status', rr.status,
        'referrer_user_id', rr.referrer_user_id,
        'referred_user_id', rr.referred_user_id,
        'referrer_name', COALESCE(ref.full_name, 'Referrer'),
        'referred_name', COALESCE(cust.full_name, 'Referred customer'),
        'investment_id', rr.investment_id,
        'investment_code', i.code,
        'referral_code', rr.referral_code,
        'capital_amount', rr.capital_amount,
        'referral_rate', rr.referral_rate,
        'gross_bonus', rr.gross_bonus,
        'tds_rate', rr.tds_rate,
        'tds_amount', rr.tds_amount,
        'net_bonus', rr.net_bonus,
        'lifetime_paid_net', COALESCE((
          SELECT SUM(x.net_bonus)
          FROM public.referral_rewards x
          WHERE x.referrer_user_id = rr.referrer_user_id
            AND x.status = 'Paid'
        ), 0),
        'created_at', rr.created_at
      ) AS row_json,
      rr.created_at
    FROM public.referral_rewards rr
    LEFT JOIN public.profiles ref ON ref.user_id = rr.referrer_user_id
    LEFT JOIN public.profiles cust ON cust.user_id = rr.referred_user_id
    LEFT JOIN public.investments i ON i.id = rr.investment_id
    ORDER BY rr.created_at DESC
    LIMIT v_limit
    OFFSET v_offset
  ) paged;

  RETURN json_build_object(
    'settings', json_build_object(
      'referral_rate', COALESCE(v_settings.referral_rate, 0.01),
      'tds_rate', COALESCE(v_settings.tds_rate, 0.02)
    ),
    'kpis', v_kpis,
    'rows', v_rows,
    'total', COALESCE(v_total, 0),
    'limit', v_limit,
    'offset', v_offset
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_referrals(INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_referrals(INTEGER, INTEGER) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Pay / Hold
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_decide_referral(
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
  v_row public.referral_rewards%ROWTYPE;
  v_code TEXT;
BEGIN
  SELECT * INTO v_row
  FROM public.referral_rewards
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Referral commission not found';
  END IF;

  IF v_action = 'pay' THEN
    UPDATE public.referral_rewards
    SET status = 'Paid'
    WHERE id = p_id
    RETURNING * INTO v_row;

    SELECT code INTO v_code
    FROM public.investments
    WHERE id = v_row.investment_id;

    INSERT INTO public.transactions (
      user_id,
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
      v_row.referrer_user_id,
      'referral_bonus',
      v_row.net_bonus,
      v_row.investment_id,
      COALESCE(v_code, '—'),
      v_row.id::TEXT,
      (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE,
      'referral',
      v_row.id
    )
    ON CONFLICT (source_type, source_id) DO NOTHING;
  ELSIF v_action = 'hold' THEN
    DELETE FROM public.transactions
    WHERE source_type = 'referral'
      AND source_id = p_id;

    UPDATE public.referral_rewards
    SET status = 'Pending'
    WHERE id = p_id
    RETURNING * INTO v_row;
  ELSE
    RAISE EXCEPTION 'Action must be pay or hold.';
  END IF;

  RETURN json_build_object(
    'id', v_row.id,
    'status', v_row.status,
    'net_bonus', v_row.net_bonus,
    'action', v_action
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_decide_referral(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_decide_referral(UUID, TEXT) TO anon, authenticated;
