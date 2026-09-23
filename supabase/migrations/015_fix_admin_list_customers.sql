-- Fix admin_list_customers: CTE "filtered" was only in scope for the first
-- statement, so the second query raised: relation "filtered" does not exist.

CREATE OR REPLACE FUNCTION public.admin_list_customers(
  p_filter TEXT DEFAULT 'all',
  p_search TEXT DEFAULT NULL,
  p_join_from DATE DEFAULT NULL,
  p_join_to DATE DEFAULT NULL,
  p_sort TEXT DEFAULT 'joined_desc',
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
  v_filter TEXT := lower(COALESCE(p_filter, 'all'));
  v_search TEXT := NULLIF(trim(COALESCE(p_search, '')), '');
  v_limit INTEGER := GREATEST(1, LEAST(COALESCE(p_limit, 10), 50));
  v_offset INTEGER := GREATEST(0, COALESCE(p_offset, 0));
  v_total BIGINT;
  v_rows JSON;
BEGIN
  WITH base AS (
    SELECT
      c.user_id,
      c.customer_id,
      p.full_name,
      p.mobile_number,
      p.email_address,
      p.created_at AS joined_at,
      k.pan_number,
      COUNT(i.id) FILTER (WHERE i.status = 'Active') AS active_investments,
      COUNT(i.id) FILTER (WHERE i.status = 'Pending') AS pending_investments,
      COUNT(i.id) FILTER (WHERE i.status = 'Closed') AS closed_investments,
      COUNT(i.id) AS total_investments,
      COALESCE(SUM(i.fund_amount) FILTER (WHERE i.status = 'Active'), 0) AS total_invested
    FROM public.customers c
    INNER JOIN public.profiles p ON p.user_id = c.user_id
    LEFT JOIN public.kyc_documents k ON k.user_id = c.user_id
    LEFT JOIN public.investments i ON i.user_id = c.user_id
    WHERE (p_join_from IS NULL OR (p.created_at AT TIME ZONE 'Asia/Kolkata')::DATE >= p_join_from)
      AND (p_join_to IS NULL OR (p.created_at AT TIME ZONE 'Asia/Kolkata')::DATE <= p_join_to)
      AND (
        v_search IS NULL
        OR p.full_name ILIKE '%' || v_search || '%'
        OR p.mobile_number ILIKE '%' || v_search || '%'
        OR p.email_address ILIKE '%' || v_search || '%'
        OR COALESCE(k.pan_number, '') ILIKE '%' || v_search || '%'
        OR COALESCE(c.customer_id, '') ILIKE '%' || v_search || '%'
      )
    GROUP BY
      c.user_id,
      c.customer_id,
      p.full_name,
      p.mobile_number,
      p.email_address,
      p.created_at,
      k.pan_number
  ),
  filtered AS (
    SELECT *
    FROM base
    WHERE CASE v_filter
      WHEN 'active' THEN active_investments > 0
      WHEN 'inactive' THEN active_investments = 0
      WHEN 'with_investments' THEN total_investments > 0
      WHEN 'no_investment' THEN total_investments = 0
      ELSE TRUE
    END
  ),
  paged AS (
    SELECT
      user_id,
      customer_id,
      full_name,
      mobile_number,
      email_address,
      pan_number,
      active_investments,
      pending_investments,
      closed_investments,
      total_investments,
      total_invested,
      joined_at
    FROM filtered
    ORDER BY
      CASE WHEN p_sort = 'joined_asc' THEN joined_at END ASC,
      CASE WHEN p_sort = 'joined_desc' THEN joined_at END DESC,
      joined_at DESC
    LIMIT v_limit
    OFFSET v_offset
  )
  SELECT
    (SELECT COUNT(*) FROM filtered),
    COALESCE((SELECT json_agg(row_to_json(p)) FROM paged p), '[]'::JSON)
  INTO v_total, v_rows;

  RETURN json_build_object(
    'rows', v_rows,
    'total', COALESCE(v_total, 0),
    'limit', v_limit,
    'offset', v_offset
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_customers(TEXT, TEXT, DATE, DATE, TEXT, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_customers(TEXT, TEXT, DATE, DATE, TEXT, INTEGER, INTEGER) TO anon, authenticated;
