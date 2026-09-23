import { Router } from 'express';
import { pool } from '../db';
import { asyncHandler, requireAuth, requireSuperAdmin } from '../middleware';
import { money } from '../util';

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth, requireSuperAdmin);

dashboardRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const months = Math.min(12, Math.max(3, Number(req.query.months ?? 6) || 6));

    const counts = await pool.query(
      `SELECT
         COUNT(*)::int AS total_clients,
         COUNT(*) FILTER (WHERE status = 'active')::int AS active_clients,
         COUNT(*) FILTER (WHERE status = 'inactive')::int AS inactive_clients,
         (SELECT COUNT(*)::int FROM customers) AS total_customers,
         (SELECT COUNT(*)::int FROM investments WHERE status = 'Active') AS total_active_investments,
         (SELECT COALESCE(SUM(fund_amount), 0) FROM investments WHERE status = 'Active') AS total_invested_amount,
         (SELECT COALESCE(SUM(fund_amount + COALESCE(total_earnings, 0)), 0)
            FROM investments WHERE status = 'Active') AS total_wealth,
         (SELECT COUNT(*)::int FROM investments WHERE status IN ('Pending', 'Under Review')) AS pending_investments,
         (SELECT COUNT(*)::int FROM withdrawals WHERE status IN ('Processing', 'On Hold')) AS pending_withdrawals,
         (SELECT COALESCE(SUM(COALESCE(net_payout, withdrawal_amount)), 0)
            FROM withdrawals WHERE status = 'Paid') AS total_withdrawals,
         (SELECT COALESCE(SUM(public.wealth_as_of(c.id, public.admin_ist_today())), 0) FROM clients c) AS wealth_as_of
       FROM clients`
    );

    const ytd = await pool.query(
      `SELECT
         COALESCE(SUM(public.admin_monthly_net(i.fund_amount, i.interest_rate, i.tds_percent)), 0) AS interest_ytd,
         COALESCE(SUM(public.admin_monthly_tds(i.fund_amount, i.interest_rate, i.tds_percent)), 0) AS tds_ytd
       FROM investments i
       CROSS JOIN LATERAL generate_series(1, GREATEST(i.completed_interest_periods, 0)) AS period_no
       WHERE i.invested_date IS NOT NULL
         AND i.completed_interest_periods > 0
         AND (i.invested_date + (period_no * 30)) >= date_trunc('year', public.admin_ist_today())::date
         AND (i.invested_date + (period_no * 30)) <= public.admin_ist_today()`
    );

    const series = await pool.query(
      `WITH bounds AS (
         SELECT generate_series(
           date_trunc('month', public.admin_ist_today())::date - (($1::int - 1) * INTERVAL '1 month'),
           date_trunc('month', public.admin_ist_today())::date,
           INTERVAL '1 month'
         ) AS month_start
       )
       SELECT
         to_char(month_start, 'YYYY-MM') AS month,
         to_char(month_start, 'Mon') AS label,
         (
           SELECT COALESCE(SUM(public.wealth_as_of(c.id, (month_start + INTERVAL '1 month')::date - 1)), 0)
           FROM clients c
         ) AS wealth,
         COALESCE((
           SELECT SUM(t.amount) FROM transactions t
           WHERE t.transaction_type = 'instant_credit'
             AND t.transaction_date >= month_start::date
             AND t.transaction_date < (month_start + INTERVAL '1 month')::date
         ), 0) AS inflow,
         COALESCE((
           SELECT SUM(t.amount) FROM transactions t
           WHERE t.transaction_type = 'withdrawal'
             AND t.transaction_date >= month_start::date
             AND t.transaction_date < (month_start + INTERVAL '1 month')::date
         ), 0) AS outflow
       FROM bounds
       ORDER BY month_start`,
      [months]
    );

    const recent = await pool.query(
      `SELECT
         c.id,
         c.name,
         c.client_code,
         c.status,
         c.created_at,
         s.min_investment_amount,
         s.max_investment_amount,
         u.username AS admin_username,
         (SELECT COUNT(*)::int FROM customers x WHERE x.client_id = c.id) AS customer_count,
         (SELECT COALESCE(SUM(fund_amount), 0)
            FROM investments x WHERE x.client_id = c.id AND x.status = 'Active') AS total_invested
       FROM clients c
       JOIN client_settings s ON s.client_id = c.id
       JOIN users u ON u.client_id = c.id AND u.role = 'client_admin'
       ORDER BY c.created_at DESC
       LIMIT 8`
    );

    const row = counts.rows[0] ?? {};
    const pendingInvestments = Number(row.pending_investments ?? 0);
    const pendingWithdrawals = Number(row.pending_withdrawals ?? 0);

    res.json({
      kpis: {
        totalClients: Number(row.total_clients ?? 0),
        activeClients: Number(row.active_clients ?? 0),
        inactiveClients: Number(row.inactive_clients ?? 0),
        totalCustomers: Number(row.total_customers ?? 0),
        totalActiveInvestments: Number(row.total_active_investments ?? 0),
        totalInvestedAmount: money(row.total_invested_amount),
        totalWealthManaged: money(row.wealth_as_of ?? row.total_wealth),
        totalWithdrawals: money(row.total_withdrawals),
        interestPaidYtd: money(ytd.rows[0]?.interest_ytd),
        tdsDeductedYtd: money(ytd.rows[0]?.tds_ytd),
        pendingRequests: pendingInvestments + pendingWithdrawals,
        pendingInvestments,
        pendingWithdrawals,
      },
      wealthSeries: series.rows.map((point) => ({
        month: point.month,
        label: point.label,
        wealth: money(point.wealth),
      })),
      flowSeries: series.rows.map((point) => ({
        month: point.month,
        label: point.label,
        inflow: money(point.inflow),
        outflow: money(point.outflow),
      })),
      recentClients: recent.rows.map((item) => ({
        id: item.id,
        name: item.name,
        clientCode: item.client_code,
        status: item.status,
        createdAt: item.created_at,
        minInvestmentAmount: Number(item.min_investment_amount),
        maxInvestmentAmount: Number(item.max_investment_amount),
        adminUsername: item.admin_username,
        customerCount: Number(item.customer_count ?? 0),
        totalInvested: money(item.total_invested),
      })),
    });
  })
);
