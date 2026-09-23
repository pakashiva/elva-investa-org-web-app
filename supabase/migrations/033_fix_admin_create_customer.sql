-- Fix admin_create_customer: use only existing core columns, then set optional
-- bank fields if present. Surface the real SQL error instead of a vague message.

ALTER TABLE public.bank_accounts
  ADD COLUMN IF NOT EXISTS account_holder_name TEXT;

ALTER TABLE public.bank_accounts
  ADD COLUMN IF NOT EXISTS branch_name TEXT;

DROP FUNCTION IF EXISTS public.admin_create_customer(
  TEXT, TEXT, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC
);

DROP FUNCTION IF EXISTS public.admin_create_customer(
  TEXT, TEXT, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
);

CREATE OR REPLACE FUNCTION public.admin_create_customer(
  p_full_name TEXT,
  p_email TEXT,
  p_mobile TEXT,
  p_date_of_birth DATE,
  p_nominee_name TEXT,
  p_nominee_relationship TEXT,
  p_address TEXT,
  p_account_holder_name TEXT,
  p_account_number TEXT,
  p_ifsc_code TEXT,
  p_branch_name TEXT,
  p_account_type TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_user_id UUID := gen_random_uuid();
  v_email TEXT := lower(trim(COALESCE(p_email, '')));
  v_mobile_digits TEXT := public.normalize_mobile_digits(p_mobile);
  v_full_name TEXT := trim(COALESCE(p_full_name, ''));
  v_nominee_name TEXT := trim(COALESCE(p_nominee_name, ''));
  v_relationship TEXT := trim(COALESCE(p_nominee_relationship, ''));
  v_address TEXT := trim(COALESCE(p_address, ''));
  v_holder TEXT := trim(COALESCE(p_account_holder_name, ''));
  v_account TEXT := regexp_replace(COALESCE(p_account_number, ''), '\s', '', 'g');
  v_ifsc TEXT := upper(regexp_replace(COALESCE(p_ifsc_code, ''), '\s', '', 'g'));
  v_branch TEXT := trim(COALESCE(p_branch_name, ''));
  v_account_type TEXT := initcap(trim(COALESCE(p_account_type, 'Savings')));
  v_temp_password TEXT;
  v_customer_id TEXT;
  v_bank_id UUID;
  v_nominee_id UUID;
  v_instance_id UUID;
  v_has_holder BOOLEAN;
  v_has_branch BOOLEAN;
  v_has_nominee_aadhaar BOOLEAN;
  v_has_nominee_name BOOLEAN;
BEGIN
  IF v_full_name = '' THEN
    RAISE EXCEPTION 'Full name is required.';
  END IF;

  IF v_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' THEN
    RAISE EXCEPTION 'Enter a valid email address.';
  END IF;

  IF v_mobile_digits IS NULL OR length(v_mobile_digits) <> 10 OR v_mobile_digits !~ '^[6-9][0-9]{9}$' THEN
    RAISE EXCEPTION 'Enter a valid 10-digit Indian mobile number.';
  END IF;

  IF p_date_of_birth IS NULL OR p_date_of_birth > (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE THEN
    RAISE EXCEPTION 'Enter a valid date of birth.';
  END IF;

  IF p_date_of_birth > ((NOW() AT TIME ZONE 'Asia/Kolkata')::DATE - INTERVAL '18 years') THEN
    RAISE EXCEPTION 'Customer must be at least 18 years old.';
  END IF;

  IF v_nominee_name = '' THEN
    RAISE EXCEPTION 'Nominee name is required.';
  END IF;

  IF v_relationship = '' THEN
    RAISE EXCEPTION 'Nominee relationship is required.';
  END IF;

  IF v_address = '' THEN
    RAISE EXCEPTION 'Full address is required.';
  END IF;

  IF v_holder = '' THEN
    RAISE EXCEPTION 'Account holder name is required.';
  END IF;

  IF v_account !~ '^[0-9]{9,18}$' THEN
    RAISE EXCEPTION 'Account number must be 9 to 18 digits.';
  END IF;

  IF v_ifsc !~ '^[A-Z]{4}0[A-Z0-9]{6}$' THEN
    RAISE EXCEPTION 'Enter a valid IFSC code (e.g. SBIN0001234).';
  END IF;

  IF v_branch = '' THEN
    RAISE EXCEPTION 'Branch name is required.';
  END IF;

  IF v_account_type NOT IN ('Savings', 'Current') THEN
    RAISE EXCEPTION 'Account type must be Savings or Current.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM auth.users WHERE lower(email) = v_email
  ) THEN
    RAISE EXCEPTION 'An account with this email already exists.';
  END IF;

  IF NOT public.is_email_mobile_combo_available(v_email, v_mobile_digits) THEN
    RAISE EXCEPTION 'This email and mobile combination is already registered.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE public.normalize_mobile_digits(mobile_number) = v_mobile_digits
  ) THEN
    RAISE EXCEPTION 'This mobile number is already registered.';
  END IF;

  v_temp_password := 'Cust@' || right(v_mobile_digits, 4) || '!';

  SELECT id INTO v_instance_id FROM auth.instances LIMIT 1;
  IF v_instance_id IS NULL THEN
    v_instance_id := '00000000-0000-0000-0000-000000000000';
  END IF;

  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    recovery_token,
    email_change_token_new,
    email_change
  ) VALUES (
    v_instance_id,
    v_user_id,
    'authenticated',
    'authenticated',
    v_email,
    crypt(v_temp_password, gen_salt('bf')),
    NOW(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', v_full_name, 'created_by', 'admin_portal'),
    NOW(),
    NOW(),
    '',
    '',
    '',
    ''
  );

  INSERT INTO auth.identities (
    id,
    user_id,
    identity_data,
    provider,
    provider_id,
    last_sign_in_at,
    created_at,
    updated_at
  ) VALUES (
    gen_random_uuid(),
    v_user_id,
    jsonb_build_object('sub', v_user_id::text, 'email', v_email),
    'email',
    v_email,
    NOW(),
    NOW(),
    NOW()
  );

  INSERT INTO public.profiles (
    user_id,
    full_name,
    mobile_number,
    email_address,
    date_of_birth,
    address,
    city,
    state,
    pin_code,
    authorized,
    mobile_verified
  ) VALUES (
    v_user_id,
    v_full_name,
    '+91' || v_mobile_digits,
    v_email,
    p_date_of_birth,
    v_address,
    '—',
    '—',
    '000000',
    TRUE,
    TRUE
  );

  SELECT customer_id INTO v_customer_id
  FROM public.customers
  WHERE user_id = v_user_id;

  IF v_customer_id IS NULL THEN
    v_customer_id := public.ensure_customer_for_user(v_user_id);
  END IF;

  -- Core bank columns only (always present on mobile schema)
  INSERT INTO public.bank_accounts (
    user_id,
    bank_name,
    account_number,
    ifsc_code,
    account_type,
    is_primary
  ) VALUES (
    v_user_id,
    COALESCE(NULLIF(v_branch, ''), left(v_ifsc, 4)),
    v_account,
    v_ifsc,
    v_account_type,
    TRUE
  )
  RETURNING id INTO v_bank_id;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'bank_accounts' AND column_name = 'account_holder_name'
  ) INTO v_has_holder;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'bank_accounts' AND column_name = 'branch_name'
  ) INTO v_has_branch;

  IF v_has_holder AND v_has_branch THEN
    EXECUTE
      'UPDATE public.bank_accounts SET account_holder_name = $1, branch_name = $2 WHERE id = $3'
      USING v_holder, v_branch, v_bank_id;
  ELSIF v_has_holder THEN
    EXECUTE
      'UPDATE public.bank_accounts SET account_holder_name = $1 WHERE id = $2'
      USING v_holder, v_bank_id;
  ELSIF v_has_branch THEN
    EXECUTE
      'UPDATE public.bank_accounts SET branch_name = $1 WHERE id = $2'
      USING v_branch, v_bank_id;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'nominees' AND column_name = 'name'
  ) INTO v_has_nominee_name;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'nominees' AND column_name = 'aadhaar_number'
  ) INTO v_has_nominee_aadhaar;

  IF v_has_nominee_name AND v_has_nominee_aadhaar THEN
    EXECUTE
      'INSERT INTO public.nominees (user_id, name, relationship, percentage, aadhaar_number)
       VALUES ($1, $2, $3, 100, $4) RETURNING id'
      INTO v_nominee_id
      USING v_user_id, v_nominee_name, v_relationship, '000000000000';
  ELSIF v_has_nominee_name THEN
    EXECUTE
      'INSERT INTO public.nominees (user_id, name, relationship, percentage)
       VALUES ($1, $2, $3, 100) RETURNING id'
      INTO v_nominee_id
      USING v_user_id, v_nominee_name, v_relationship;
  ELSE
    EXECUTE
      'INSERT INTO public.nominees (user_id, full_name, relationship, percentage)
       VALUES ($1, $2, $3, 100) RETURNING id'
      INTO v_nominee_id
      USING v_user_id, v_nominee_name, v_relationship;
  END IF;

  RETURN json_build_object(
    'ok', true,
    'user_id', v_user_id,
    'customer_id', v_customer_id,
    'bank_account_id', v_bank_id,
    'nominee_id', v_nominee_id,
    'temp_password', v_temp_password
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Customer with this email or mobile already exists.';
  WHEN OTHERS THEN
    RAISE EXCEPTION '%', SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_customer(
  TEXT, TEXT, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_create_customer(
  TEXT, TEXT, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO anon, authenticated;
