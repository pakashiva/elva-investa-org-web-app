-- =============================================================================
-- 014_dev_disable_admin_auth.sql
-- DEVELOPMENT ONLY. Paste this after 013.
--
-- The Admin Portal currently has no login. These RPCs stay SECURITY DEFINER
-- (so they can read investor rows) but no longer require admin_users.
-- Grant execute to anon so the Vite app can load data with the publishable key.
--
-- When login is added, replace is_admin() with the original 013 definition
-- and revoke anon execute on admin_get_dashboard / admin_list_customers.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT TRUE;
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admin_get_dashboard(INTEGER) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_customers(TEXT, TEXT, DATE, DATE, TEXT, INTEGER, INTEGER) TO anon, authenticated;
