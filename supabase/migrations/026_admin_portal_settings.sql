-- Portal settings singleton (editable from Admin Settings page).

CREATE TABLE IF NOT EXISTS public.admin_portal_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  platform_name TEXT NOT NULL DEFAULT 'Venkatesh Traders',
  support_email TEXT NOT NULL DEFAULT 'support@rouru.finance',
  support_phone TEXT NOT NULL DEFAULT '+91 98765 43210',
  default_currency TEXT NOT NULL DEFAULT 'INR',
  min_investment_amount NUMERIC(15, 2) NOT NULL DEFAULT 10000,
  max_investment_amount NUMERIC(15, 2) NOT NULL DEFAULT 10000000,
  gateway_provider TEXT NOT NULL DEFAULT 'Razorpay',
  merchant_id TEXT NOT NULL DEFAULT '',
  api_key TEXT NOT NULL DEFAULT '',
  api_secret TEXT NOT NULL DEFAULT '',
  max_single_transaction NUMERIC(15, 2) NOT NULL DEFAULT 1000000,
  daily_transfer_limit NUMERIC(15, 2) NOT NULL DEFAULT 5000000,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Additive columns if an earlier draft of this migration already ran.
ALTER TABLE public.admin_portal_settings
  ADD COLUMN IF NOT EXISTS platform_name TEXT NOT NULL DEFAULT 'Venkatesh Traders',
  ADD COLUMN IF NOT EXISTS support_email TEXT NOT NULL DEFAULT 'support@rouru.finance',
  ADD COLUMN IF NOT EXISTS support_phone TEXT NOT NULL DEFAULT '+91 98765 43210';

INSERT INTO public.admin_portal_settings (
  id,
  platform_name,
  support_email,
  support_phone,
  default_currency,
  min_investment_amount,
  max_investment_amount,
  gateway_provider,
  merchant_id,
  api_key,
  api_secret,
  max_single_transaction,
  daily_transfer_limit
)
VALUES (
  1,
  'Venkatesh Traders',
  'support@rouru.finance',
  '+91 98765 43210',
  'INR',
  10000,
  10000000,
  'Razorpay',
  'MID_VT_2026_XXXX',
  'rzp_live_xxxxxxxx',
  'secret_xxxxxxxx',
  1000000,
  5000000
)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.admin_portal_settings ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.admin_get_portal_settings()
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.admin_portal_settings%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.admin_portal_settings WHERE id = 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Portal settings are not configured.';
  END IF;

  RETURN json_build_object(
    'platform_name', v_row.platform_name,
    'support_email', v_row.support_email,
    'support_phone', v_row.support_phone,
    'default_currency', v_row.default_currency,
    'min_investment_amount', v_row.min_investment_amount,
    'max_investment_amount', v_row.max_investment_amount,
    'gateway_provider', v_row.gateway_provider,
    'merchant_id', v_row.merchant_id,
    'api_key', v_row.api_key,
    'api_secret', v_row.api_secret,
    'max_single_transaction', v_row.max_single_transaction,
    'daily_transfer_limit', v_row.daily_transfer_limit,
    'updated_at', v_row.updated_at
  );
END;
$$;

DROP FUNCTION IF EXISTS public.admin_save_portal_settings(TEXT, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC);

CREATE OR REPLACE FUNCTION public.admin_save_portal_settings(
  p_platform_name TEXT,
  p_support_email TEXT,
  p_support_phone TEXT,
  p_default_currency TEXT,
  p_min_investment_amount NUMERIC,
  p_max_investment_amount NUMERIC,
  p_gateway_provider TEXT,
  p_merchant_id TEXT,
  p_api_key TEXT,
  p_api_secret TEXT,
  p_max_single_transaction NUMERIC,
  p_daily_transfer_limit NUMERIC
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.admin_portal_settings%ROWTYPE;
BEGIN
  IF NULLIF(trim(COALESCE(p_platform_name, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Platform name is required.';
  END IF;

  IF NULLIF(trim(COALESCE(p_support_email, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Support email is required.';
  END IF;

  IF NULLIF(trim(COALESCE(p_support_phone, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Support phone is required.';
  END IF;

  IF NULLIF(trim(COALESCE(p_default_currency, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Default currency is required.';
  END IF;

  IF p_min_investment_amount IS NULL OR p_min_investment_amount <= 0 THEN
    RAISE EXCEPTION 'Minimum investment amount must be greater than zero.';
  END IF;

  IF p_max_investment_amount IS NULL OR p_max_investment_amount < p_min_investment_amount THEN
    RAISE EXCEPTION 'Maximum investment must be greater than or equal to the minimum.';
  END IF;

  IF p_max_single_transaction IS NULL OR p_max_single_transaction <= 0 THEN
    RAISE EXCEPTION 'Max single transaction must be greater than zero.';
  END IF;

  IF p_daily_transfer_limit IS NULL OR p_daily_transfer_limit < p_max_single_transaction THEN
    RAISE EXCEPTION 'Daily transfer limit must be greater than or equal to max single transaction.';
  END IF;

  INSERT INTO public.admin_portal_settings (
    id,
    platform_name,
    support_email,
    support_phone,
    default_currency,
    min_investment_amount,
    max_investment_amount,
    gateway_provider,
    merchant_id,
    api_key,
    api_secret,
    max_single_transaction,
    daily_transfer_limit,
    updated_at
  )
  VALUES (
    1,
    trim(p_platform_name),
    lower(trim(p_support_email)),
    trim(p_support_phone),
    upper(trim(p_default_currency)),
    p_min_investment_amount,
    p_max_investment_amount,
    COALESCE(NULLIF(trim(p_gateway_provider), ''), 'Razorpay'),
    COALESCE(trim(p_merchant_id), ''),
    COALESCE(trim(p_api_key), ''),
    COALESCE(trim(p_api_secret), ''),
    p_max_single_transaction,
    p_daily_transfer_limit,
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    platform_name = EXCLUDED.platform_name,
    support_email = EXCLUDED.support_email,
    support_phone = EXCLUDED.support_phone,
    default_currency = EXCLUDED.default_currency,
    min_investment_amount = EXCLUDED.min_investment_amount,
    max_investment_amount = EXCLUDED.max_investment_amount,
    gateway_provider = EXCLUDED.gateway_provider,
    merchant_id = EXCLUDED.merchant_id,
    api_key = EXCLUDED.api_key,
    api_secret = EXCLUDED.api_secret,
    max_single_transaction = EXCLUDED.max_single_transaction,
    daily_transfer_limit = EXCLUDED.daily_transfer_limit,
    updated_at = NOW()
  RETURNING * INTO v_row;

  RETURN json_build_object(
    'platform_name', v_row.platform_name,
    'support_email', v_row.support_email,
    'support_phone', v_row.support_phone,
    'default_currency', v_row.default_currency,
    'min_investment_amount', v_row.min_investment_amount,
    'max_investment_amount', v_row.max_investment_amount,
    'gateway_provider', v_row.gateway_provider,
    'merchant_id', v_row.merchant_id,
    'api_key', v_row.api_key,
    'api_secret', v_row.api_secret,
    'max_single_transaction', v_row.max_single_transaction,
    'daily_transfer_limit', v_row.daily_transfer_limit,
    'updated_at', v_row.updated_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_reset_portal_settings()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.admin_save_portal_settings(
    'Venkatesh Traders',
    'support@rouru.finance',
    '+91 98765 43210',
    'INR',
    10000,
    10000000,
    'Razorpay',
    'MID_VT_2026_XXXX',
    'rzp_live_xxxxxxxx',
    'secret_xxxxxxxx',
    1000000,
    5000000
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_portal_settings() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_save_portal_settings(TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_reset_portal_settings() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_get_portal_settings() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_portal_settings(TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_portal_settings() TO anon, authenticated;
