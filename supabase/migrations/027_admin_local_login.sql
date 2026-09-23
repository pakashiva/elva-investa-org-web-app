-- Simple Admin Portal username/password login (not Supabase Auth).
-- Default: username admin / password 1234 — change via Manage Passwords.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.admin_portal_users (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.admin_portal_users (id, username, password_hash)
VALUES (1, 'admin', extensions.crypt('1234', extensions.gen_salt('bf')))
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.admin_portal_users ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.admin_portal_login(
  p_username TEXT,
  p_password TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_row public.admin_portal_users%ROWTYPE;
BEGIN
  IF NULLIF(trim(COALESCE(p_username, '')), '') IS NULL
     OR NULLIF(COALESCE(p_password, ''), '') IS NULL THEN
    RAISE EXCEPTION 'Username and password are required.';
  END IF;

  SELECT * INTO v_row
  FROM public.admin_portal_users
  WHERE lower(username) = lower(trim(p_username))
  LIMIT 1;

  IF NOT FOUND
     OR v_row.password_hash IS DISTINCT FROM extensions.crypt(p_password, v_row.password_hash) THEN
    RAISE EXCEPTION 'Invalid username or password.';
  END IF;

  RETURN json_build_object(
    'ok', true,
    'username', v_row.username
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_portal_change_password(
  p_username TEXT,
  p_old_password TEXT,
  p_new_password TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_row public.admin_portal_users%ROWTYPE;
BEGIN
  IF NULLIF(trim(COALESCE(p_username, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Username is required.';
  END IF;

  IF NULLIF(COALESCE(p_old_password, ''), '') IS NULL THEN
    RAISE EXCEPTION 'Current password is required.';
  END IF;

  IF NULLIF(COALESCE(p_new_password, ''), '') IS NULL THEN
    RAISE EXCEPTION 'New password is required.';
  END IF;

  IF char_length(p_new_password) < 4 THEN
    RAISE EXCEPTION 'New password must be at least 4 characters.';
  END IF;

  IF p_new_password = p_old_password THEN
    RAISE EXCEPTION 'New password must be different from the current password.';
  END IF;

  SELECT * INTO v_row
  FROM public.admin_portal_users
  WHERE lower(username) = lower(trim(p_username))
  LIMIT 1;

  IF NOT FOUND
     OR v_row.password_hash IS DISTINCT FROM extensions.crypt(p_old_password, v_row.password_hash) THEN
    RAISE EXCEPTION 'Current password is incorrect.';
  END IF;

  UPDATE public.admin_portal_users
  SET
    password_hash = extensions.crypt(p_new_password, extensions.gen_salt('bf')),
    updated_at = NOW()
  WHERE id = v_row.id;

  RETURN json_build_object(
    'ok', true,
    'username', v_row.username
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_portal_login(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_portal_change_password(TEXT, TEXT, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_portal_login(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_portal_change_password(TEXT, TEXT, TEXT) TO anon, authenticated;
