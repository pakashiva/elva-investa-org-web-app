-- Read-only customer details payload for the Admin Portal.

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
  v_funded_count BIGINT;
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
    COUNT(*) FILTER (WHERE i.status IN ('Active', 'Closed')),
    COALESCE(SUM(i.fund_amount) FILTER (WHERE i.status = 'Active'), 0),
    COALESCE(SUM(i.total_earnings) FILTER (WHERE i.status IN ('Active', 'Closed')), 0)
  INTO v_active_count, v_funded_count, v_total_invested, v_returns
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
        'is_primary', ba.is_primary,
        'verified', EXISTS (
          SELECT 1
          FROM public.transactions t
          WHERE t.user_id = ba.user_id
            AND (
              (
                t.source_type = 'investment'
                AND EXISTS (
                  SELECT 1
                  FROM public.investments i
                  WHERE i.id = t.source_id
                    AND i.bank_account_id = ba.id
                )
              )
              OR (
                t.source_type = 'withdrawal'
                AND EXISTS (
                  SELECT 1
                  FROM public.withdrawals w
                  WHERE w.id = t.source_id
                    AND w.bank_account_id = ba.id
                )
              )
            )
        )
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
    'kyc_verified', COALESCE(v_funded_count, 0) > 0,
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

REVOKE ALL ON FUNCTION public.admin_get_customer_details(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_customer_details(UUID) TO anon, authenticated;
