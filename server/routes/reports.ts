import { Router } from 'express';
import { pool } from '../db';
import { asyncHandler } from '../middleware';
import type { AuthedRequest } from '../types';
import { isUuid, money, text } from '../util';

export const reportsRouter = Router();

type ReportKind =
  | 'investment'
  | 'interest'
  | 'withdrawal'
  | 'tds'
  | 'referral'
  | 'wealth'
  | 'upcoming_payout'
  | 'payout_range'
  | 'bulk';

function asKind(value: string): ReportKind | null {
  const kind = value.toLowerCase();
  if (
    kind === 'investment' ||
    kind === 'interest' ||
    kind === 'withdrawal' ||
    kind === 'tds' ||
    kind === 'referral' ||
    kind === 'wealth' ||
    kind === 'upcoming_payout' ||
    kind === 'payout_range' ||
    kind === 'bulk'
  ) {
    return kind;
  }
  return null;
}

async function sheetInvestments(clientId: string, from: string, to: string) {
  const result = await pool.query(
    `SELECT
       c.full_name AS "Customer Name",
       i.code AS "Investment ID",
       i.name AS "Plan",
       i.status AS "Status",
       i.fund_amount AS "Principal",
       COALESCE(i.current_value, i.fund_amount + COALESCE(i.total_earnings, 0)) AS "Current Value",
       COALESCE(i.total_earnings, 0) AS "Net Earnings",
       COALESCE(i.tds_deducted_amount, 0) AS "TDS Deducted",
       i.interest_rate AS "Interest Rate",
       i.invested_date AS "Invested Date",
       (i.created_at AT TIME ZONE 'Asia/Kolkata')::date AS "Created"
     FROM investments i
     JOIN customers c ON c.id = i.customer_id AND c.client_id = i.client_id
     WHERE i.client_id = $1
       AND (i.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $2::date AND $3::date
     ORDER BY i.created_at DESC
     LIMIT 2000`,
    [clientId, from, to]
  );
  return result.rows;
}

async function sheetInterest(clientId: string, from: string, to: string) {
  const result = await pool.query(
    `SELECT
       c.full_name AS "Customer Name",
       i.code AS "Investment ID",
       i.fund_amount AS "Principal",
       i.interest_rate AS "Rate",
       (i.invested_date + (period_no * 30)) AS "Period End",
       public.admin_monthly_interest(i.fund_amount, i.interest_rate) AS "Gross Interest",
       public.admin_monthly_tds(i.fund_amount, i.interest_rate, i.tds_percent) AS "TDS",
       public.admin_monthly_net(i.fund_amount, i.interest_rate, i.tds_percent) AS "Net Interest"
     FROM investments i
     JOIN customers c ON c.id = i.customer_id AND c.client_id = i.client_id
     CROSS JOIN LATERAL generate_series(1, GREATEST(i.completed_interest_periods, 0)) AS period_no
     WHERE i.client_id = $1
       AND i.invested_date IS NOT NULL
       AND (i.invested_date + (period_no * 30)) BETWEEN $2::date AND $3::date
     ORDER BY (i.invested_date + (period_no * 30)) DESC
     LIMIT 2000`,
    [clientId, from, to]
  );
  return result.rows;
}

async function sheetWithdrawals(clientId: string, from: string, to: string) {
  const result = await pool.query(
    `SELECT
       c.full_name AS "Customer Name",
       i.code AS "Investment ID",
       w.strategy AS "Strategy",
       w.status AS "Status",
       w.withdrawal_amount AS "Requested",
       w.net_payout AS "Net Payout",
       w.requested_on AS "Requested On"
     FROM withdrawals w
     JOIN customers c ON c.id = w.customer_id AND c.client_id = w.client_id
     JOIN investments i ON i.id = w.investment_id
     WHERE w.client_id = $1
       AND w.requested_on BETWEEN $2::date AND $3::date
     ORDER BY w.requested_on DESC
     LIMIT 2000`,
    [clientId, from, to]
  );
  return result.rows;
}

async function sheetTds(clientId: string, from: string, to: string) {
  const interest = await pool.query(
    `SELECT
       c.full_name AS "Customer Name",
       i.code AS "Source",
       'Interest' AS "Type",
       public.admin_monthly_tds(i.fund_amount, i.interest_rate, i.tds_percent) AS "TDS Amount",
       (i.invested_date + (period_no * 30)) AS "Date"
     FROM investments i
     JOIN customers c ON c.id = i.customer_id AND c.client_id = i.client_id
     CROSS JOIN LATERAL generate_series(1, GREATEST(i.completed_interest_periods, 0)) AS period_no
     WHERE i.client_id = $1
       AND i.invested_date IS NOT NULL
       AND (i.invested_date + (period_no * 30)) BETWEEN $2::date AND $3::date`,
    [clientId, from, to]
  );
  const referrals = await pool.query(
    `SELECT
       a.full_name AS "Customer Name",
       r.referral_code AS "Source",
       'Referral' AS "Type",
       r.tds_amount AS "TDS Amount",
       (r.created_at AT TIME ZONE 'Asia/Kolkata')::date AS "Date"
     FROM referral_rewards r
     JOIN customers a ON a.id = r.referrer_customer_id
     WHERE r.client_id = $1
       AND (r.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $2::date AND $3::date`,
    [clientId, from, to]
  );
  return [...interest.rows, ...referrals.rows];
}

async function sheetReferrals(clientId: string, from: string, to: string) {
  const result = await pool.query(
    `SELECT
       a.full_name AS "Referrer",
       b.full_name AS "Referred",
       i.code AS "Investment ID",
       r.capital_amount AS "Capital",
       r.gross_bonus AS "Gross",
       r.tds_amount AS "TDS",
       r.net_bonus AS "Net",
       r.status AS "Status",
       (r.created_at AT TIME ZONE 'Asia/Kolkata')::date AS "Date"
     FROM referral_rewards r
     JOIN customers a ON a.id = r.referrer_customer_id
     JOIN customers b ON b.id = r.referred_customer_id
     JOIN investments i ON i.id = r.investment_id
     WHERE r.client_id = $1
       AND (r.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $2::date AND $3::date
     ORDER BY r.created_at DESC
     LIMIT 2000`,
    [clientId, from, to]
  );
  return result.rows;
}

async function sheetWealth(clientId: string, from: string, to: string) {
  const result = await pool.query(
    `SELECT
       COALESCE(SUM(i.fund_amount + COALESCE(i.total_earnings, 0)) FILTER (WHERE i.status = 'Active'), 0) AS aum,
       COALESCE(SUM(i.fund_amount) FILTER (WHERE i.status = 'Active'), 0) AS invested,
       COUNT(*) FILTER (WHERE i.status = 'Active') AS active_plans,
       COALESCE((
         SELECT SUM(t.amount) FROM transactions t
         WHERE t.client_id = $1 AND t.transaction_type = 'instant_credit'
           AND t.transaction_date BETWEEN $2::date AND $3::date
       ), 0) AS inflow,
       COALESCE((
         SELECT SUM(t.amount) FROM transactions t
         WHERE t.client_id = $1 AND t.transaction_type = 'withdrawal'
           AND t.transaction_date BETWEEN $2::date AND $3::date
       ), 0) AS outflow
     FROM investments i
     WHERE i.client_id = $1`,
    [clientId, from, to]
  );
  const row = result.rows[0] ?? {};
  return [
    { Metric: 'AUM as of period end', Value: money(row.aum) },
    { Metric: 'Active principal', Value: money(row.invested) },
    { Metric: 'Active plans', Value: Number(row.active_plans ?? 0) },
    { Metric: 'Inflow in range', Value: money(row.inflow) },
    { Metric: 'Outflow in range', Value: money(row.outflow) },
  ];
}

async function sheetPayouts(clientId: string, from: string, to: string) {
  const result = await pool.query(
    `SELECT
       c.full_name AS "Customer Name",
       c.customer_code AS "Customer ID",
       i.code AS "Plan No",
       i.name AS "Plan",
       i.fund_amount AS "Principal",
       i.payout_day AS "Payout Day",
       public.admin_monthly_interest(i.fund_amount, i.interest_rate) AS "Gross Interest",
       public.admin_monthly_tds(i.fund_amount, i.interest_rate, i.tds_percent) AS "TDS",
       public.admin_monthly_net(i.fund_amount, i.interest_rate, i.tds_percent) AS "Net Interest",
       ba.bank_name AS "Bank",
       ba.account_number AS "Account Number",
       ba.ifsc_code AS "IFSC",
       k.pan_number AS "PAN",
       ref.full_name AS "Referrer",
       COALESCE(i.referral_rate, 0) AS "Referral Rate"
     FROM investments i
     JOIN customers c ON c.id = i.customer_id AND c.client_id = i.client_id
     LEFT JOIN bank_accounts ba ON ba.id = i.bank_account_id AND ba.client_id = i.client_id
     LEFT JOIN kyc_documents k ON k.customer_id = c.id AND k.client_id = c.client_id
     LEFT JOIN customers ref ON ref.id = i.referrer_customer_id AND ref.client_id = i.client_id
     WHERE i.client_id = $1
       AND i.status = 'Active'
       AND i.payout_day BETWEEN 1 AND 31
     ORDER BY i.payout_day ASC, c.full_name ASC
     LIMIT 2000`,
    [clientId]
  );
  return result.rows;
}

async function buildSheets(clientId: string, kind: ReportKind, from: string, to: string) {
  const meta: Record<Exclude<ReportKind, 'bulk'>, { name: string; type: string }> = {
    investment: { name: 'Investment Master Ledger', type: 'Investment' },
    interest: { name: 'Interest Accrual Report', type: 'Interest' },
    withdrawal: { name: 'Withdrawal Status Report', type: 'Withdrawal' },
    tds: { name: 'TDS Deduction Ledger', type: 'TDS' },
    referral: { name: 'Referral Commission Report', type: 'Referral' },
    wealth: { name: 'AUM and Portfolio Health', type: 'Wealth' },
    upcoming_payout: { name: 'Upcoming Payouts (31 Days)', type: 'Payout' },
    payout_range: { name: 'Payouts by Date Range', type: 'Payout' },
  };

  if (kind === 'bulk') {
    return {
      name: 'Bulk Audit Export',
      type: 'Bulk',
      sheets: [
        { name: 'Investments', rows: await sheetInvestments(clientId, from, to) },
        { name: 'Interest', rows: await sheetInterest(clientId, from, to) },
        { name: 'Withdrawals', rows: await sheetWithdrawals(clientId, from, to) },
        { name: 'TDS', rows: await sheetTds(clientId, from, to) },
        { name: 'Referrals', rows: await sheetReferrals(clientId, from, to) },
        { name: 'Wealth', rows: await sheetWealth(clientId, from, to) },
        { name: 'Payouts', rows: await sheetPayouts(clientId, from, to) },
      ],
    };
  }

  const builders = {
    investment: () => sheetInvestments(clientId, from, to),
    interest: () => sheetInterest(clientId, from, to),
    withdrawal: () => sheetWithdrawals(clientId, from, to),
    tds: () => sheetTds(clientId, from, to),
    referral: () => sheetReferrals(clientId, from, to),
    wealth: () => sheetWealth(clientId, from, to),
    upcoming_payout: () => sheetPayouts(clientId, from, to),
    payout_range: () => sheetPayouts(clientId, from, to),
  };
  return {
    name: meta[kind].name,
    type: meta[kind].type,
    sheets: [{ name: meta[kind].type, rows: await builders[kind]() }],
  };
}

reportsRouter.post(
  '/build',
  asyncHandler(async (req, res) => {
    const { clientId } = (req as AuthedRequest).auth;
    if (!clientId) {
      res.status(403).json({ error: 'Client context is required.' });
      return;
    }
    const kind = asKind(text(req.body?.kind));
    const from = text(req.body?.from) || '2000-01-01';
    const to = text(req.body?.to);
    if (!kind) {
      res.status(400).json({ error: 'Unknown report type.' });
      return;
    }
    if (!to) {
      res.status(400).json({ error: 'A date range is required.' });
      return;
    }
    res.json(await buildSheets(clientId, kind, from, to));
  })
);

reportsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { clientId } = (req as AuthedRequest).auth;
    const result = await pool.query(
      `SELECT id, report_name, report_type, date_range_label, generated_by, format, created_at,
              (created_at AT TIME ZONE 'Asia/Kolkata')::date AS generated_date
       FROM generated_reports
       WHERE client_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [clientId]
    );
    res.json({ reports: result.rows });
  })
);

reportsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { clientId } = (req as AuthedRequest).auth;
    const format = text(req.body?.format).toLowerCase();
    if (format !== 'xlsx' && format !== 'csv' && format !== 'pdf') {
      res.status(400).json({ error: 'Format must be xlsx, csv, or pdf.' });
      return;
    }
    const inserted = await pool.query(
      `INSERT INTO generated_reports (
         client_id, report_name, report_type, date_from, date_to,
         date_range_label, generated_by, format, payload
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
       RETURNING id, report_name, report_type, date_range_label, generated_by, format, created_at,
                 (created_at AT TIME ZONE 'Asia/Kolkata')::date AS generated_date`,
      [
        clientId,
        text(req.body?.name) || 'Report',
        text(req.body?.type) || 'Report',
        req.body?.from || null,
        req.body?.to || null,
        text(req.body?.rangeLabel) || 'Custom',
        text(req.body?.generatedBy) || 'Admin',
        format,
        JSON.stringify(req.body?.payload ?? {}),
      ]
    );
    res.status(201).json(inserted.rows[0]);
  })
);

reportsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { clientId } = (req as AuthedRequest).auth;
    const id = text(req.params.id);
    if (!isUuid(id)) {
      res.status(404).json({ error: 'Report not found.' });
      return;
    }
    const result = await pool.query(
      `SELECT id, report_name, report_type, date_range_label, generated_by, format, created_at,
              payload, (created_at AT TIME ZONE 'Asia/Kolkata')::date AS generated_date
       FROM generated_reports
       WHERE id = $1 AND client_id = $2
       LIMIT 1`,
      [id, clientId]
    );
    const row = result.rows[0];
    if (!row) {
      res.status(404).json({ error: 'Report not found.' });
      return;
    }
    res.json({
      id: row.id,
      report_name: row.report_name,
      report_type: row.report_type,
      date_range_label: row.date_range_label,
      generated_by: row.generated_by,
      generated_date: row.generated_date,
      format: row.format,
      created_at: row.created_at,
      payload: row.payload,
    });
  })
);
