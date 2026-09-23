import { Router } from 'express';
import { pool } from '../db';
import { asyncHandler } from '../middleware';
import type { AuthedRequest } from '../types';
import { asNumber, isUuid, money, text } from '../util';

export const referralsRouter = Router();

referralsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { clientId } = (req as AuthedRequest).auth;
    const page = Math.max(1, Number(req.query.page ?? 1) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize ?? 10) || 10));
    const offset = (page - 1) * pageSize;

    const settings = await pool.query(
      `SELECT referral_rate, referral_tds_rate FROM client_settings WHERE client_id = $1`,
      [clientId]
    );
    const setting = settings.rows[0] ?? { referral_rate: 0.01, referral_tds_rate: 0.02 };

    const kpis = await pool.query(
      `SELECT
         COUNT(*)::int AS total_referrals,
         COALESCE(SUM(gross_bonus), 0) AS gross_commission,
         COALESCE(SUM(tds_amount), 0) AS tds_amount,
         COALESCE(SUM(net_bonus), 0) AS net_commission
       FROM referral_rewards
       WHERE client_id = $1`,
      [clientId]
    );

    const count = await pool.query(
      `SELECT COUNT(*)::int AS total FROM referral_rewards WHERE client_id = $1`,
      [clientId]
    );
    const result = await pool.query(
      `SELECT
         r.id, r.status, r.referrer_customer_id, r.referred_customer_id,
         r.investment_id, r.referral_code, r.capital_amount, r.referral_rate,
         r.gross_bonus, r.tds_rate, r.tds_amount, r.net_bonus, r.created_at,
         a.full_name AS referrer_name,
         b.full_name AS referred_name,
         i.code AS investment_code,
         COALESCE((
           SELECT SUM(x.net_bonus) FROM referral_rewards x
           WHERE x.referrer_customer_id = r.referrer_customer_id
             AND x.client_id = r.client_id
             AND x.status = 'Paid'
         ), 0) AS lifetime_paid_net
       FROM referral_rewards r
       JOIN customers a ON a.id = r.referrer_customer_id
       JOIN customers b ON b.id = r.referred_customer_id
       JOIN investments i ON i.id = r.investment_id
       WHERE r.client_id = $1
       ORDER BY r.created_at DESC
       LIMIT $2 OFFSET $3`,
      [clientId, pageSize, offset]
    );

    res.json({
      settings: {
        referral_rate: asNumber(setting.referral_rate) || 0.01,
        tds_rate: asNumber(setting.referral_tds_rate) || 0.02,
      },
      kpis: {
        totalReferrals: Number(kpis.rows[0]?.total_referrals ?? 0),
        grossCommission: money(kpis.rows[0]?.gross_commission),
        tdsAmount: money(kpis.rows[0]?.tds_amount),
        netCommission: money(kpis.rows[0]?.net_commission),
      },
      rows: result.rows.map((row) => ({
        id: row.id,
        status: row.status,
        referrer_user_id: row.referrer_customer_id,
        referred_user_id: row.referred_customer_id,
        referrer_name: row.referrer_name,
        referred_name: row.referred_name,
        investment_id: row.investment_id,
        investment_code: row.investment_code,
        referral_code: row.referral_code,
        capital_amount: money(row.capital_amount),
        referral_rate: asNumber(row.referral_rate),
        gross_bonus: money(row.gross_bonus),
        tds_rate: asNumber(row.tds_rate),
        tds_amount: money(row.tds_amount),
        net_bonus: money(row.net_bonus),
        lifetime_paid_net: money(row.lifetime_paid_net),
        created_at: row.created_at,
      })),
      total: Number(count.rows[0]?.total ?? 0),
      limit: pageSize,
      offset,
    });
  })
);

referralsRouter.post(
  '/:id/decision',
  asyncHandler(async (req, res) => {
    const { clientId } = (req as AuthedRequest).auth;
    const id = text(req.params.id);
    const action = text(req.body?.action).toLowerCase();
    if (!isUuid(id)) {
      res.status(404).json({ error: 'Referral commission not found.' });
      return;
    }
    if (action !== 'pay' && action !== 'hold') {
      res.status(400).json({ error: 'Action must be pay or hold.' });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query(
        `SELECT * FROM referral_rewards WHERE id = $1 AND client_id = $2 FOR UPDATE`,
        [id, clientId]
      );
      const row = current.rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Referral commission not found.' });
        return;
      }

      if (action === 'pay') {
        await client.query(
          `UPDATE referral_rewards SET status = 'Paid' WHERE id = $1 AND client_id = $2`,
          [id, clientId]
        );
        const code = await client.query(`SELECT code FROM investments WHERE id = $1`, [
          row.investment_id,
        ]);
        await client.query(
          `INSERT INTO transactions (
             client_id, customer_id, transaction_type, amount, investment_id,
             investment_plan_id, reference_id, transaction_date, source_type, source_id
           ) VALUES (
             $1, $2, 'referral_bonus', $3, $4, $5, $6, public.admin_ist_today(), 'referral', $7
           )
           ON CONFLICT (source_type, source_id) DO NOTHING`,
          [
            clientId,
            row.referrer_customer_id,
            money(row.net_bonus),
            row.investment_id,
            code.rows[0]?.code ?? '—',
            row.id,
            row.id,
          ]
        );
        await client.query('COMMIT');
        res.json({ id, status: 'Paid', net_bonus: money(row.net_bonus), action });
        return;
      }

      await client.query(
        `DELETE FROM transactions WHERE source_type = 'referral' AND source_id = $1`,
        [id]
      );
      await client.query(
        `UPDATE referral_rewards SET status = 'Pending' WHERE id = $1 AND client_id = $2`,
        [id, clientId]
      );
      await client.query('COMMIT');
      res.json({ id, status: 'Pending', net_bonus: money(row.net_bonus), action });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  })
);
