ALTER TABLE investments
  ADD COLUMN IF NOT EXISTS referral_rate NUMERIC(8, 6);

UPDATE investments i
SET referral_rate = COALESCE(s.referral_rate, 0.01)
FROM client_settings s
WHERE s.client_id = i.client_id
  AND i.referral_rate IS NULL;

UPDATE investments
SET referral_rate = 0.01
WHERE referral_rate IS NULL;

ALTER TABLE investments
  ALTER COLUMN referral_rate SET DEFAULT 0.01;

ALTER TABLE investments
  ALTER COLUMN referral_rate SET NOT NULL;

CREATE OR REPLACE FUNCTION public.create_referral_reward_on_investment_active()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_settings RECORD;
  v_rate NUMERIC(8, 6);
  v_tds_rate NUMERIC(8, 6);
  v_gross NUMERIC(15, 2);
  v_tds NUMERIC(15, 2);
  v_net NUMERIC(15, 2);
  v_code TEXT;
BEGIN
  IF NEW.status <> 'Active'
     OR NOT (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    RETURN NEW;
  END IF;

  IF NEW.referrer_customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.referrer_customer_id = NEW.customer_id THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM public.referral_rewards WHERE investment_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  SELECT referral_rate, referral_tds_rate
  INTO v_settings
  FROM public.client_settings
  WHERE client_id = NEW.client_id;

  v_rate := COALESCE(NEW.referral_rate, v_settings.referral_rate, 0.01);
  v_tds_rate := COALESCE(v_settings.referral_tds_rate, 0.02);

  IF v_rate <= 0 OR v_rate > 1 THEN
    RAISE EXCEPTION 'Referral rate must be between 0 and 1.';
  END IF;

  SELECT referral_code INTO v_code
  FROM public.customers
  WHERE id = NEW.referrer_customer_id;

  v_gross := ROUND(NEW.fund_amount * v_rate, 2);
  v_tds := ROUND(v_gross * v_tds_rate, 2);
  v_net := ROUND(v_gross - v_tds, 2);

  INSERT INTO public.referral_rewards (
    client_id,
    referrer_customer_id,
    referred_customer_id,
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
    NEW.client_id,
    NEW.referrer_customer_id,
    NEW.customer_id,
    NEW.id,
    COALESCE(NULLIF(btrim(NEW.referral_code), ''), v_code, ''),
    NEW.fund_amount,
    v_rate,
    v_gross,
    v_tds_rate,
    v_tds,
    v_net,
    'Pending'
  )
  ON CONFLICT (investment_id) DO NOTHING;

  RETURN NEW;
END;
$$;
