import { Router } from 'express';
import { mapAgreementParty, officeForSelection } from '../agreementParty.ts';
import { normalizeEmail, normalizeMobile } from '../customerCodes.ts';
import { pool } from '../db.ts';
import { asyncHandler } from '../middleware.ts';
import type { AuthedRequest } from '../types.ts';
import { EMAIL_MOBILE_COMBO_ERROR, isEmailMobileComboDuplicate } from '../util.ts';

export const investmentsRouter = Router();

const PAYOUT_DAYS = [1, 5, 10, 15, 20, 25];
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(value: unknown) {
  return String(value ?? '').trim();
}

function asNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function money(value: unknown) {
  const parsed = asNumber(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
}

function formatInr(amount: number) {
  return `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function isUuid(value: string) {
  return UUID_RE.test(value);
}

function istTodaySql() {
  return `(NOW() AT TIME ZONE 'Asia/Kolkata')::DATE`;
}

investmentsRouter.get(
  '/customer-options',
  asyncHandler(async (req, res) => {
    const { clientId } = (req as AuthedRequest).auth;
    const search = text(req.query.q);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50) || 50));
    const params: unknown[] = [clientId];
    let searchSql = '';
    if (search) {
      params.push(`%${search}%`);
      searchSql = `AND (
        c.full_name ILIKE $2
        OR c.customer_code ILIKE $2
        OR c.mobile_number ILIKE $2
      )`;
    }
    params.push(limit);
    const limitIdx = params.length;

    const result = await pool.query(
      `SELECT
         c.id AS user_id,
         c.customer_code AS customer_id,
         c.full_name,
         c.mobile_number,
         (
           SELECT COUNT(*)::int
           FROM investments i
           WHERE i.customer_id = c.id AND i.client_id = c.client_id
         ) AS investment_count
       FROM customers c
       WHERE c.client_id = $1
         AND c.status = 'active'
         ${searchSql}
       ORDER BY c.full_name ASC
       LIMIT $${limitIdx}`,
      params
    );

    res.json({
      options: result.rows.map((row) => ({
        user_id: row.user_id,
        customer_id: row.customer_id,
        full_name: row.full_name,
        mobile_number: row.mobile_number,
        investment_count: Number(row.investment_count ?? 0),
      })),
    });
  })
);

investmentsRouter.get(
  '/customer-banks/:customerId',
  asyncHandler(async (req, res) => {
    const { clientId } = (req as AuthedRequest).auth;
    const customerId = text(req.params.customerId);
    if (!isUuid(customerId)) {
      res.status(400).json({ error: 'Select a customer.' });
      return;
    }

    const owned = await pool.query(
      `SELECT 1 FROM customers WHERE id = $1 AND client_id = $2 LIMIT 1`,
      [customerId, clientId]
    );
    if ((owned.rowCount ?? 0) === 0) {
      res.status(404).json({ error: 'Customer not found.' });
      return;
    }

    const result = await pool.query(
      `SELECT id, account_number, bank_name, ifsc_code, account_type, is_primary
       FROM bank_accounts
       WHERE customer_id = $1 AND client_id = $2
       ORDER BY is_primary DESC, account_number ASC`,
      [customerId, clientId]
    );

    res.json({
      banks: result.rows.map((row) => ({
        id: row.id,
        account_number: row.account_number,
        branch_name: row.bank_name,
        bank_name: row.bank_name,
        ifsc_code: row.ifsc_code,
        account_type: row.account_type,
        is_primary: Boolean(row.is_primary),
      })),
    });
  })
);

investmentsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { clientId } = (req as AuthedRequest).auth;
    const filter = text(req.query.filter).toLowerCase() || 'pending';
    const search = text(req.query.q);
    const page = Math.max(1, Number(req.query.page ?? 1) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize ?? 10) || 10));
    const offset = (page - 1) * pageSize;

    const params: unknown[] = [clientId];
    let searchSqlInv = '';
    let searchSqlRen = '';
    if (search) {
      params.push(`%${search}%`);
      const idx = params.length;
      searchSqlInv = `AND (
        COALESCE(i.request_id, '') ILIKE $${idx}
        OR c.full_name ILIKE $${idx}
        OR c.customer_code ILIKE $${idx}
        OR i.name ILIKE $${idx}
        OR i.code ILIKE $${idx}
      )`;
      searchSqlRen = `AND (
        COALESCE(r.agreement_id, '') ILIKE $${idx}
        OR c.full_name ILIKE $${idx}
        OR c.customer_code ILIKE $${idx}
        OR i.name ILIKE $${idx}
        OR i.code ILIKE $${idx}
      )`;
    }

    const invFilter =
      filter === 'pending'
        ? `AND i.status = 'Pending'`
        : filter === 'under_review'
          ? `AND i.status = 'Under Review'`
          : filter === 'approved'
            ? `AND i.status IN ('Active', 'Closed')`
            : filter === 'rejected'
              ? `AND i.status = 'Rejected'`
              : '';
    const renFilter =
      filter === 'pending'
        ? `AND r.status = 'Pending'`
        : filter === 'under_review'
          ? `AND FALSE`
          : filter === 'approved'
            ? `AND r.status = 'Approved'`
            : filter === 'rejected'
              ? `AND r.status = 'Rejected'`
              : '';

    const unionSql = `
      SELECT
        i.id,
        'investment'::text AS kind,
        i.code,
        i.request_id,
        i.name AS plan_name,
        i.fund_amount,
        NULL::numeric AS increment_amount,
        NULL::text AS mode,
        NULL::text AS agreement_id,
        i.status::text AS status,
        i.created_at,
        c.full_name AS customer_name,
        c.customer_code AS customer_id
      FROM investments i
      JOIN customers c ON c.id = i.customer_id AND c.client_id = i.client_id
      WHERE i.client_id = $1
        ${invFilter}
        ${searchSqlInv}
      UNION ALL
      SELECT
        r.id,
        'renewal'::text,
        i.code,
        COALESCE(r.agreement_id, i.request_id),
        CASE
          WHEN r.mode = 'increase' THEN 'Agreement Renewal · Increase'
          ELSE 'Agreement Renewal · Same Amount'
        END,
        CASE
          WHEN r.mode = 'increase'
            THEN COALESCE(r.current_amount, 0) + COALESCE(r.increment_amount, 0)
          ELSE COALESCE(r.current_amount, i.fund_amount, 0)
        END,
        r.increment_amount,
        r.mode,
        r.agreement_id,
        r.status::text,
        r.created_at,
        c.full_name,
        c.customer_code
      FROM agreement_renewal_requests r
      JOIN investments i ON i.id = r.investment_id AND i.client_id = r.client_id
      JOIN customers c ON c.id = r.customer_id AND c.client_id = r.client_id
      WHERE r.client_id = $1
        ${renFilter}
        ${searchSqlRen}
    `;

    const count = await pool.query(
      `SELECT COUNT(*)::int AS total FROM (${unionSql}) base`,
      params
    );
    const result = await pool.query(
      `SELECT * FROM (${unionSql}) base
       ORDER BY created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset]
    );

    res.json({
      rows: result.rows.map((row) => ({
        id: row.id,
        kind: row.kind === 'renewal' ? 'renewal' : 'investment',
        code: row.code,
        request_id: row.request_id,
        customer_name: row.customer_name,
        customer_id: row.customer_id,
        plan_name: row.plan_name,
        fund_amount: money(row.fund_amount),
        increment_amount: row.increment_amount == null ? null : money(row.increment_amount),
        mode: row.mode ?? null,
        agreement_id: row.agreement_id ?? null,
        status: row.status,
        created_at: row.created_at,
      })),
      total: Number(count.rows[0]?.total ?? 0),
      limit: pageSize,
      offset,
    });
  })
);

investmentsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { clientId } = (req as AuthedRequest).auth;
    const customerId = text(req.body?.userId ?? req.body?.customerId);
    const bankAccountId = text(req.body?.bankAccountId ?? req.body?.bank_account_id);
    let fundTitle = text(req.body?.fundTitle ?? req.body?.fund_title);
    const amount = money(req.body?.amount);

    if (!isUuid(customerId)) {
      res.status(400).json({ error: 'Select a customer.' });
      return;
    }
    if (!isUuid(bankAccountId)) {
      res.status(400).json({ error: 'Select a bank account number.' });
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ error: 'Enter a valid amount.' });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const customer = await client.query(
        `SELECT id, customer_code, status, referred_by_customer_id
         FROM customers
         WHERE id = $1 AND client_id = $2
         FOR UPDATE`,
        [customerId, clientId]
      );
      const customerRow = customer.rows[0];
      if (!customerRow) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Customer not found.' });
        return;
      }
      if (customerRow.status !== 'active') {
        await client.query('ROLLBACK');
        res.status(400).json({ error: 'This customer is inactive.' });
        return;
      }

      const bank = await client.query(
        `SELECT id
         FROM bank_accounts
         WHERE id = $1 AND customer_id = $2 AND client_id = $3`,
        [bankAccountId, customerId, clientId]
      );
      if ((bank.rowCount ?? 0) === 0) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: 'Selected bank account does not belong to this customer.' });
        return;
      }

      const settings = await client.query(
        `SELECT min_investment_amount, max_investment_amount, agreement_charges,
                default_interest_rate, default_tds_percent, default_payout_day,
                referral_rate
         FROM client_settings
         WHERE client_id = $1`,
        [clientId]
      );
      const setting = settings.rows[0];
      if (!setting) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: 'Client settings are missing. Contact ELVA.' });
        return;
      }

      const minAmount = money(setting.min_investment_amount);
      const maxAmount = money(setting.max_investment_amount);
      if (amount < minAmount || amount > maxAmount) {
        await client.query('ROLLBACK');
        res.status(400).json({
          error: `Investment amount must be between ${formatInr(minAmount)} and ${formatInr(maxAmount)}.`,
        });
        return;
      }

      if (!fundTitle) {
        const count = await client.query(
          `SELECT COUNT(*)::int AS total FROM investments WHERE customer_id = $1 AND client_id = $2`,
          [customerId, clientId]
        );
        fundTitle = `Investment ${Number(count.rows[0]?.total ?? 0) + 1}`;
      }

      const duplicate = await client.query(
        `SELECT 1
         FROM investments
         WHERE customer_id = $1
           AND client_id = $2
           AND lower(btrim(name)) = lower(btrim($3))
         LIMIT 1`,
        [customerId, clientId, fundTitle]
      );
      if ((duplicate.rowCount ?? 0) > 0) {
        await client.query('ROLLBACK');
        res.status(409).json({ error: 'An investment with this title already exists for this customer.' });
        return;
      }

      const nominee = await client.query(
        `SELECT id
         FROM nominees
         WHERE customer_id = $1 AND client_id = $2
         ORDER BY created_at ASC
         LIMIT 1`,
        [customerId, clientId]
      );
      const nomineeId = nominee.rows[0]?.id;
      if (!nomineeId) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: 'Customer has no nominee. Add a nominee before creating an investment.' });
        return;
      }

      let referrerCustomerId = customerRow.referred_by_customer_id ?? null;
      let referralCode: string | null = null;
      if (referrerCustomerId) {
        const referrer = await client.query(
          `SELECT referral_code FROM customers WHERE id = $1 AND client_id = $2 LIMIT 1`,
          [referrerCustomerId, clientId]
        );
        referralCode = referrer.rows[0]?.referral_code ?? null;
        if (!referralCode) {
          referrerCustomerId = null;
        }
      }

      const inserted = await client.query(
        `INSERT INTO investments (
           client_id, customer_id, name, status, fund_amount, current_value,
           interest_rate, tds_percent, bank_account_id, nominee_id, pay_date,
           agreement_charges, payout_day, referrer_customer_id, referral_code,
           referral_rate
         ) VALUES (
           $1, $2, $3, 'Pending', $4, $4,
           $5, $6, $7, $8, ${istTodaySql()},
           $9, $10, $11, $12, $13
         )
         RETURNING id, request_id, name, fund_amount, status, customer_id`,
        [
          clientId,
          customerId,
          fundTitle,
          amount,
          Number(setting.default_interest_rate),
          Number(setting.default_tds_percent),
          bankAccountId,
          nomineeId,
          money(setting.agreement_charges),
          Number(setting.default_payout_day),
          referrerCustomerId,
          referralCode,
          referrerCustomerId ? Number(setting.referral_rate ?? 0.01) : 0.01,
        ]
      );

      await client.query('COMMIT');
      const row = inserted.rows[0];
      res.status(201).json({
        ok: true,
        id: row.id,
        user_id: customerId,
        customer_id: customerRow.customer_code,
        bank_account_id: bankAccountId,
        fund_amount: money(row.fund_amount),
        name: row.name,
        status: row.status,
        request_id: row.request_id,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      const code = (error as { code?: string }).code;
      if (code === '23505') {
        res.status(409).json({ error: 'An investment with this title already exists for this customer.' });
        return;
      }
      throw error;
    } finally {
      client.release();
    }
  })
);

investmentsRouter.get(
  '/renewals/:renewalId',
  asyncHandler(async (req, res) => {
    const { clientId } = (req as AuthedRequest).auth;
    const renewalId = text(req.params.renewalId);
    if (!isUuid(renewalId)) {
      res.status(404).json({ error: 'Renewal request not found.' });
      return;
    }

    const result = await pool.query(
      `SELECT
         r.id,
         r.status,
         r.mode,
         r.agreement_id,
         r.current_amount,
         r.increment_amount,
         r.created_at,
         r.customer_id AS user_id,
         r.investment_id,
         i.code AS plan_no,
         i.name AS plan_name,
         i.status AS investment_status,
         i.fund_amount,
         i.interest_rate,
         i.tds_percent,
         i.payout_day,
         i.invested_date,
         c.full_name AS customer_name,
         c.customer_code AS customer_id,
         ba.bank_name,
         ba.account_number,
         ba.ifsc_code
       FROM agreement_renewal_requests r
       JOIN investments i ON i.id = r.investment_id AND i.client_id = r.client_id
       JOIN customers c ON c.id = r.customer_id AND c.client_id = r.client_id
       LEFT JOIN bank_accounts ba ON ba.id = i.bank_account_id AND ba.client_id = i.client_id
       WHERE r.id = $1 AND r.client_id = $2
       LIMIT 1`,
      [renewalId, clientId]
    );

    const row = result.rows[0];
    if (!row) {
      res.status(404).json({ error: 'Renewal request not found.' });
      return;
    }

    const current = money(row.current_amount);
    const increment = row.increment_amount == null ? null : money(row.increment_amount);
    const newPrincipal =
      row.mode === 'increase' ? money(current + (increment ?? 0)) : current;

    res.json({
      id: row.id,
      kind: 'renewal',
      status: row.status,
      mode: row.mode,
      agreement_id: row.agreement_id,
      customer_id: row.customer_id,
      customer_name: row.customer_name,
      current_amount: current,
      increment_amount: increment,
      new_principal: newPrincipal,
      created_at: row.created_at,
      user_id: row.user_id,
      investment_id: row.investment_id,
      plan_no: row.plan_no,
      plan_name: row.plan_name,
      investment_status: row.investment_status,
      fund_amount: money(row.fund_amount),
      interest_rate: asNumber(row.interest_rate),
      tds_percent: asNumber(row.tds_percent),
      payout_day: Number(row.payout_day) || 10,
      invested_date: row.invested_date,
      bank: row.bank_name
        ? {
            bank_name: row.bank_name,
            account_number: row.account_number,
            ifsc_code: row.ifsc_code,
          }
        : null,
    });
  })
);

investmentsRouter.post(
  '/renewals/:renewalId/decision',
  asyncHandler(async (req, res) => {
    const { clientId } = (req as AuthedRequest).auth;
    const renewalId = text(req.params.renewalId);
    const action = text(req.body?.action).toLowerCase();

    if (!isUuid(renewalId)) {
      res.status(404).json({ error: 'Renewal request not found.' });
      return;
    }
    if (action !== 'approve' && action !== 'reject') {
      res.status(400).json({ error: 'Action must be approve or reject.' });
      return;
    }

    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const current = await db.query(
        `SELECT id, status, mode, increment_amount, current_amount, investment_id, agreement_id
         FROM agreement_renewal_requests
         WHERE id = $1 AND client_id = $2
         FOR UPDATE`,
        [renewalId, clientId]
      );
      const reqRow = current.rows[0];
      if (!reqRow) {
        await db.query('ROLLBACK');
        res.status(404).json({ error: 'Renewal request not found.' });
        return;
      }
      if (reqRow.status !== 'Pending') {
        await db.query('ROLLBACK');
        res.status(400).json({ error: 'Only Pending renewal requests can be decided.' });
        return;
      }

      if (action === 'reject') {
        const updated = await db.query(
          `UPDATE agreement_renewal_requests
           SET status = 'Rejected', updated_at = NOW()
           WHERE id = $1 AND client_id = $2
           RETURNING id, status, mode, current_amount, increment_amount, agreement_id`,
          [renewalId, clientId]
        );
        await db.query('COMMIT');
        const next = updated.rows[0];
        res.json({
          id: next.id,
          status: next.status,
          mode: next.mode,
          fund_amount: money(next.current_amount),
          increment_amount: next.increment_amount == null ? null : money(next.increment_amount),
          agreement_id: next.agreement_id,
          action,
        });
        return;
      }

      const investment = await db.query(
        `SELECT id, status, fund_amount, total_earnings
         FROM investments
         WHERE id = $1 AND client_id = $2
         FOR UPDATE`,
        [reqRow.investment_id, clientId]
      );
      const inv = investment.rows[0];
      if (!inv) {
        await db.query('ROLLBACK');
        res.status(400).json({ error: 'Linked investment not found.' });
        return;
      }
      if (inv.status !== 'Active') {
        await db.query('ROLLBACK');
        res.status(400).json({ error: 'Linked investment must be Active to renew.' });
        return;
      }

      await db.query(`SELECT public.process_investment_interest($1)`, [inv.id]);

      const refreshed = await db.query(
        `SELECT id, fund_amount, total_earnings
         FROM investments
         WHERE id = $1 AND client_id = $2
         FOR UPDATE`,
        [inv.id, clientId]
      );
      const live = refreshed.rows[0];
      let newPrincipal = money(live.fund_amount);
      if (reqRow.mode === 'increase') {
        const increment = money(reqRow.increment_amount);
        if (increment <= 0) {
          await db.query('ROLLBACK');
          res.status(400).json({ error: 'Increase renewal requires a positive increment amount.' });
          return;
        }
        newPrincipal = money(newPrincipal + increment);
      }

      await db.query(
        `UPDATE investments
         SET fund_amount = $3,
             invested_date = ${istTodaySql()},
             completed_interest_periods = 0,
             current_value = $3 + COALESCE(total_earnings, 0),
             updated_at = NOW()
         WHERE id = $1 AND client_id = $2 AND status = 'Active'`,
        [inv.id, clientId, newPrincipal]
      );

      const updated = await db.query(
        `UPDATE agreement_renewal_requests
         SET status = 'Approved', updated_at = NOW()
         WHERE id = $1 AND client_id = $2
         RETURNING id, status, mode, increment_amount, agreement_id`,
        [renewalId, clientId]
      );
      await db.query('COMMIT');
      const next = updated.rows[0];
      res.json({
        id: next.id,
        status: next.status,
        mode: next.mode,
        fund_amount: newPrincipal,
        increment_amount: next.increment_amount == null ? null : money(next.increment_amount),
        agreement_id: next.agreement_id,
        action,
      });
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
  })
);

investmentsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { clientId } = (req as AuthedRequest).auth;
    const id = text(req.params.id);
    if (!isUuid(id)) {
      res.status(404).json({ error: 'Investment request not found.' });
      return;
    }

    const result = await pool.query(
      `SELECT
         i.id,
         i.code,
         i.request_id,
         i.status,
         i.name AS plan_name,
         i.fund_amount,
         i.interest_rate,
         i.tds_percent,
         i.payout_day,
         i.referral_rate,
         i.referral_code,
         i.created_at,
         i.customer_id AS user_id,
         i.referrer_customer_id,
         c.full_name AS customer_name,
         c.customer_code AS customer_id,
         ref.full_name AS referrer_name,
         s.referral_tds_rate,
         COALESCE((
           SELECT SUM(x.fund_amount) FROM investments x
           WHERE x.customer_id = i.customer_id AND x.client_id = i.client_id AND x.status = 'Active'
         ), 0) AS active_portfolio,
         COALESCE((
           SELECT COUNT(*) FROM investments x
           WHERE x.customer_id = i.customer_id AND x.client_id = i.client_id AND x.status = 'Active'
         ), 0) AS active_plans,
         ba.bank_name,
         ba.account_number,
         ba.ifsc_code
       FROM investments i
       JOIN customers c ON c.id = i.customer_id AND c.client_id = i.client_id
       LEFT JOIN customers ref ON ref.id = i.referrer_customer_id AND ref.client_id = i.client_id
       LEFT JOIN client_settings s ON s.client_id = i.client_id
       LEFT JOIN bank_accounts ba ON ba.id = i.bank_account_id AND ba.client_id = i.client_id
       WHERE i.id = $1 AND i.client_id = $2
       LIMIT 1`,
      [id, clientId]
    );

    const row = result.rows[0];
    if (!row) {
      res.status(404).json({ error: 'Investment request not found.' });
      return;
    }

    res.json({
      id: row.id,
      code: row.code,
      request_id: row.request_id,
      status: row.status,
      plan_name: row.plan_name,
      fund_amount: money(row.fund_amount),
      interest_rate: asNumber(row.interest_rate),
      tds_percent: asNumber(row.tds_percent),
      payout_day: Number(row.payout_day) || 10,
      referral_rate: asNumber(row.referral_rate) || 0.01,
      referral_tds_rate: asNumber(row.referral_tds_rate) || 0.02,
      referral_code: row.referral_code ? String(row.referral_code) : null,
      referrer_user_id: row.referrer_customer_id ? String(row.referrer_customer_id) : null,
      referrer_name: row.referrer_name ? String(row.referrer_name) : null,
      created_at: row.created_at,
      user_id: row.user_id,
      customer_name: row.customer_name,
      customer_id: row.customer_id,
      active_portfolio: money(row.active_portfolio),
      active_plans: Number(row.active_plans ?? 0),
      bank: row.bank_name
        ? {
            bank_name: row.bank_name,
            account_number: row.account_number,
            ifsc_code: row.ifsc_code,
          }
        : null,
    });
  })
);

investmentsRouter.get(
  '/:id/approved-edit',
  asyncHandler(async (req, res) => {
    const { clientId } = (req as AuthedRequest).auth;
    const id = text(req.params.id);
    if (!isUuid(id)) {
      res.status(404).json({ error: 'Approved investment not found.' });
      return;
    }

    const result = await pool.query(
      `SELECT
         i.id,
         i.code,
         i.request_id,
         i.status,
         i.name AS plan_name,
         i.fund_amount,
         i.interest_rate,
         i.tds_percent,
         i.payout_day,
         i.customer_id AS user_id,
         c.customer_code AS customer_id,
         c.full_name,
         c.email_address,
         c.mobile_number,
         c.date_of_birth::text AS date_of_birth,
         c.address,
         k.pan_number,
         k.aadhaar_number,
         ba.id AS bank_id,
         ba.bank_name,
         ba.account_number,
         ba.ifsc_code,
         ba.account_type,
         ba.account_holder_name,
         ba.branch_name,
         n.nominee_name,
         n.relationship,
         n.nominee_aadhaar,
         n.nominee_pan,
         n.nominee_mobile,
         a.branch AS agreement_place,
         a.cheque_no,
         a.cheque_bank_name,
         a.cheque_bank_address,
         s.agreement_offices
       FROM investments i
       JOIN customers c ON c.id = i.customer_id AND c.client_id = i.client_id
       LEFT JOIN kyc_documents k ON k.customer_id = c.id AND k.client_id = i.client_id
       LEFT JOIN bank_accounts ba ON ba.id = i.bank_account_id AND ba.client_id = i.client_id
       LEFT JOIN nominees n ON n.id = i.nominee_id AND n.client_id = i.client_id
       LEFT JOIN investment_agreements a
         ON a.investment_id = i.id AND a.client_id = i.client_id AND a.renewal_id IS NULL
       LEFT JOIN client_settings s ON s.client_id = i.client_id
       WHERE i.id = $1 AND i.client_id = $2 AND i.status IN ('Active', 'Closed')
       LIMIT 1`,
      [id, clientId]
    );

    const row = result.rows[0];
    if (!row) {
      res.status(404).json({ error: 'Approved investment not found.' });
      return;
    }

    const party = mapAgreementParty(row);
    const office = officeForSelection(party, { placeName: String(row.agreement_place ?? '') });

    res.json({
      id: row.id,
      code: row.code,
      request_id: row.request_id,
      status: row.status,
      user_id: row.user_id,
      customer_id: row.customer_id,
      plan_name: row.plan_name,
      fund_amount: money(row.fund_amount),
      interest_rate: asNumber(row.interest_rate),
      tds_percent: asNumber(row.tds_percent),
      payout_day: Number(row.payout_day) || 10,
      customer: {
        full_name: row.full_name,
        email: row.email_address,
        mobile: row.mobile_number,
        date_of_birth: row.date_of_birth,
        address: row.address,
        pan: row.pan_number ?? '',
        aadhaar: String(row.aadhaar_number ?? '').replace(/\D/g, ''),
      },
      bank: row.bank_id
        ? {
            id: row.bank_id,
            bank_name: row.bank_name,
            account_number: row.account_number,
            ifsc_code: row.ifsc_code,
            account_type: row.account_type,
            account_holder_name: row.account_holder_name,
            branch_name: row.branch_name ?? '',
          }
        : null,
      nominee: row.nominee_name
        ? {
            name: row.nominee_name,
            relation: row.relationship,
            aadhaar: String(row.nominee_aadhaar ?? '').replace(/\D/g, ''),
            pan: row.nominee_pan ?? '',
            mobile: row.nominee_mobile ?? '',
          }
        : null,
      agreement: row.agreement_place
        ? {
            officeId: office?.id ?? null,
            placeName: row.agreement_place,
            cheque_no: row.cheque_no,
            cheque_bank_name: row.cheque_bank_name,
            cheque_bank_address: row.cheque_bank_address,
          }
        : null,
    });
  })
);

investmentsRouter.patch(
  '/:id/approved',
  asyncHandler(async (req, res) => {
    const { clientId } = (req as AuthedRequest).auth;
    const id = text(req.params.id);
    if (!isUuid(id)) {
      res.status(404).json({ error: 'Investment not found.' });
      return;
    }

    const fullName = text(req.body?.fullName);
    const email = normalizeEmail(req.body?.email);
    const mobile = normalizeMobile(req.body?.mobile);
    const dateOfBirth = text(req.body?.dateOfBirth);
    const address = text(req.body?.address);
    const panNumber = text(req.body?.panNumber).toUpperCase().replace(/\s/g, '');
    const aadhaarNumber = String(req.body?.aadhaarNumber ?? '').replace(/\D/g, '');
    const nomineeName = text(req.body?.nomineeName);
    const nomineeRelationship = text(req.body?.nomineeRelationship);
    const nomineeAadhaar = String(req.body?.nomineeAadhaar ?? '').replace(/\D/g, '');
    const nomineePan = text(req.body?.nomineePan).toUpperCase().replace(/\s/g, '');
    const nomineeMobile = normalizeMobile(req.body?.nomineeMobile);
    const planName = text(req.body?.planName);
    const fundAmount = money(req.body?.fundAmount);
    const interestRate = asNumber(req.body?.interestRate);
    const tdsPercent = asNumber(req.body?.tdsPercent);
    const payoutDay = Number(req.body?.payoutDay);
    const bankName = text(req.body?.bankName);
    const accountNumber = String(req.body?.accountNumber ?? '').replace(/\D/g, '');
    const ifscCode = text(req.body?.ifscCode).toUpperCase().replace(/\s/g, '');
    const accountType = text(req.body?.accountType);
    const accountHolderName = text(req.body?.accountHolderName) || fullName;
    const branchName = text(req.body?.branchName);
    const officeId = text(req.body?.officeId);
    const chequeNo = text(req.body?.chequeNo);
    const chequeBankName = text(req.body?.chequeBankName);
    const chequeBankAddress = text(req.body?.chequeBankAddress);

    if (!fullName) {
      res.status(400).json({ error: 'Full name is required.' });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: 'Enter a valid email address.' });
      return;
    }
    if (!/^[6-9]\d{9}$/.test(mobile)) {
      res.status(400).json({ error: 'Enter a valid 10-digit Indian mobile number.' });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
      res.status(400).json({ error: 'Enter a valid date of birth.' });
      return;
    }
    if (!address) {
      res.status(400).json({ error: 'Address is required.' });
      return;
    }
    if (!planName) {
      res.status(400).json({ error: 'Plan / fund title is required.' });
      return;
    }
    if (!Number.isFinite(fundAmount) || fundAmount <= 0) {
      res.status(400).json({ error: 'Enter a valid fund amount.' });
      return;
    }
    if (!Number.isFinite(interestRate) || interestRate < 0 || interestRate > 1) {
      res.status(400).json({ error: 'Interest rate must be between 0 and 1 (e.g. 0.05).' });
      return;
    }
    if (!Number.isFinite(tdsPercent) || tdsPercent < 0 || tdsPercent > 1) {
      res.status(400).json({ error: 'TDS percent must be between 0 and 1.' });
      return;
    }
    if (!PAYOUT_DAYS.includes(payoutDay)) {
      res.status(400).json({ error: 'Select a valid payout day.' });
      return;
    }
    if (!bankName) {
      res.status(400).json({ error: 'Bank name is required.' });
      return;
    }
    if (!/^\d{9,18}$/.test(accountNumber)) {
      res.status(400).json({ error: 'Account number must be 9 to 18 digits.' });
      return;
    }
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifscCode)) {
      res.status(400).json({ error: 'Enter a valid IFSC code.' });
      return;
    }
    if (accountType !== 'Savings' && accountType !== 'Current') {
      res.status(400).json({ error: 'Account type must be Savings or Current.' });
      return;
    }

    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const current = await db.query(
        `SELECT i.id, i.customer_id, i.status, i.bank_account_id, i.nominee_id, i.total_earnings
         FROM investments i
         WHERE i.id = $1 AND i.client_id = $2
         FOR UPDATE`,
        [id, clientId]
      );
      const investment = current.rows[0];
      if (!investment) {
        await db.query('ROLLBACK');
        res.status(404).json({ error: 'Investment not found.' });
        return;
      }
      if (investment.status !== 'Active') {
        await db.query('ROLLBACK');
        res.status(400).json({ error: 'Only active approved investments can be edited.' });
        return;
      }

      const customerId = String(investment.customer_id);
      await db.query(
        `UPDATE customers
         SET full_name = $3, email_address = $4, mobile_number = $5,
             date_of_birth = $6, address = $7, updated_at = NOW()
         WHERE id = $1 AND client_id = $2`,
        [customerId, clientId, fullName, email, mobile, dateOfBirth, address]
      );

      if (panNumber || aadhaarNumber) {
        await db.query(
          `INSERT INTO kyc_documents (client_id, customer_id, aadhaar_number, pan_number)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (customer_id)
           DO UPDATE SET aadhaar_number = EXCLUDED.aadhaar_number, pan_number = EXCLUDED.pan_number`,
          [clientId, customerId, aadhaarNumber || null, panNumber || null]
        );
      }

      if (nomineeName && investment.nominee_id) {
        await db.query(
          `UPDATE nominees
           SET nominee_name = $3, relationship = $4, nominee_aadhaar = $5,
               nominee_pan = $6, nominee_mobile = $7
           WHERE id = $1 AND client_id = $2`,
          [
            investment.nominee_id,
            clientId,
            nomineeName,
            nomineeRelationship || 'Other',
            nomineeAadhaar || null,
            nomineePan || null,
            nomineeMobile || null,
          ]
        );
      }

      const existingBank = await db.query(
        `SELECT id, account_number, ifsc_code, bank_name, account_type,
                account_holder_name, branch_name
         FROM bank_accounts
         WHERE id = $1 AND client_id = $2
         LIMIT 1`,
        [investment.bank_account_id, clientId]
      );
      const bank = existingBank.rows[0] as
        | {
            id: string;
            account_number: string;
            ifsc_code: string;
            bank_name: string;
            account_type: string;
            account_holder_name: string;
            branch_name: string;
          }
        | undefined;
      const digits = (value: unknown) => String(value ?? '').replace(/\D/g, '');
      const bankChanged =
        !bank ||
        digits(bank.account_number) !== accountNumber ||
        String(bank.ifsc_code ?? '').toUpperCase().replace(/\s/g, '') !== ifscCode ||
        String(bank.bank_name ?? '').trim().toLowerCase() !== bankName.toLowerCase() ||
        String(bank.account_type ?? '') !== accountType ||
        String(bank.account_holder_name ?? '').trim().toLowerCase() !== accountHolderName.toLowerCase() ||
        String(bank.branch_name ?? '').trim().toLowerCase() !== branchName.toLowerCase();

      let bankId = investment.bank_account_id as string;
      if (bankChanged) {
        const match = await db.query(
          `SELECT id FROM bank_accounts
           WHERE customer_id = $1 AND client_id = $2
             AND regexp_replace(account_number, '\\s', '', 'g') = $3
             AND upper(regexp_replace(ifsc_code, '\\s', '', 'g')) = $4
           LIMIT 1`,
          [customerId, clientId, accountNumber, ifscCode]
        );
        if (match.rows[0]) {
          bankId = String(match.rows[0].id);
          await db.query(
            `UPDATE bank_accounts
             SET bank_name = $3, account_number = $4, ifsc_code = $5, account_type = $6,
                 account_holder_name = $7, branch_name = $8
             WHERE id = $1 AND client_id = $2`,
            [bankId, clientId, bankName, accountNumber, ifscCode, accountType, accountHolderName, branchName]
          );
        } else {
          const inserted = await db.query(
            `INSERT INTO bank_accounts (
               client_id, customer_id, account_holder_name, account_number, ifsc_code,
               bank_name, account_type, is_primary, branch_name
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,FALSE,$8)
             RETURNING id`,
            [clientId, customerId, accountHolderName, accountNumber, ifscCode, bankName, accountType, branchName]
          );
          bankId = String(inserted.rows[0].id);
        }
      }

      await db.query(
        `UPDATE investments
         SET name = $3,
             fund_amount = $4,
             current_value = $4 + COALESCE(total_earnings, 0),
             interest_rate = $5,
             tds_percent = $6,
             payout_day = $7,
             bank_account_id = $8,
             updated_at = NOW()
         WHERE id = $1 AND client_id = $2`,
        [id, clientId, planName, fundAmount, interestRate, tdsPercent, payoutDay, bankId]
      );

      const agreement = await db.query(
        `SELECT id FROM investment_agreements
         WHERE investment_id = $1 AND client_id = $2 AND renewal_id IS NULL
         LIMIT 1`,
        [id, clientId]
      );
      if (agreement.rows[0]) {
        const settings = await db.query(
          `SELECT agreement_offices, second_party_name, second_party_nominee_name,
                  second_party_nominee_aadhaar, second_party_nominee_pan,
                  second_party_nominee_relation, second_party_nominee_phone
           FROM client_settings WHERE client_id = $1 LIMIT 1`,
          [clientId]
        );
        const party = mapAgreementParty(settings.rows[0] ?? {});
        const office = officeForSelection(party, { officeId, placeName: officeId });
        if (office && chequeNo && chequeBankName && chequeBankAddress) {
          await db.query(
            `UPDATE investment_agreements
             SET branch = $3, cheque_no = $4, cheque_bank_name = $5, cheque_bank_address = $6,
                 fund_amount = $7, notice_days = $8, updated_at = NOW()
             WHERE investment_id = $1 AND client_id = $2 AND renewal_id IS NULL`,
            [
              id,
              clientId,
              office.placeName,
              chequeNo,
              chequeBankName,
              chequeBankAddress,
              fundAmount,
              office.noticeDays,
            ]
          );
        } else {
          await db.query(
            `UPDATE investment_agreements
             SET fund_amount = $3, updated_at = NOW()
             WHERE investment_id = $1 AND client_id = $2 AND renewal_id IS NULL`,
            [id, clientId, fundAmount]
          );
        }
      }

      await db.query('COMMIT');
      res.json({ ok: true, id });
    } catch (error) {
      await db.query('ROLLBACK');
      if (isEmailMobileComboDuplicate(error)) {
        res.status(409).json({ error: EMAIL_MOBILE_COMBO_ERROR });
        return;
      }
      const message = String((error as { message?: string }).message ?? '');
      if ((error as { code?: string }).code === '23505' && message.includes('investments_customer_name_idx')) {
        res.status(409).json({ error: 'This customer already has an investment with that fund title.' });
        return;
      }
      throw error;
    } finally {
      db.release();
    }
  })
);

investmentsRouter.post(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    const { clientId } = (req as AuthedRequest).auth;
    const id = text(req.params.id);
    if (!isUuid(id)) {
      res.status(404).json({ error: 'Investment not found.' });
      return;
    }

    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const current = await db.query(
        `SELECT id, status FROM investments
         WHERE id = $1 AND client_id = $2
         FOR UPDATE`,
        [id, clientId]
      );
      const row = current.rows[0];
      if (!row) {
        await db.query('ROLLBACK');
        res.status(404).json({ error: 'Investment not found.' });
        return;
      }
      if (row.status !== 'Active') {
        await db.query('ROLLBACK');
        res.status(400).json({ error: 'Only active approved investments can be cancelled.' });
        return;
      }

      await db.query(
        `UPDATE investments
         SET status = 'Rejected', updated_at = NOW()
         WHERE id = $1 AND client_id = $2`,
        [id, clientId]
      );
      await db.query(
        `DELETE FROM referral_rewards
         WHERE investment_id = $1 AND client_id = $2 AND status = 'Pending'`,
        [id, clientId]
      );
      await db.query('COMMIT');
      res.json({ ok: true, id, status: 'Rejected' });
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
  })
);

investmentsRouter.patch(
  '/:id/terms',
  asyncHandler(async (req, res) => {
    const { clientId } = (req as AuthedRequest).auth;
    const id = text(req.params.id);
    const interestRate = asNumber(req.body?.interestRate ?? req.body?.interest_rate);
    const tdsPercent = asNumber(req.body?.tdsPercent ?? req.body?.tds_percent);
    const payoutDay = Number(req.body?.payoutDay ?? req.body?.payout_day);
    const referralRateRaw = req.body?.referralRate ?? req.body?.referral_rate;

    if (!isUuid(id)) {
      res.status(404).json({ error: 'Investment request not found.' });
      return;
    }
    if (!Number.isFinite(interestRate) || interestRate <= 0 || interestRate > 1) {
      res.status(400).json({ error: 'Interest rate must be a decimal between 0 and 1 (e.g. 0.05).' });
      return;
    }
    if (!Number.isFinite(tdsPercent) || tdsPercent < 0 || tdsPercent > 1) {
      res.status(400).json({ error: 'TDS percent must be a decimal between 0 and 1.' });
      return;
    }
    if (!PAYOUT_DAYS.includes(payoutDay)) {
      res.status(400).json({ error: 'Payout day must be one of 1, 5, 10, 15, 20, or 25.' });
      return;
    }
    const referralRate =
      referralRateRaw === undefined || referralRateRaw === null || referralRateRaw === ''
        ? null
        : asNumber(referralRateRaw);
    if (referralRate !== null && (!Number.isFinite(referralRate) || referralRate <= 0 || referralRate > 1)) {
      res.status(400).json({ error: 'Referral rate must be a decimal between 0 and 1.' });
      return;
    }

    const updated = await pool.query(
      `UPDATE investments
       SET interest_rate = $3,
           tds_percent = $4,
           payout_day = $5,
           referral_rate = COALESCE($6, referral_rate),
           updated_at = NOW()
       WHERE id = $1
         AND client_id = $2
         AND status IN ('Pending', 'Under Review')
       RETURNING id, interest_rate, tds_percent, payout_day, referral_rate, status`,
      [id, clientId, interestRate, tdsPercent, payoutDay, referralRate]
    );

    if ((updated.rowCount ?? 0) === 0) {
      const exists = await pool.query(
        `SELECT status FROM investments WHERE id = $1 AND client_id = $2 LIMIT 1`,
        [id, clientId]
      );
      if ((exists.rowCount ?? 0) === 0) {
        res.status(404).json({ error: 'Investment request not found.' });
        return;
      }
      res.status(400).json({ error: 'Only pending or held requests can have terms updated.' });
      return;
    }

    const row = updated.rows[0];
    res.json({
      id: row.id,
      interest_rate: asNumber(row.interest_rate),
      tds_percent: asNumber(row.tds_percent),
      payout_day: Number(row.payout_day),
      referral_rate: asNumber(row.referral_rate),
      status: row.status,
    });
  })
);

investmentsRouter.post(
  '/:id/decision',
  asyncHandler(async (req, res) => {
    const { clientId } = (req as AuthedRequest).auth;
    const id = text(req.params.id);
    const action = text(req.body?.action).toLowerCase();

    if (!isUuid(id)) {
      res.status(404).json({ error: 'Investment request not found.' });
      return;
    }
    if (action !== 'approve' && action !== 'hold' && action !== 'reject') {
      res.status(400).json({ error: 'Action must be approve, hold, or reject.' });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query(
        `SELECT id, status, fund_amount, request_id, total_earnings
         FROM investments
         WHERE id = $1 AND client_id = $2
         FOR UPDATE`,
        [id, clientId]
      );
      const row = current.rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Investment request not found.' });
        return;
      }
      if (row.status !== 'Pending' && row.status !== 'Under Review') {
        await client.query('ROLLBACK');
        res.status(400).json({ error: 'This request has already been decided.' });
        return;
      }

      let updated;
      if (action === 'approve') {
        updated = await client.query(
          `UPDATE investments
           SET status = 'Active',
               invested_date = COALESCE(invested_date, ${istTodaySql()}),
               current_value = fund_amount + COALESCE(total_earnings, 0),
               updated_at = NOW()
           WHERE id = $1 AND client_id = $2
           RETURNING id, request_id, status, fund_amount`,
          [id, clientId]
        );
      } else if (action === 'hold') {
        updated = await client.query(
          `UPDATE investments
           SET status = 'Under Review', updated_at = NOW()
           WHERE id = $1 AND client_id = $2
           RETURNING id, request_id, status, fund_amount`,
          [id, clientId]
        );
      } else {
        updated = await client.query(
          `UPDATE investments
           SET status = 'Rejected', updated_at = NOW()
           WHERE id = $1 AND client_id = $2
           RETURNING id, request_id, status, fund_amount`,
          [id, clientId]
        );
      }

      await client.query('COMMIT');
      const next = updated.rows[0];
      res.json({
        id: next.id,
        request_id: next.request_id,
        status: next.status,
        fund_amount: money(next.fund_amount),
        action,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  })
);
