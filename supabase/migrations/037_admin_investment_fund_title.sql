-- Add fund title support to admin create investment (uses existing columns only:
-- investments.name, investments.detail_subtitle). No new tables/columns.

CREATE OR REPLACE FUNCTION public.admin_list_customer_options(
  p_search TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 50
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_search TEXT := NULLIF(trim(COALESCE(p_search, '')), '');
  v_limit INTEGER := GREATEST(1, LEAST(COALESCE(p_limit, 50), 100));
BEGIN
  RETURN COALESCE((
    SELECT json_agg(row_json ORDER BY full_name ASC)
    FROM (
      SELECT json_build_object(
        'user_id', c.user_id,
        'customer_id', c.customer_id,
        'full_name', p.full_name,
        'mobile_number', p.mobile_number,
        'investment_count', (
          SELECT COUNT(*)::INTEGER
          FROM public.investments i
          WHERE i.user_id = c.user_id
        )
      ) AS row_json,
      p.full_name
      FROM public.customers c
      INNER JOIN public.profiles p ON p.user_id = c.user_id
      WHERE v_search IS NULL
        OR p.full_name ILIKE '%' || v_search || '%'
        OR COALESCE(c.customer_id, '') ILIKE '%' || v_search || '%'
        OR p.mobile_number ILIKE '%' || v_search || '%'
      ORDER BY p.full_name ASC
      LIMIT v_limit
    ) q
  ), '[]'::JSON);
END;
$$;

DROP FUNCTION IF EXISTS public.admin_create_investment_request(UUID, NUMERIC, UUID);
DROP FUNCTION IF EXISTS public.admin_create_investment_request(UUID, NUMERIC, UUID, TEXT);

CREATE OR REPLACE FUNCTION public.admin_create_investment_request(
  p_user_id UUID,
  p_amount NUMERIC,
  p_bank_account_id UUID,
  p_fund_title TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id TEXT;
  v_amount NUMERIC(15, 2) := COALESCE(p_amount, 0);
  v_min NUMERIC(15, 2);
  v_max NUMERIC(15, 2);
  v_bank public.bank_accounts%ROWTYPE;
  v_nominee_id UUID;
  v_investment_id UUID;
  v_title TEXT := trim(COALESCE(p_fund_title, ''));
  v_next_n INTEGER;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Select a customer.';
  END IF;

  IF p_bank_account_id IS NULL THEN
    RAISE EXCEPTION 'Select a bank account number.';
  END IF;

  SELECT c.customer_id
  INTO v_customer_id
  FROM public.customers c
  WHERE c.user_id = p_user_id;

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Customer not found.';
  END IF;

  SELECT *
  INTO v_bank
  FROM public.bank_accounts ba
  WHERE ba.id = p_bank_account_id
    AND ba.user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected bank account does not belong to this customer.';
  END IF;

  SELECT min_investment_amount, max_investment_amount
  INTO v_min, v_max
  FROM public.admin_portal_settings
  WHERE id = 1;

  v_min := COALESCE(v_min, 10000);
  v_max := COALESCE(v_max, 10000000);

  IF v_amount < v_min OR v_amount > v_max THEN
    RAISE EXCEPTION 'Investment amount must be between ₹% and ₹%.',
      to_char(v_min, 'FM999,999,999,990'),
      to_char(v_max, 'FM999,999,999,990');
  END IF;

  IF v_title = '' THEN
    SELECT COUNT(*)::INTEGER + 1
    INTO v_next_n
    FROM public.investments i
    WHERE i.user_id = p_user_id;

    v_title := 'Investment ' || v_next_n::TEXT;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.investments i
    WHERE i.user_id = p_user_id
      AND lower(trim(i.name)) = lower(v_title)
  ) THEN
    RAISE EXCEPTION 'An investment with this title already exists for this customer.';
  END IF;

  SELECT n.id
  INTO v_nominee_id
  FROM public.nominees n
  WHERE n.user_id = p_user_id
  LIMIT 1;

  INSERT INTO public.investments (
    user_id,
    name,
    detail_subtitle,
    fund_amount,
    interest_rate,
    tds_percent,
    status,
    bank_account_id,
    nominee_id,
    agreement_charges,
    payout_day
  ) VALUES (
    p_user_id,
    v_title,
    v_title,
    v_amount,
    0.05,
    0.10,
    'Pending',
    v_bank.id,
    v_nominee_id,
    1000,
    10
  )
  RETURNING id INTO v_investment_id;

  RETURN json_build_object(
    'ok', true,
    'id', v_investment_id,
    'user_id', p_user_id,
    'customer_id', v_customer_id,
    'bank_account_id', v_bank.id,
    'fund_amount', v_amount,
    'name', v_title,
    'detail_subtitle', v_title,
    'status', 'Pending'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_customer_options(TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_create_investment_request(UUID, NUMERIC, UUID, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_list_customer_options(TEXT, INTEGER) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_investment_request(UUID, NUMERIC, UUID, TEXT) TO anon, authenticated;
