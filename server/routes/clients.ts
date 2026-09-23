import { Router } from 'express';
import { loadCustomerDetails, mapCustomer } from '../customerView.ts';
import { pool } from '../db.ts';
import { asyncHandler, requireAuth, requireSuperAdmin } from '../middleware.ts';
import { provisionClient } from '../provisionClient.ts';
import type { AuthedRequest } from '../types.ts';
import { isUuid, money as toMoney } from '../util.ts';

export const clientsRouter = Router();

clientsRouter.use(requireAuth, requireSuperAdmin);

function text(value: unknown) {
  return String(value ?? '').trim();
}

function mapClient(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    clientCode: row.client_code,
    status: row.status,
    supportEmail: row.support_email,
    supportPhone: row.support_phone,
    adminFullName: row.admin_full_name,
    adminUsername: row.admin_username,
    minInvestmentAmount: Number(row.min_investment_amount),
    maxInvestmentAmount: Number(row.max_investment_amount),
    agreementCharges: Number(row.agreement_charges),
    defaultInterestRate: Number(row.default_interest_rate),
    defaultTdsPercent: Number(row.default_tds_percent),
    defaultPayoutDay: Number(row.default_payout_day),
    referralRate: Number(row.referral_rate),
    referralTdsRate: Number(row.referral_tds_rate),
    createdAt: row.created_at,
    customerCount: Number(row.customer_count ?? 0),
    activeInvestments: Number(row.active_investments ?? 0),
    totalInvested: toMoney(row.total_invested),
    pendingInvestments: Number(row.pending_investments ?? 0),
    pendingWithdrawals: Number(row.pending_withdrawals ?? 0),
  };
}

const CLIENT_SELECT = `
  SELECT
    c.id,
    c.name,
    c.client_code,
    c.status,
    c.support_email,
    c.support_phone,
    c.created_at,
    s.min_investment_amount,
    s.max_investment_amount,
    s.agreement_charges,
    s.default_interest_rate,
    s.default_tds_percent,
    s.default_payout_day,
    s.referral_rate,
    s.referral_tds_rate,
    u.full_name AS admin_full_name,
    u.username AS admin_username,
    (SELECT COUNT(*)::int FROM customers x WHERE x.client_id = c.id) AS customer_count,
    (SELECT COUNT(*)::int FROM investments x WHERE x.client_id = c.id AND x.status = 'Active') AS active_investments,
    (SELECT COALESCE(SUM(x.fund_amount), 0) FROM investments x WHERE x.client_id = c.id AND x.status = 'Active') AS total_invested,
    (SELECT COUNT(*)::int FROM investments x WHERE x.client_id = c.id AND x.status IN ('Pending', 'Under Review')) AS pending_investments,
    (SELECT COUNT(*)::int FROM withdrawals x WHERE x.client_id = c.id AND x.status IN ('Processing', 'On Hold')) AS pending_withdrawals
  FROM clients c
  JOIN client_settings s ON s.client_id = c.id
  JOIN users u ON u.client_id = c.id AND u.role = 'client_admin'
`;

function pageParams(query: { page?: unknown; pageSize?: unknown; q?: unknown }) {
  const page = Math.max(1, Number(query.page ?? 1) || 1);
  const pageSize = Math.min(50, Math.max(10, Number(query.pageSize ?? 20) || 20));
  return { page, pageSize, offset: (page - 1) * pageSize, search: text(query.q) };
}

async function clientKpis(clientId: string) {
  const result = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM customers WHERE client_id = $1) AS total_customers,
       (SELECT COUNT(*)::int FROM investments WHERE client_id = $1 AND status = 'Active') AS active_investments,
       (SELECT COALESCE(SUM(fund_amount), 0) FROM investments WHERE client_id = $1 AND status = 'Active') AS total_invested,
       (SELECT public.wealth_as_of($1, public.admin_ist_today())) AS total_wealth,
       (SELECT COUNT(*)::int FROM investments WHERE client_id = $1 AND status IN ('Pending', 'Under Review')) AS pending_investments,
       (SELECT COUNT(*)::int FROM withdrawals WHERE client_id = $1 AND status IN ('Processing', 'On Hold')) AS pending_withdrawals,
       (SELECT COALESCE(SUM(COALESCE(net_payout, withdrawal_amount)), 0)
          FROM withdrawals WHERE client_id = $1 AND status = 'Paid') AS paid_withdrawals`,
    [clientId]
  );
  const row = result.rows[0] ?? {};
  return {
    totalCustomers: Number(row.total_customers ?? 0),
    activeInvestments: Number(row.active_investments ?? 0),
    totalInvested: toMoney(row.total_invested),
    totalWealth: toMoney(row.total_wealth),
    pendingInvestments: Number(row.pending_investments ?? 0),
    pendingWithdrawals: Number(row.pending_withdrawals ?? 0),
    paidWithdrawals: toMoney(row.paid_withdrawals),
  };
}

clientsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const result = await pool.query(`${CLIENT_SELECT} ORDER BY c.created_at DESC`);
    res.json({ clients: result.rows.map((row) => mapClient(row)) });
  })
);

clientsRouter.get(
  '/:id/customers/:customerId',
  asyncHandler(async (req, res) => {
    const id = text(req.params.id);
    const customerId = text(req.params.customerId);
    if (!isUuid(id) || !isUuid(customerId)) {
      res.status(404).json({ error: 'Customer not found.' });
      return;
    }
    const details = await loadCustomerDetails(customerId, id);
    if (!details) {
      res.status(404).json({ error: 'Customer not found.' });
      return;
    }
    res.json(details);
  })
);

clientsRouter.get(
  '/:id/customers',
  asyncHandler(async (req, res) => {
    const id = text(req.params.id);
    if (!isUuid(id)) {
      res.status(404).json({ error: 'Client not found.' });
      return;
    }
    const status = text(req.query.status).toLowerCase() || 'all';
    const { page, pageSize, offset, search } = pageParams(req.query);
    const filters = ['c.client_id = $1'];
    const params: unknown[] = [id];

    if (status === 'active' || status === 'inactive') {
      params.push(status);
      filters.push(`c.status = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      const idx = params.length;
      filters.push(
        `(c.full_name ILIKE $${idx} OR c.mobile_number ILIKE $${idx} OR c.email_address ILIKE $${idx} OR c.customer_code ILIKE $${idx} OR c.referral_code ILIKE $${idx})`
      );
    }

    const where = filters.join(' AND ');
    const count = await pool.query(`SELECT COUNT(*)::int AS total FROM customers c WHERE ${where}`, params);
    const result = await pool.query(
      `SELECT
         c.id, c.customer_code, c.full_name, c.mobile_number, c.email_address,
         c.date_of_birth, c.address, c.city, c.state, c.pin_code, c.status,
         c.referral_code, c.created_at
       FROM customers c
       WHERE ${where}
       ORDER BY c.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset]
    );

    res.json({
      customers: result.rows.map((row) => mapCustomer(row)),
      total: Number(count.rows[0]?.total ?? 0),
      page,
      pageSize,
    });
  })
);

clientsRouter.get(
  '/:id/investments',
  asyncHandler(async (req, res) => {
    const id = text(req.params.id);
    if (!isUuid(id)) {
      res.status(404).json({ error: 'Client not found.' });
      return;
    }
    const filter = text(req.query.filter).toLowerCase() || 'all';
    const { page, pageSize, offset, search } = pageParams(req.query);
    const filters = ['i.client_id = $1'];
    const params: unknown[] = [id];

    if (filter === 'pending') {
      filters.push(`i.status = 'Pending'`);
    } else if (filter === 'under_review') {
      filters.push(`i.status = 'Under Review'`);
    } else if (filter === 'approved') {
      filters.push(`i.status IN ('Active', 'Closed')`);
    } else if (filter === 'rejected') {
      filters.push(`i.status = 'Rejected'`);
    }

    if (search) {
      params.push(`%${search}%`);
      const idx = params.length;
      filters.push(
        `(COALESCE(i.request_id, '') ILIKE $${idx}
          OR c.full_name ILIKE $${idx}
          OR c.customer_code ILIKE $${idx}
          OR i.name ILIKE $${idx}
          OR i.code ILIKE $${idx})`
      );
    }

    const where = filters.join(' AND ');
    const count = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM investments i
       JOIN customers c ON c.id = i.customer_id AND c.client_id = i.client_id
       WHERE ${where}`,
      params
    );
    const result = await pool.query(
      `SELECT
         i.id, i.request_id, i.code, i.name AS plan_name, i.fund_amount, i.status, i.created_at, i.invested_date,
         c.full_name AS customer_name, c.customer_code
       FROM investments i
       JOIN customers c ON c.id = i.customer_id AND c.client_id = i.client_id
       WHERE ${where}
       ORDER BY i.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset]
    );

    res.json({
      rows: result.rows.map((row) => ({
        id: row.id,
        requestId: row.request_id,
        code: row.code,
        customerName: row.customer_name,
        customerCode: row.customer_code,
        planName: row.plan_name,
        fundAmount: toMoney(row.fund_amount),
        status: row.status,
        investedDate: row.invested_date,
        createdAt: row.created_at,
      })),
      total: Number(count.rows[0]?.total ?? 0),
      page,
      pageSize,
    });
  })
);

clientsRouter.get(
  '/:id/withdrawals',
  asyncHandler(async (req, res) => {
    const id = text(req.params.id);
    if (!isUuid(id)) {
      res.status(404).json({ error: 'Client not found.' });
      return;
    }
    const filter = text(req.query.filter).toLowerCase() || 'all';
    const { page, pageSize, offset, search } = pageParams(req.query);
    const filters = ['w.client_id = $1'];
    const params: unknown[] = [id];

    if (filter === 'pending') {
      filters.push(`w.status IN ('Processing', 'On Hold')`);
    } else if (filter === 'approved') {
      filters.push(`w.status IN ('Approved', 'Paid')`);
    } else if (filter === 'rejected') {
      filters.push(`w.status = 'Rejected'`);
    }

    if (search) {
      params.push(`%${search}%`);
      const idx = params.length;
      filters.push(`(c.full_name ILIKE $${idx} OR i.code ILIKE $${idx})`);
    }

    const where = filters.join(' AND ');
    const count = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM withdrawals w
       JOIN investments i ON i.id = w.investment_id AND i.client_id = w.client_id
       JOIN customers c ON c.id = w.customer_id AND c.client_id = w.client_id
       WHERE ${where}`,
      params
    );
    const result = await pool.query(
      `SELECT
         w.id, w.status, w.strategy, w.withdrawal_amount, w.net_payout, w.requested_on,
         c.full_name AS customer_name, i.code AS investment_code, i.name AS plan_name
       FROM withdrawals w
       JOIN investments i ON i.id = w.investment_id AND i.client_id = w.client_id
       JOIN customers c ON c.id = w.customer_id AND c.client_id = w.client_id
       WHERE ${where}
       ORDER BY w.requested_on DESC, w.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset]
    );

    res.json({
      rows: result.rows.map((row) => ({
        id: row.id,
        status: row.status,
        strategy: row.strategy,
        customerName: row.customer_name,
        investmentCode: row.investment_code,
        planName: row.plan_name,
        withdrawalAmount: toMoney(row.withdrawal_amount),
        netPayout: toMoney(row.net_payout),
        requestedOn: row.requested_on,
      })),
      total: Number(count.rows[0]?.total ?? 0),
      page,
      pageSize,
    });
  })
);

clientsRouter.get(
  '/:id/referrals',
  asyncHandler(async (req, res) => {
    const id = text(req.params.id);
    if (!isUuid(id)) {
      res.status(404).json({ error: 'Client not found.' });
      return;
    }
    const { page, pageSize, offset } = pageParams(req.query);
    const kpis = await pool.query(
      `SELECT
         COUNT(*)::int AS total_referrals,
         COALESCE(SUM(gross_bonus), 0) AS gross_commission,
         COALESCE(SUM(tds_amount), 0) AS tds_amount,
         COALESCE(SUM(net_bonus), 0) AS net_commission
       FROM referral_rewards
       WHERE client_id = $1`,
      [id]
    );
    const count = await pool.query(
      `SELECT COUNT(*)::int AS total FROM referral_rewards WHERE client_id = $1`,
      [id]
    );
    const result = await pool.query(
      `SELECT
         r.id, r.status, r.capital_amount, r.net_bonus, r.created_at,
         a.full_name AS referrer_name,
         b.full_name AS referred_name,
         i.code AS investment_code
       FROM referral_rewards r
       JOIN customers a ON a.id = r.referrer_customer_id
       JOIN customers b ON b.id = r.referred_customer_id
       JOIN investments i ON i.id = r.investment_id
       WHERE r.client_id = $1
       ORDER BY r.created_at DESC
       LIMIT $2 OFFSET $3`,
      [id, pageSize, offset]
    );

    res.json({
      kpis: {
        totalReferrals: Number(kpis.rows[0]?.total_referrals ?? 0),
        grossCommission: toMoney(kpis.rows[0]?.gross_commission),
        tdsAmount: toMoney(kpis.rows[0]?.tds_amount),
        netCommission: toMoney(kpis.rows[0]?.net_commission),
      },
      rows: result.rows.map((row) => ({
        id: row.id,
        status: row.status,
        referrerName: row.referrer_name,
        referredName: row.referred_name,
        investmentCode: row.investment_code,
        capitalAmount: toMoney(row.capital_amount),
        netBonus: toMoney(row.net_bonus),
        createdAt: row.created_at,
      })),
      total: Number(count.rows[0]?.total ?? 0),
      page,
      pageSize,
    });
  })
);

clientsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = text(req.params.id);
    if (!isUuid(id)) {
      res.status(404).json({ error: 'Client not found.' });
      return;
    }
    const result = await pool.query(`${CLIENT_SELECT} WHERE c.id = $1`, [id]);
    const row = result.rows[0];
    if (!row) {
      res.status(404).json({ error: 'Client not found.' });
      return;
    }
    res.json({
      client: mapClient(row),
      kpis: await clientKpis(id),
    });
  })
);

clientsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const auth = (req as AuthedRequest).auth;
    const provisioned = await provisionClient(req.body ?? {}, { createdBy: auth.id });
    if (!provisioned.ok) {
      res.status(provisioned.status).json({ error: provisioned.error });
      return;
    }

    const result = await pool.query(`${CLIENT_SELECT} WHERE c.id = $1`, [provisioned.clientId]);
    res.status(201).json({ client: mapClient(result.rows[0]) });
  })
);

clientsRouter.patch(
  '/:id/status',
  asyncHandler(async (req, res) => {
    const id = text(req.params.id);
    const status = text(req.body?.status).toLowerCase();
    if (status !== 'active' && status !== 'inactive') {
      res.status(400).json({ error: 'Status must be active or inactive.' });
      return;
    }

    const updated = await pool.query(
      `UPDATE clients
       SET status = $2, updated_at = NOW()
       WHERE id = $1
       RETURNING id`,
      [id, status]
    );
    if (updated.rowCount === 0) {
      res.status(404).json({ error: 'Client not found.' });
      return;
    }

    await pool.query(
      `UPDATE users
       SET is_active = $2, updated_at = NOW()
       WHERE client_id = $1 AND role = 'client_admin'`,
      [id, status === 'active']
    );

    const result = await pool.query(`${CLIENT_SELECT} WHERE c.id = $1`, [id]);
    res.json({ client: mapClient(result.rows[0]) });
  })
);
