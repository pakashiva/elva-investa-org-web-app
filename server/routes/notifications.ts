import { Router } from 'express';
import { pool } from '../db';
import { asyncHandler } from '../middleware';
import type { AuthedRequest } from '../types';
import { money, text } from '../util';

export const notificationsRouter = Router();

notificationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const auth = (req as AuthedRequest).auth;
    const filter = text(req.query.filter).toLowerCase() || 'all';
    const kind = text(req.query.kind).toLowerCase() || 'all';
    const search = text(req.query.q);
    const from = text(req.query.from) || null;
    const to = text(req.query.to) || null;

    const feed = await pool.query(
      `SELECT
         n.notice_key,
         n.kind,
         n.customer_name,
         n.amount,
         n.plan_name,
         n.occurred_at,
         n.href,
         (r.notice_key IS NULL) AS unread
       FROM (
         SELECT
           'investment:' || i.id::text AS notice_key,
           'investment' AS kind,
           c.full_name AS customer_name,
           i.fund_amount AS amount,
           i.name AS plan_name,
           i.created_at AS occurred_at,
           '/investment-requests/' || i.id::text AS href
         FROM investments i
         JOIN customers c ON c.id = i.customer_id AND c.client_id = i.client_id
         WHERE i.client_id = $1 AND i.status IN ('Pending', 'Under Review')

         UNION ALL

         SELECT
           'renewal:' || r.id::text AS notice_key,
           'investment' AS kind,
           c.full_name AS customer_name,
           CASE
             WHEN r.mode = 'increase'
               THEN COALESCE(r.current_amount, 0) + COALESCE(r.increment_amount, 0)
             ELSE r.current_amount
           END AS amount,
           CASE
             WHEN r.mode = 'increase' THEN 'Agreement Renewal · Increase'
             ELSE 'Agreement Renewal · Same Amount'
           END AS plan_name,
           r.created_at AS occurred_at,
           '/investment-requests/renewal/' || r.id::text AS href
         FROM agreement_renewal_requests r
         JOIN customers c ON c.id = r.customer_id AND c.client_id = r.client_id
         WHERE r.client_id = $1 AND r.status = 'Pending'

         UNION ALL

         SELECT
           'withdrawal:' || w.id::text,
           'withdrawal',
           c.full_name,
           w.withdrawal_amount,
           NULL,
           COALESCE(w.created_at, w.requested_on::timestamptz),
           '/withdrawals'
         FROM withdrawals w
         JOIN customers c ON c.id = w.customer_id AND c.client_id = w.client_id
         WHERE w.client_id = $1 AND w.status IN ('Processing', 'On Hold')

         UNION ALL

         SELECT
           'customer:' || c.id::text,
           'customer',
           c.full_name,
           NULL,
           NULL,
           c.created_at,
           '/customers'
         FROM customers c
         WHERE c.client_id = $1
           AND c.created_at >= (NOW() - INTERVAL '7 days')
       ) n
       LEFT JOIN admin_notification_reads r
         ON r.notice_key = n.notice_key AND r.user_id = $2
       ORDER BY n.occurred_at DESC`,
      [auth.clientId, auth.id]
    );

    const rows = feed.rows.filter((row) => {
      const occurred = String(row.occurred_at ?? '').slice(0, 10);
      if (from && occurred < from) return false;
      if (to && occurred > to) return false;
      if (kind !== 'all' && row.kind !== kind) return false;
      if (filter === 'unread' && !row.unread) return false;
      if ((filter === 'investment' || filter === 'withdrawal' || filter === 'customer') && row.kind !== filter) {
        return false;
      }
      if (search) {
        const hay = `${row.customer_name} ${row.plan_name ?? ''} ${row.amount ?? ''}`.toLowerCase();
        if (!hay.includes(search.toLowerCase())) return false;
      }
      return true;
    });

    res.json({
      rows: rows.map((row) => ({
        key: row.notice_key,
        kind: row.kind,
        customer_name: row.customer_name,
        amount: row.amount == null ? null : money(row.amount),
        plan_name: row.plan_name,
        occurred_at: row.occurred_at,
        href: row.href,
        unread: Boolean(row.unread),
      })),
      unreadCount: rows.filter((row) => row.unread).length,
    });
  })
);

notificationsRouter.get(
  '/unread-count',
  asyncHandler(async (req, res) => {
    const auth = (req as AuthedRequest).auth;
    const result = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM (
         SELECT 'investment:' || i.id::text AS notice_key
         FROM investments i
         WHERE i.client_id = $1 AND i.status IN ('Pending', 'Under Review')
         UNION ALL
         SELECT 'renewal:' || r.id::text
         FROM agreement_renewal_requests r
         WHERE r.client_id = $1 AND r.status = 'Pending'
         UNION ALL
         SELECT 'withdrawal:' || w.id::text
         FROM withdrawals w
         WHERE w.client_id = $1 AND w.status IN ('Processing', 'On Hold')
         UNION ALL
         SELECT 'customer:' || c.id::text
         FROM customers c
         WHERE c.client_id = $1 AND c.created_at >= (NOW() - INTERVAL '7 days')
       ) n
       LEFT JOIN admin_notification_reads r
         ON r.notice_key = n.notice_key AND r.user_id = $2
       WHERE r.notice_key IS NULL`,
      [auth.clientId, auth.id]
    );
    res.json({ unreadCount: Number(result.rows[0]?.total ?? 0) });
  })
);

notificationsRouter.post(
  '/read',
  asyncHandler(async (req, res) => {
    const auth = (req as AuthedRequest).auth;
    const key = text(req.body?.key);
    const read = req.body?.read !== false;
    if (!key) {
      res.status(400).json({ error: 'Notification key is required.' });
      return;
    }
    if (read) {
      await pool.query(
        `INSERT INTO admin_notification_reads (user_id, notice_key)
         VALUES ($1, $2)
         ON CONFLICT (user_id, notice_key) DO NOTHING`,
        [auth.id, key]
      );
    } else {
      await pool.query(
        `DELETE FROM admin_notification_reads WHERE user_id = $1 AND notice_key = $2`,
        [auth.id, key]
      );
    }
    res.json({ ok: true });
  })
);

notificationsRouter.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    const auth = (req as AuthedRequest).auth;
    await pool.query(
      `INSERT INTO admin_notification_reads (user_id, notice_key)
       SELECT $2, n.notice_key
       FROM (
         SELECT 'investment:' || i.id::text AS notice_key
         FROM investments i
         WHERE i.client_id = $1 AND i.status IN ('Pending', 'Under Review')
         UNION ALL
         SELECT 'renewal:' || r.id::text
         FROM agreement_renewal_requests r
         WHERE r.client_id = $1 AND r.status = 'Pending'
         UNION ALL
         SELECT 'withdrawal:' || w.id::text
         FROM withdrawals w
         WHERE w.client_id = $1 AND w.status IN ('Processing', 'On Hold')
         UNION ALL
         SELECT 'customer:' || c.id::text
         FROM customers c
         WHERE c.client_id = $1 AND c.created_at >= (NOW() - INTERVAL '7 days')
       ) n
       ON CONFLICT (user_id, notice_key) DO NOTHING`,
      [auth.clientId, auth.id]
    );
    res.json({ ok: true });
  })
);
