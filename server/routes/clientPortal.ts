import { Router } from 'express';
import { agreementsRouter } from './agreements.ts';
import { customersRouter } from './customers.ts';
import { investmentsRouter } from './investments.ts';
import { notificationsRouter } from './notifications.ts';
import { referralsRouter } from './referrals.ts';
import { reportsRouter } from './reports.ts';
import { settingsRouter } from './settings.ts';
import { tdsRouter } from './tds.ts';
import { withdrawalsRouter } from './withdrawals.ts';
import { pool } from '../db.ts';
import { asyncHandler, requireAuth, requireClientAdmin } from '../middleware.ts';
import type { AuthedRequest } from '../types.ts';
import { money } from '../util.ts';

export const clientPortalRouter = Router();

clientPortalRouter.use(requireAuth, requireClientAdmin);

clientPortalRouter.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const { clientId } = (req as AuthedRequest).auth;
    const months = Math.min(12, Math.max(3, Number(req.query.months ?? 6) || 6));
    const result = await pool.query(
      `SELECT
         c.id, c.name, c.client_code, c.status, c.support_email, c.support_phone,
         s.min_investment_amount, s.max_investment_amount, s.agreement_charges,
         s.default_interest_rate, s.default_tds_percent, s.default_payout_day,
         s.referral_rate, s.referral_tds_rate
       FROM clients c
       JOIN client_settings s ON s.client_id = c.id
       WHERE c.id = $1
       LIMIT 1`,
      [clientId]
    );

    const row = result.rows[0];
    if (!row || row.status !== 'active') {
      res.status(403).json({ error: 'This client is inactive. Contact ELVA.' });
      return;
    }

    const kpis = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM customers WHERE client_id = $1) AS total_customers,
         (SELECT COUNT(*)::int FROM customers
           WHERE client_id = $1
             AND (created_at AT TIME ZONE 'Asia/Kolkata')::date >= public.admin_ist_today() - 6
         ) AS new_registrations_this_week,
         (SELECT COUNT(*)::int FROM investments WHERE client_id = $1 AND status = 'Active') AS active_investments,
         (SELECT COUNT(*)::int FROM investments
           WHERE client_id = $1 AND status = 'Active'
             AND invested_date IS NOT NULL
             AND invested_date >= public.admin_ist_today() - 6
         ) AS active_investments_this_week,
         (SELECT COALESCE(SUM(fund_amount), 0) FROM investments WHERE client_id = $1 AND status = 'Active') AS total_invested,
         (SELECT COALESCE(SUM(fund_amount + COALESCE(total_earnings, 0)), 0)
            FROM investments WHERE client_id = $1 AND status = 'Active') AS total_wealth,
         (
           (SELECT COUNT(*)::int FROM investments
              WHERE client_id = $1 AND status IN ('Pending', 'Under Review'))
           +
           (SELECT COUNT(*)::int FROM agreement_renewal_requests
              WHERE client_id = $1 AND status = 'Pending')
         ) AS pending_investments,
         (SELECT COUNT(*)::int FROM withdrawals
            WHERE client_id = $1 AND status IN ('Processing', 'On Hold')) AS pending_withdrawals,
         (SELECT COALESCE(SUM(COALESCE(net_payout, withdrawal_amount)), 0)
            FROM withdrawals WHERE client_id = $1 AND status = 'Paid') AS total_withdrawals`,
      [clientId]
    );

    const ytd = await pool.query(
      `SELECT
         COALESCE(SUM(public.admin_monthly_net(i.fund_amount, i.interest_rate, i.tds_percent)), 0) AS interest_ytd,
         COALESCE(SUM(public.admin_monthly_tds(i.fund_amount, i.interest_rate, i.tds_percent)), 0) AS tds_ytd
       FROM investments i
       CROSS JOIN LATERAL generate_series(1, GREATEST(i.completed_interest_periods, 0)) AS period_no
       WHERE i.client_id = $1
         AND i.invested_date IS NOT NULL
         AND i.completed_interest_periods > 0
         AND (i.invested_date + (period_no * 30)) >= date_trunc('year', public.admin_ist_today())::date
         AND (i.invested_date + (period_no * 30)) <= public.admin_ist_today()`,
      [clientId]
    );

    const series = await pool.query(
      `WITH bounds AS (
         SELECT generate_series(
           date_trunc('month', public.admin_ist_today())::date - (($2::int - 1) * INTERVAL '1 month'),
           date_trunc('month', public.admin_ist_today())::date,
           INTERVAL '1 month'
         ) AS month_start
       )
       SELECT
         to_char(month_start, 'YYYY-MM') AS month,
         to_char(month_start, 'Mon') AS label,
         public.wealth_as_of($1, (month_start + INTERVAL '1 month')::date - 1) AS wealth,
         COALESCE((
           SELECT SUM(t.amount) FROM transactions t
           WHERE t.client_id = $1
             AND t.transaction_type = 'instant_credit'
             AND t.transaction_date >= month_start::date
             AND t.transaction_date < (month_start + INTERVAL '1 month')::date
         ), 0) AS inflow,
         COALESCE((
           SELECT SUM(t.amount) FROM transactions t
           WHERE t.client_id = $1
             AND t.transaction_type = 'withdrawal'
             AND t.transaction_date >= month_start::date
             AND t.transaction_date < (month_start + INTERVAL '1 month')::date
         ), 0) AS outflow
       FROM bounds
       ORDER BY month_start`,
      [clientId, months]
    );

    const kpi = kpis.rows[0] ?? {};
    const pendingInvestments = Number(kpi.pending_investments ?? 0);
    const pendingWithdrawals = Number(kpi.pending_withdrawals ?? 0);

    res.json({
      client: {
        id: row.id,
        name: row.name,
        clientCode: row.client_code,
        status: row.status,
        supportEmail: row.support_email,
        supportPhone: row.support_phone,
      },
      settings: {
        minInvestmentAmount: Number(row.min_investment_amount),
        maxInvestmentAmount: Number(row.max_investment_amount),
        agreementCharges: Number(row.agreement_charges),
        defaultInterestRate: Number(row.default_interest_rate),
        defaultTdsPercent: Number(row.default_tds_percent),
        defaultPayoutDay: Number(row.default_payout_day),
        referralRate: Number(row.referral_rate),
        referralTdsRate: Number(row.referral_tds_rate),
      },
      kpis: {
        totalWealthManaged: money(kpi.total_wealth),
        totalInvested: money(kpi.total_invested),
        activeInvestments: Number(kpi.active_investments ?? 0),
        activeInvestmentsThisWeek: Number(kpi.active_investments_this_week ?? 0),
        interestPaidYtd: money(ytd.rows[0]?.interest_ytd),
        tdsDeductedYtd: money(ytd.rows[0]?.tds_ytd),
        totalWithdrawals: money(kpi.total_withdrawals),
        totalCustomers: Number(kpi.total_customers ?? 0),
        newRegistrationsThisWeek: Number(kpi.new_registrations_this_week ?? 0),
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
    });
  })
);

clientPortalRouter.use('/customers', customersRouter);
clientPortalRouter.use('/investments', investmentsRouter);
clientPortalRouter.use('/agreements', agreementsRouter);
clientPortalRouter.use('/withdrawals', withdrawalsRouter);
clientPortalRouter.use('/referrals', referralsRouter);
clientPortalRouter.use('/tds', tdsRouter);
clientPortalRouter.use('/reports', reportsRouter);
clientPortalRouter.use('/notifications', notificationsRouter);
clientPortalRouter.use('/settings', settingsRouter);
