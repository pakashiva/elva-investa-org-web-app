import { Router } from 'express';
import { pool } from '../db';
import { asyncHandler } from '../middleware';
import type { AuthedRequest } from '../types';
import { asNumber, isUuid, money, text } from '../util';

export const withdrawalsRouter = Router();

function settlement(row: {
  strategy: string;
  withdrawal_amount: unknown;
  total_earnings: unknown;
  tds_percent: unknown;
  net_payout: unknown;
}) {
  const amount = money(row.withdrawal_amount);
  if (row.net_payout != null) {
    const net = money(row.net_payout);
    return { tds_amount: Math.max(0, money(amount - net)), net_payout: net };
  }
  const rate = asNumber(row.tds_percent);
  const tds =
    String(row.strategy) === 'partial'
      ? 0
      : money(Math.max(0, money(row.total_earnings)) * (Number.isFinite(rate) ? rate : 0.1));
  return { tds_amount: tds, net_payout: Math.max(0, money(amount - tds)) };
}

withdrawalsRouter.get(
  '/active-funds/:customerId',
  asyncHandler(async (req, res) => {
    const { clientId } = (req as AuthedRequest).auth;
    const customerId = text(req.params.customerId);
    if (!isUuid(customerId)) {
      res.status(400).json({ error: 'Select a customer.' });
      return;
    }
    const result = await pool.query(
      `SELECT id, code, name, fund_amount, current_value, total_earnings, tds_percent, status
       FROM investments
       WHERE customer_id = $1 AND client_id = $2 AND status = 'Active'
       ORDER BY created_at DESC`,
      [customerId, clientId]
    );
    res.json({
      funds: result.rows.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        fund_amount: money(row.fund_amount),
        current_value: money(row.current_value ?? money(row.fund_amount) + money(row.total_earnings)),
        total_earnings: money(row.total_earnings),
        tds_percent: asNumber(row.tds_percent) || 0,
      })),
    });
  })
);

withdrawalsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { clientId } = (req as AuthedRequest).auth;
    const filter = text(req.query.filter).toLowerCase() || 'pending';
    const search = text(req.query.q);
    const page = Math.max(1, Number(req.query.page ?? 1) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize ?? 10) || 10));
    const offset = (page - 1) * pageSize;

    const filters = ['w.client_id = $1'];
    const params: unknown[] = [clientId];

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
      filters.push(
        `(c.full_name ILIKE $${idx} OR i.code ILIKE $${idx} OR COALESCE(ba.bank_name, '') ILIKE $${idx})`
      );
    }

    const where = filters.join(' AND ');
    const count = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM withdrawals w
       JOIN investments i ON i.id = w.investment_id AND i.client_id = w.client_id
       JOIN customers c ON c.id = w.customer_id AND c.client_id = w.client_id
       LEFT JOIN bank_accounts ba ON ba.id = w.bank_account_id
       WHERE ${where}`,
      params
    );
    const result = await pool.query(
      `SELECT
         w.id, w.status, w.strategy, w.withdrawal_amount, w.net_payout, w.requested_on,
         w.updated_at, w.created_at,
         c.full_name AS customer_name, c.authorized AS agreement_ok,
         i.code AS investment_code, i.name AS plan_name, i.fund_amount AS available_principal,
         i.total_earnings, i.tds_percent,
         ba.bank_name, ba.account_number
       FROM withdrawals w
       JOIN investments i ON i.id = w.investment_id AND i.client_id = w.client_id
       JOIN customers c ON c.id = w.customer_id AND c.client_id = w.client_id
       LEFT JOIN bank_accounts ba ON ba.id = w.bank_account_id
       WHERE ${where}
       ORDER BY w.requested_on DESC, w.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset]
    );

    res.json({
      rows: result.rows.map((row) => {
        const settled = settlement(row);
        return {
          id: row.id,
          status: row.status,
          strategy: row.strategy,
          customer_name: row.customer_name,
          investment_code: row.investment_code,
          plan_name: row.plan_name,
          available_principal: money(row.available_principal),
          withdrawal_amount: money(row.withdrawal_amount),
          tds_amount: settled.tds_amount,
          tds_percent: asNumber(row.tds_percent) || 0,
          net_payout: settled.net_payout,
          bank_name: row.bank_name,
          account_number: row.account_number,
          requested_on: row.requested_on,
          updated_at: row.updated_at,
          agreement_ok: Boolean(row.agreement_ok),
        };
      }),
      total: Number(count.rows[0]?.total ?? 0),
      limit: pageSize,
      offset,
    });
  })
);

withdrawalsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { clientId } = (req as AuthedRequest).auth;
    const customerId = text(req.body?.userId ?? req.body?.customerId);
    const investmentId = text(req.body?.investmentId ?? req.body?.investment_id);
    const bankAccountId = text(req.body?.bankAccountId ?? req.body?.bank_account_id);
    const strategy = text(req.body?.strategy).toLowerCase() === 'partial' ? 'partial' : 'full';
    const amount = money(req.body?.amount);

    if (!isUuid(customerId)) {
      res.status(400).json({ error: 'Select a customer.' });
      return;
    }
    if (!isUuid(investmentId)) {
      res.status(400).json({ error: 'Select an active investment.' });
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
      const fund = await client.query(
        `SELECT id, customer_id, fund_amount, current_value, total_earnings, status
         FROM investments
         WHERE id = $1 AND client_id = $2
         FOR UPDATE`,
        [investmentId, clientId]
      );
      const inv = fund.rows[0];
      if (!inv || inv.customer_id !== customerId || inv.status !== 'Active') {
        await client.query('ROLLBACK');
        res.status(400).json({ error: 'Active investment not found for this customer.' });
        return;
      }

      const bank = await client.query(
        `SELECT 1 FROM bank_accounts WHERE id = $1 AND customer_id = $2 AND client_id = $3`,
        [bankAccountId, customerId, clientId]
      );
      if ((bank.rowCount ?? 0) === 0) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: 'Selected bank account does not belong to this customer.' });
        return;
      }

      const inserted = await client.query(
        `INSERT INTO withdrawals (
           client_id, customer_id, investment_id, bank_account_id,
           status, withdrawal_amount, strategy
         ) VALUES ($1,$2,$3,$4,'Processing',$5,$6)
         RETURNING id, request_id, status, withdrawal_amount, strategy`,
        [clientId, customerId, investmentId, bankAccountId, amount, strategy]
      );
      await client.query('COMMIT');
      const row = inserted.rows[0];
      res.status(201).json({
        ok: true,
        id: row.id,
        request_id: row.request_id,
        status: row.status,
        withdrawal_amount: money(row.withdrawal_amount),
        strategy: row.strategy,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      const message = String((error as { message?: string }).message ?? '');
      if (message.includes('already has an open')) {
        res.status(409).json({ error: 'This investment already has an open withdrawal request.' });
        return;
      }
      if (message.includes('Minimum remaining') || message.includes('Full withdrawal') || message.includes('entire principal') || message.includes('greater than zero') || message.includes('Active investment')) {
        res.status(400).json({ error: message.replace('ERROR: ', '').split('\n')[0] });
        return;
      }
      throw error;
    } finally {
      client.release();
    }
  })
);

withdrawalsRouter.post(
  '/:id/decision',
  asyncHandler(async (req, res) => {
    const { clientId } = (req as AuthedRequest).auth;
    const id = text(req.params.id);
    const action = text(req.body?.action).toLowerCase();
    if (!isUuid(id)) {
      res.status(404).json({ error: 'Withdrawal request not found.' });
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
        `SELECT w.*, i.total_earnings, i.tds_percent
         FROM withdrawals w
         JOIN investments i ON i.id = w.investment_id
         WHERE w.id = $1 AND w.client_id = $2
         FOR UPDATE OF w`,
        [id, clientId]
      );
      const row = current.rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Withdrawal request not found.' });
        return;
      }
      if (row.status !== 'Processing' && row.status !== 'On Hold') {
        await client.query('ROLLBACK');
        res.status(400).json({ error: 'This withdrawal has already been decided.' });
        return;
      }

      let updated;
      if (action === 'approve') {
        const settled = settlement(row);
        await client.query(
          `UPDATE withdrawals
           SET net_payout = $3, status = 'Approved', status_date = NOW(), updated_at = NOW()
           WHERE id = $1 AND client_id = $2`,
          [id, clientId, settled.net_payout]
        );
        updated = await client.query(
          `UPDATE withdrawals
           SET status = 'Paid', status_date = NOW(), updated_at = NOW()
           WHERE id = $1 AND client_id = $2
           RETURNING id, status, net_payout, withdrawal_amount`,
          [id, clientId]
        );
      } else if (action === 'hold') {
        updated = await client.query(
          `UPDATE withdrawals
           SET status = 'On Hold', status_date = NOW(), updated_at = NOW()
           WHERE id = $1 AND client_id = $2
           RETURNING id, status, net_payout, withdrawal_amount`,
          [id, clientId]
        );
      } else {
        updated = await client.query(
          `UPDATE withdrawals
           SET status = 'Rejected', status_date = NOW(), updated_at = NOW()
           WHERE id = $1 AND client_id = $2
           RETURNING id, status, net_payout, withdrawal_amount`,
          [id, clientId]
        );
      }

      await client.query('COMMIT');
      const next = updated.rows[0];
      res.json({
        id: next.id,
        status: next.status,
        net_payout: money(next.net_payout),
        withdrawal_amount: money(next.withdrawal_amount),
        action,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      const message = String((error as { message?: string }).message ?? '');
      if (message.includes('below minimum') || message.includes('Active investment')) {
        res.status(400).json({ error: message.replace('ERROR: ', '').split('\n')[0] });
        return;
      }
      throw error;
    } finally {
      client.release();
    }
  })
);
