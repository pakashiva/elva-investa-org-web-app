-- Live notification feed: pending investments, pending withdrawals, new customers.
-- Read state is stored separately so items stay derived from operational tables.

CREATE TABLE IF NOT EXISTS public.admin_notification_reads (
  notice_key TEXT PRIMARY KEY,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.admin_notification_reads ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.admin_notification_feed()
RETURNS TABLE (
  notice_key TEXT,
  kind TEXT,
  customer_name TEXT,
  amount NUMERIC,
  plan_name TEXT,
  occurred_at TIMESTAMPTZ,
  href TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    'investment:' || i.id::TEXT,
    'investment',
    p.full_name,
    i.fund_amount,
    i.name,
    i.created_at,
    '/investment-requests/' || i.id::TEXT
  FROM public.investments i
  INNER JOIN public.profiles p ON p.user_id = i.user_id
  WHERE i.status IN ('Pending', 'Under Review')

  UNION ALL

  SELECT
    'withdrawal:' || w.id::TEXT,
    'withdrawal',
    p.full_name,
    w.withdrawal_amount,
    NULL,
    COALESCE(w.created_at, w.requested_on::TIMESTAMPTZ),
    '/withdrawals'
  FROM public.withdrawals w
  INNER JOIN public.profiles p ON p.user_id = w.user_id
  WHERE w.status IN ('Processing', 'On Hold')

  UNION ALL

  SELECT
    'customer:' || p.user_id::TEXT,
    'customer',
    p.full_name,
    NULL,
    NULL,
    p.created_at,
    '/customers/' || p.user_id::TEXT
  FROM public.profiles p
  WHERE p.created_at >= (NOW() - INTERVAL '7 days');
$$;

CREATE OR REPLACE FUNCTION public.admin_list_notifications(
  p_filter TEXT DEFAULT 'all',
  p_kind TEXT DEFAULT 'all',
  p_search TEXT DEFAULT NULL,
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_filter TEXT := lower(COALESCE(p_filter, 'all'));
  v_kind TEXT := lower(COALESCE(p_kind, 'all'));
  v_search TEXT := NULLIF(trim(COALESCE(p_search, '')), '');
  v_rows JSON;
  v_unread BIGINT;
BEGIN
  WITH feed AS (
    SELECT
      n.notice_key,
      n.kind,
      n.customer_name,
      n.amount,
      n.plan_name,
      n.occurred_at,
      n.href,
      (r.notice_key IS NULL) AS unread
    FROM public.admin_notification_feed() n
    LEFT JOIN public.admin_notification_reads r ON r.notice_key = n.notice_key
    WHERE (p_from IS NULL OR (n.occurred_at AT TIME ZONE 'Asia/Kolkata')::DATE >= p_from)
      AND (p_to IS NULL OR (n.occurred_at AT TIME ZONE 'Asia/Kolkata')::DATE <= p_to)
      AND (
        v_search IS NULL
        OR n.customer_name ILIKE '%' || v_search || '%'
        OR COALESCE(n.plan_name, '') ILIKE '%' || v_search || '%'
        OR COALESCE(n.amount::TEXT, '') ILIKE '%' || v_search || '%'
      )
      AND (
        v_kind = 'all'
        OR n.kind = v_kind
      )
      AND (
        v_filter = 'all'
        OR (v_filter = 'unread' AND r.notice_key IS NULL)
        OR (v_filter IN ('investment', 'withdrawal', 'customer') AND n.kind = v_filter)
      )
  )
  SELECT
    COALESCE(
      (
        SELECT json_agg(json_build_object(
          'key', f.notice_key,
          'kind', f.kind,
          'customer_name', f.customer_name,
          'amount', f.amount,
          'plan_name', f.plan_name,
          'occurred_at', f.occurred_at,
          'href', f.href,
          'unread', f.unread
        ) ORDER BY f.occurred_at DESC)
        FROM feed f
      ),
      '[]'::JSON
    ),
    (
      SELECT COUNT(*) FROM public.admin_notification_feed() n
      LEFT JOIN public.admin_notification_reads r ON r.notice_key = n.notice_key
      WHERE r.notice_key IS NULL
    )
  INTO v_rows, v_unread;

  RETURN json_build_object(
    'rows', v_rows,
    'unreadCount', COALESCE(v_unread, 0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_notification_read(
  p_key TEXT,
  p_read BOOLEAN
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NULLIF(trim(COALESCE(p_key, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Notification key is required';
  END IF;

  IF COALESCE(p_read, TRUE) THEN
    INSERT INTO public.admin_notification_reads (notice_key)
    VALUES (trim(p_key))
    ON CONFLICT (notice_key) DO UPDATE SET read_at = NOW();
  ELSE
    DELETE FROM public.admin_notification_reads WHERE notice_key = trim(p_key);
  END IF;

  RETURN json_build_object('key', trim(p_key), 'unread', NOT COALESCE(p_read, TRUE));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_mark_all_notifications_read()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  INSERT INTO public.admin_notification_reads (notice_key)
  SELECT n.notice_key
  FROM public.admin_notification_feed() n
  ON CONFLICT (notice_key) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN json_build_object('marked', v_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_unread_notification_count()
RETURNS JSON
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'unreadCount',
    (
      SELECT COUNT(*)
      FROM public.admin_notification_feed() n
      LEFT JOIN public.admin_notification_reads r ON r.notice_key = n.notice_key
      WHERE r.notice_key IS NULL
    )
  );
$$;

REVOKE ALL ON FUNCTION public.admin_notification_feed() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_notifications(TEXT, TEXT, TEXT, DATE, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_notification_read(TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_mark_all_notifications_read() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_unread_notification_count() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_list_notifications(TEXT, TEXT, TEXT, DATE, DATE) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_notification_read(TEXT, BOOLEAN) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_mark_all_notifications_read() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_unread_notification_count() TO anon, authenticated;
