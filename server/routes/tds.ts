import { Router } from 'express';
import { pool } from '../db';
import { asyncHandler } from '../middleware';
import type { AuthedRequest } from '../types';
import { asNumber, money } from '../util';

export const tdsRouter = Router();

tdsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { clientId } = (req as AuthedRequest).auth;
    const todayRes = await pool.query(`SELECT to_char(public.admin_ist_today(), 'YYYY-MM-DD') AS today`);
    const today = String(todayRes.rows[0]?.today);
    const fyStartRes = await pool.query(
      `SELECT to_char(public.admin_india_fy_start($1::date), 'YYYY-MM-DD') AS fy_start`,
      [today]
    );
    const fyStart = String(fyStartRes.rows[0]?.fy_start);
    const fyEndRes = await pool.query(
      `SELECT to_char(($1::date + INTERVAL '1 year')::date, 'YYYY-MM-DD') AS fy_end`,
      [fyStart]
    );
    const fyEnd = String(fyEndRes.rows[0]?.fy_end);
    const quarterRes = await pool.query(
      `SELECT public.admin_india_fy_quarter($1::date) AS quarter`,
      [today]
    );
    const currentQ = Number(quarterRes.rows[0]?.quarter ?? 1);
    const fyYear = Number(fyStart.slice(0, 4));
    const fyShort = `FY${String(fyYear).slice(2)}-${String(fyYear + 1).slice(2)}`;
    const fyLabel = `Financial Year ${fyYear}-${String(fyYear + 1).slice(2)}`;

    const totals = await pool.query(
      `SELECT
         COALESCE((SELECT SUM(tds_deducted_amount) FROM investments WHERE client_id = $1), 0)
         + COALESCE((SELECT SUM(tds_amount) FROM referral_rewards WHERE client_id = $1), 0) AS total_tds`,
      [clientId]
    );

    const periods = await pool.query(
      `WITH periods AS (
         SELECT
           i.id,
           i.code,
           i.fund_amount,
           i.tds_percent,
           c.full_name,
           public.admin_monthly_interest(i.fund_amount, i.interest_rate) AS gross_interest,
           public.admin_monthly_tds(i.fund_amount, i.interest_rate, i.tds_percent) AS tds_amount,
           (i.invested_date + (period_no * 30)) AS period_end
         FROM investments i
         JOIN customers c ON c.id = i.customer_id AND c.client_id = i.client_id
         CROSS JOIN LATERAL generate_series(1, GREATEST(i.completed_interest_periods, 0)) AS period_no
         WHERE i.client_id = $1
           AND i.invested_date IS NOT NULL
           AND i.completed_interest_periods > 0
       ),
       referral_days AS (
         SELECT r.tds_amount, (r.created_at AT TIME ZONE 'Asia/Kolkata')::date AS credited_on
         FROM referral_rewards r
         WHERE r.client_id = $1
       )
       SELECT
         COALESCE((SELECT SUM(tds_amount) FROM periods WHERE period_end >= date_trunc('month', $2::date)::date AND period_end <= $2::date), 0)
         + COALESCE((SELECT SUM(tds_amount) FROM referral_days WHERE credited_on >= date_trunc('month', $2::date)::date AND credited_on <= $2::date), 0) AS month_tds,
         COALESCE((SELECT SUM(tds_amount) FROM periods WHERE period_end >= $3::date AND period_end < $4::date AND period_end <= $2::date), 0)
         + COALESCE((SELECT SUM(tds_amount) FROM referral_days WHERE credited_on >= $3::date AND credited_on < $4::date AND credited_on <= $2::date), 0) AS fy_tds`,
      [clientId, today, fyStart, fyEnd]
    );

    const rows = await pool.query(
      `SELECT
         i.id AS investment_id,
         c.full_name AS customer_name,
         i.code AS investment_code,
         i.fund_amount AS principal,
         SUM(public.admin_monthly_interest(i.fund_amount, i.interest_rate)) AS gross_interest,
         i.tds_percent,
         SUM(public.admin_monthly_tds(i.fund_amount, i.interest_rate, i.tds_percent)) AS tds_amount,
         public.admin_india_fy_quarter(i.invested_date + (period_no * 30)) AS quarter
       FROM investments i
       JOIN customers c ON c.id = i.customer_id AND c.client_id = i.client_id
       CROSS JOIN LATERAL generate_series(1, GREATEST(i.completed_interest_periods, 0)) AS period_no
       WHERE i.client_id = $1
         AND i.invested_date IS NOT NULL
         AND i.completed_interest_periods > 0
         AND (i.invested_date + (period_no * 30)) >= $2::date
         AND (i.invested_date + (period_no * 30)) < $3::date
         AND (i.invested_date + (period_no * 30)) <= $4::date
       GROUP BY i.id, c.full_name, i.code, i.fund_amount, i.tds_percent,
                public.admin_india_fy_quarter(i.invested_date + (period_no * 30))
       ORDER BY quarter DESC, c.full_name, i.code`,
      [clientId, fyStart, fyEnd, today]
    );

    const quarterSums = await pool.query(
      `WITH periods AS (
         SELECT public.admin_monthly_tds(i.fund_amount, i.interest_rate, i.tds_percent) AS tds_amount,
                public.admin_india_fy_quarter(i.invested_date + (period_no * 30)) AS quarter
         FROM investments i
         CROSS JOIN LATERAL generate_series(1, GREATEST(i.completed_interest_periods, 0)) AS period_no
         WHERE i.client_id = $1
           AND i.invested_date IS NOT NULL
           AND i.completed_interest_periods > 0
           AND (i.invested_date + (period_no * 30)) >= $2::date
           AND (i.invested_date + (period_no * 30)) < $3::date
           AND (i.invested_date + (period_no * 30)) <= $4::date
       ),
       refs AS (
         SELECT r.tds_amount, public.admin_india_fy_quarter((r.created_at AT TIME ZONE 'Asia/Kolkata')::date) AS quarter
         FROM referral_rewards r
         WHERE r.client_id = $1
           AND (r.created_at AT TIME ZONE 'Asia/Kolkata')::date >= $2::date
           AND (r.created_at AT TIME ZONE 'Asia/Kolkata')::date < $3::date
           AND (r.created_at AT TIME ZONE 'Asia/Kolkata')::date <= $4::date
       )
       SELECT q AS quarter,
              COALESCE((SELECT SUM(tds_amount) FROM periods p WHERE p.quarter = q), 0)
              + COALESCE((SELECT SUM(tds_amount) FROM refs r WHERE r.quarter = q), 0) AS amount
       FROM generate_series(1, 4) AS q
       ORDER BY q`,
      [clientId, fyStart, fyEnd, today]
    );

    res.json({
      kpis: {
        totalTds: money(totals.rows[0]?.total_tds),
        currentMonthTds: money(periods.rows[0]?.month_tds),
        currentFyTds: money(periods.rows[0]?.fy_tds),
        fyLabel,
        fyShort,
      },
      rows: rows.rows.map((row) => ({
        investment_id: row.investment_id,
        customer_name: row.customer_name,
        investment_code: row.investment_code,
        principal: money(row.principal),
        gross_interest: money(row.gross_interest),
        tds_percent: asNumber(row.tds_percent),
        tds_amount: money(row.tds_amount),
        quarter: Number(row.quarter),
        period: `Q${Number(row.quarter)} ${fyShort}`,
      })),
      quarters: quarterSums.rows.map((row) => ({
        quarter: Number(row.quarter),
        label: `Q${Number(row.quarter)}`,
        amount: money(row.amount),
        isCurrent: Number(row.quarter) === currentQ,
      })),
    });
  })
);
