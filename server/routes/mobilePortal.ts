import { Router } from 'express';
import { pool } from '../db';
import { asyncHandler, requireCustomer } from '../middleware';
import type { CustomerRequest } from '../types';
import { toDateOnly } from '../customerView';
import { formatInr, isUuid, money, text } from '../util';

export const mobilePortalRouter = Router();

mobilePortalRouter.use(requireCustomer);

function maskAccount(accountNumber: unknown) {
  const digits = String(accountNumber ?? '').replace(/\D/g, '');
  const last4 = digits.slice(-4) || '****';
  return `**** ${last4}`;
}

function bankLabel(bankName: unknown, accountNumber: unknown) {
  const name = text(bankName) || 'Bank Account';
  return `${name} ${maskAccount(accountNumber)}`;
}

function istTodaySql() {
  return `(NOW() AT TIME ZONE 'Asia/Kolkata')::DATE`;
}

function mapInvestment(row: Record<string, unknown>) {
  const fundAmount = money(row.fund_amount);
  const totalEarnings = money(row.total_earnings);
  const tdsDeductedAmount = money(row.tds_deducted_amount);
  const currentValue = money(row.current_value ?? fundAmount + totalEarnings);
  const status = String(row.status ?? 'Pending');

  return {
    id: row.id,
    code: row.request_id || row.code,
    requestId: row.request_id ?? null,
    name: row.name,
    status,
    fundAmount,
    currentValue,
    interestRate: Number(row.interest_rate ?? 0),
    tdsPercent: Number(row.tds_percent ?? 0),
    totalEarnings,
    tdsDeductedAmount,
    investedDate: row.invested_date ?? null,
    completedInterestPeriods: Number(row.completed_interest_periods ?? 0),
    createdAt: row.created_at,
  };
}

function mapWithdrawal(row: Record<string, unknown>) {
  const amount = money(row.withdrawal_amount);
  const net =
    row.net_payout != null
      ? money(row.net_payout)
      : amount;
  const investmentCode = String(row.investment_code ?? row.code ?? '—');
  const requestCode = String(row.request_id || row.withdrawal_code || '').trim() || investmentCode;

  return {
    id: row.id,
    requestId: row.request_id ?? null,
    investmentId: row.investment_id,
    investmentCode,
    requestCode,
    fundName: row.fund_name ?? 'Investment',
    status: String(row.status ?? 'Processing'),
    strategy: row.strategy === 'partial' ? 'partial' : 'full',
    withdrawalAmount: amount,
    netPayout: net,
    requestedOn: row.requested_on,
    statusDate: row.status_date ?? row.updated_at,
    createdAt: row.created_at,
  };
}

function pgMessage(error: unknown) {
  return String((error as { message?: string }).message ?? '')
    .replace('ERROR: ', '')
    .split('\n')[0];
}

mobilePortalRouter.get(
  '/home',
  asyncHandler(async (req, res) => {
    const { id: customerId, clientId } = (req as CustomerRequest).customer;

    const [active, paid] = await Promise.all([
      pool.query(
        `SELECT
           name, fund_amount, total_earnings, interest_rate, invested_date,
           completed_interest_periods, tds_percent
         FROM investments
         WHERE customer_id = $1 AND client_id = $2 AND status = 'Active'
         ORDER BY created_at DESC`,
        [customerId, clientId]
      ),
      pool.query(
        `SELECT COALESCE(net_payout, withdrawal_amount) AS amount
         FROM withdrawals
         WHERE customer_id = $1 AND client_id = $2 AND status = 'Paid'`,
        [customerId, clientId]
      ),
    ]);

    const totalInvested = active.rows.reduce((sum, row) => sum + money(row.fund_amount), 0);
    const currentTotalReturns = active.rows.reduce(
      (sum, row) => sum + money(row.total_earnings),
      0
    );
    const totalWithdrawals = paid.rows.reduce((sum, row) => sum + money(row.amount), 0);
    const totalGainPercent = totalInvested > 0 ? (currentTotalReturns / totalInvested) * 100 : 0;

    res.json({
      summary: {
        totalInvested,
        activeInvestmentCount: active.rows.length,
        currentTotalReturns,
        totalGainPercent,
        maturityValue: money(totalInvested + currentTotalReturns),
        totalWithdrawals,
        paidWithdrawalCount: paid.rows.length,
      },
      chartInvestments: active.rows.map((row) => ({
        name: row.name,
        fundAmount: money(row.fund_amount),
        totalEarnings: money(row.total_earnings),
        interestRate: Number(row.interest_rate ?? 0),
        investedDate: row.invested_date ?? null,
        completedInterestPeriods: Number(row.completed_interest_periods ?? 0),
        tdsPercent: Number(row.tds_percent ?? 0),
      })),
    });
  })
);

mobilePortalRouter.get(
  '/fund-options',
  asyncHandler(async (req, res) => {
    const { id: customerId, clientId } = (req as CustomerRequest).customer;
    const [banks, nominees, titles, settings] = await Promise.all([
      pool.query(
        `SELECT id, bank_name, account_number
         FROM bank_accounts
         WHERE customer_id = $1 AND client_id = $2
         ORDER BY is_primary DESC, created_at ASC`,
        [customerId, clientId]
      ),
      pool.query(
        `SELECT id, nominee_name
         FROM nominees
         WHERE customer_id = $1 AND client_id = $2
         ORDER BY created_at ASC`,
        [customerId, clientId]
      ),
      pool.query(
        `SELECT name FROM investments WHERE customer_id = $1 AND client_id = $2`,
        [customerId, clientId]
      ),
      pool.query(
        `SELECT min_investment_amount, max_investment_amount, agreement_charges
         FROM client_settings
         WHERE client_id = $1`,
        [clientId]
      ),
    ]);

    const setting = settings.rows[0];
    res.json({
      banks: banks.rows.map((row) => ({
        id: row.id,
        label: bankLabel(row.bank_name, row.account_number),
      })),
      nominees: nominees.rows.map((row) => ({
        id: row.id,
        name: row.nominee_name,
      })),
      titles: titles.rows
        .map((row) => (typeof row.name === 'string' ? row.name : ''))
        .filter(Boolean),
      settings: {
        minInvestmentAmount: money(setting?.min_investment_amount ?? 100000),
        maxInvestmentAmount: money(setting?.max_investment_amount ?? 10000000),
        agreementCharges: money(setting?.agreement_charges ?? 1000),
      },
    });
  })
);

mobilePortalRouter.get(
  '/withdrawal-options',
  asyncHandler(async (req, res) => {
    const { id: customerId, clientId } = (req as CustomerRequest).customer;
    const [banks, funds, open] = await Promise.all([
      pool.query(
        `SELECT id, bank_name, account_number
         FROM bank_accounts
         WHERE customer_id = $1 AND client_id = $2
         ORDER BY is_primary DESC, created_at ASC`,
        [customerId, clientId]
      ),
      pool.query(
        `SELECT id, code, request_id, name, fund_amount, total_earnings, current_value
         FROM investments
         WHERE customer_id = $1 AND client_id = $2 AND status = 'Active'
         ORDER BY created_at DESC`,
        [customerId, clientId]
      ),
      pool.query(
        `SELECT investment_id, withdrawal_amount, strategy, status
         FROM withdrawals
         WHERE customer_id = $1 AND client_id = $2 AND status IN ('Processing', 'On Hold')`,
        [customerId, clientId]
      ),
    ]);

    const openByInvestment = new Map<
      string,
      { openPartialAmount: number; hasOpenFullWithdrawal: boolean }
    >();
    for (const row of open.rows) {
      const current = openByInvestment.get(row.investment_id) ?? {
        openPartialAmount: 0,
        hasOpenFullWithdrawal: false,
      };
      if (row.strategy === 'full') {
        current.hasOpenFullWithdrawal = true;
      } else {
        current.openPartialAmount += money(row.withdrawal_amount);
      }
      openByInvestment.set(row.investment_id, current);
    }

    res.json({
      banks: banks.rows.map((row) => ({
        id: row.id,
        label: bankLabel(row.bank_name, row.account_number),
      })),
      funds: funds.rows
        .map((row) => {
          const principal = money(row.fund_amount);
          const totalEarnings = money(row.total_earnings);
          const withdrawalAmount = money(row.current_value ?? principal + totalEarnings);
          const openState = openByInvestment.get(row.id) ?? {
            openPartialAmount: 0,
            hasOpenFullWithdrawal: false,
          };
          const displayCode = row.request_id || row.code;
          return {
            id: row.id,
            code: displayCode,
            name: row.name,
            label: `${displayCode} · ${row.name}`,
            principal,
            totalEarnings,
            withdrawalAmount,
            openPartialAmount: openState.openPartialAmount,
            hasOpenFullWithdrawal: openState.hasOpenFullWithdrawal,
            availablePrincipal: Math.max(0, principal - openState.openPartialAmount),
          };
        })
        .filter((row) => !row.hasOpenFullWithdrawal),
    });
  })
);

mobilePortalRouter.get(
  '/investments',
  asyncHandler(async (req, res) => {
    const { id: customerId, clientId } = (req as CustomerRequest).customer;
    const result = await pool.query(
      `SELECT
         id, code, request_id, name, status, fund_amount, current_value,
         interest_rate, tds_percent, total_earnings, tds_deducted_amount,
         invested_date, completed_interest_periods, created_at
       FROM investments
       WHERE customer_id = $1 AND client_id = $2
       ORDER BY created_at DESC`,
      [customerId, clientId]
    );
    res.json({ investments: result.rows.map((row) => mapInvestment(row)) });
  })
);

mobilePortalRouter.post(
  '/investments',
  asyncHandler(async (req, res) => {
    const { id: customerId, clientId } = (req as CustomerRequest).customer;
    if (!clientId) {
      res.status(403).json({ error: 'This account is not linked to a trader.' });
      return;
    }
    const bankAccountId = text(req.body?.bankAccountId);
    const nomineeId = text(req.body?.nomineeId);
    const fundTitle = text(req.body?.title ?? req.body?.fundTitle);
    const amount = money(req.body?.fundAmount ?? req.body?.amount);
    const payDate = text(req.body?.payDate);
    const referralCodeInput = text(req.body?.referralCode).toUpperCase();

    if (!fundTitle) {
      res.status(400).json({ error: 'Fund title is required.' });
      return;
    }
    if (!isUuid(bankAccountId)) {
      res.status(400).json({ error: 'Select a source bank account.' });
      return;
    }
    if (!isUuid(nomineeId)) {
      res.status(400).json({ error: 'Select a nominee.' });
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ error: 'Enter a valid fund amount.' });
      return;
    }

    const db = await pool.connect();
    try {
      await db.query('BEGIN');

      const customer = await db.query(
        `SELECT id, status, referred_by_customer_id, referral_code
         FROM customers
         WHERE id = $1 AND client_id = $2
         FOR UPDATE`,
        [customerId, clientId]
      );
      const customerRow = customer.rows[0];
      if (!customerRow || customerRow.status !== 'active') {
        await db.query('ROLLBACK');
        res.status(403).json({ error: 'This account cannot submit a fund request.' });
        return;
      }

      const bank = await db.query(
        `SELECT id FROM bank_accounts
         WHERE id = $1 AND customer_id = $2 AND client_id = $3`,
        [bankAccountId, customerId, clientId]
      );
      if ((bank.rowCount ?? 0) === 0) {
        await db.query('ROLLBACK');
        res.status(400).json({ error: 'Selected bank account does not belong to you.' });
        return;
      }

      const nominee = await db.query(
        `SELECT id FROM nominees
         WHERE id = $1 AND customer_id = $2 AND client_id = $3`,
        [nomineeId, customerId, clientId]
      );
      if ((nominee.rowCount ?? 0) === 0) {
        await db.query('ROLLBACK');
        res.status(400).json({ error: 'Selected nominee does not belong to you.' });
        return;
      }

      const settings = await db.query(
        `SELECT min_investment_amount, max_investment_amount, agreement_charges,
                default_interest_rate, default_tds_percent, default_payout_day
         FROM client_settings
         WHERE client_id = $1`,
        [clientId]
      );
      const setting = settings.rows[0];
      if (!setting) {
        await db.query('ROLLBACK');
        res.status(400).json({ error: 'Client settings are missing. Contact your trader.' });
        return;
      }

      const minAmount = money(setting.min_investment_amount);
      const maxAmount = money(setting.max_investment_amount);
      if (amount < minAmount || amount > maxAmount) {
        await db.query('ROLLBACK');
        res.status(400).json({
          error: `Investment amount must be between ${formatInr(minAmount)} and ${formatInr(maxAmount)}.`,
        });
        return;
      }

      const duplicate = await db.query(
        `SELECT 1
         FROM investments
         WHERE customer_id = $1
           AND client_id = $2
           AND lower(btrim(name)) = lower(btrim($3))
         LIMIT 1`,
        [customerId, clientId, fundTitle]
      );
      if ((duplicate.rowCount ?? 0) > 0) {
        await db.query('ROLLBACK');
        res.status(409).json({
          error: 'An investment with this title already exists. Please choose a different name.',
        });
        return;
      }

      let referrerCustomerId: string | null = null;
      let referralCode: string | null = null;
      if (referralCodeInput) {
        if (!/^[A-Z0-9]{8}$/.test(referralCodeInput)) {
          await db.query('ROLLBACK');
          res.status(400).json({ error: 'Customer referral code must be 8 letters or digits.' });
          return;
        }
        if (referralCodeInput === customerRow.referral_code) {
          await db.query('ROLLBACK');
          res.status(400).json({ error: 'You cannot use your own referral code.' });
          return;
        }
        const referrer = await db.query(
          `SELECT id, referral_code, full_name, status
           FROM customers
           WHERE client_id = $1 AND referral_code = $2
           LIMIT 1`,
          [clientId, referralCodeInput]
        );
        if (!referrer.rows[0] || referrer.rows[0].status !== 'active') {
          await db.query('ROLLBACK');
          res.status(400).json({ error: 'That referral code was not found for this trader.' });
          return;
        }
        if (referrer.rows[0].id === customerId) {
          await db.query('ROLLBACK');
          res.status(400).json({ error: 'You cannot use your own referral code.' });
          return;
        }
        referrerCustomerId = referrer.rows[0].id;
        referralCode = referrer.rows[0].referral_code;
        await db.query(
          `UPDATE customers
           SET referred_by_customer_id = COALESCE(referred_by_customer_id, $1),
               updated_at = NOW()
           WHERE id = $2 AND client_id = $3`,
          [referrerCustomerId, customerId, clientId]
        );
      }

      const payDateSql = /^\d{4}-\d{2}-\d{2}$/.test(payDate) ? '$13::date' : istTodaySql();
      const params: unknown[] = [
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
      ];
      if (payDateSql === '$13::date') {
        params.push(payDate);
      }

      const inserted = await db.query(
        `INSERT INTO investments (
           client_id, customer_id, name, status, fund_amount, current_value,
           interest_rate, tds_percent, bank_account_id, nominee_id, pay_date,
           agreement_charges, payout_day, referrer_customer_id, referral_code
         ) VALUES (
           $1, $2, $3, 'Pending', $4, $4,
           $5, $6, $7, $8, ${payDateSql},
           $9, $10, $11, $12
         )
         RETURNING id, code, request_id, name, status, fund_amount, current_value,
                   interest_rate, tds_percent, total_earnings, tds_deducted_amount,
                   invested_date, completed_interest_periods, created_at`,
        params
      );

      await db.query('COMMIT');
      res.status(201).json({ investment: mapInvestment(inserted.rows[0]) });
    } catch (error) {
      await db.query('ROLLBACK');
      const code = (error as { code?: string }).code;
      if (code === '23505') {
        res.status(409).json({
          error: 'An investment with this title already exists. Please choose a different name.',
        });
        return;
      }
      throw error;
    } finally {
      db.release();
    }
  })
);

mobilePortalRouter.get(
  '/investments/:id',
  asyncHandler(async (req, res) => {
    const { id: customerId, clientId } = (req as CustomerRequest).customer;
    const id = String(req.params.id ?? '');
    if (!isUuid(id)) {
      res.status(404).json({ error: 'Investment not found.' });
      return;
    }
    const result = await pool.query(
      `SELECT
         id, code, request_id, name, status, fund_amount, current_value,
         interest_rate, tds_percent, total_earnings, tds_deducted_amount,
         invested_date, completed_interest_periods, created_at
       FROM investments
       WHERE id = $1 AND customer_id = $2 AND client_id = $3
       LIMIT 1`,
      [id, customerId, clientId]
    );
    const row = result.rows[0];
    if (!row) {
      res.status(404).json({ error: 'Investment not found.' });
      return;
    }
    res.json({ investment: mapInvestment(row) });
  })
);

function resolveAgreementId(code: unknown, requestId: unknown, id: string) {
  const fromCode = String(code ?? '').match(/(\d+)\s*$/);
  if (fromCode?.[1]) return String(Number(fromCode[1]));
  const request = text(requestId);
  if (request) return request;
  return id.slice(0, 8).toUpperCase();
}

function formatDateLabel(value: unknown) {
  const [year, month, day] = String(value ?? '').slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return '—';
  return `${day}/${month}/${year}`;
}

function daysUntilIst(endDate: string) {
  const [year, month, day] = endDate.slice(0, 10).split('-').map(Number);
  const end = Date.UTC(year, (month || 1) - 1, day || 1);
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const today = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  return Math.ceil((end - today) / (24 * 60 * 60 * 1000));
}

mobilePortalRouter.get(
  '/agreements',
  asyncHandler(async (req, res) => {
    const { id: customerId, clientId } = (req as CustomerRequest).customer;
    const result = await pool.query(
      `SELECT
         i.id,
         i.code,
         i.request_id,
         i.fund_amount,
         i.invested_date,
         i.created_at,
         c.customer_code,
         COALESCE(a.period_from, i.invested_date, i.created_at::date) AS period_from,
         COALESCE(
           a.period_to,
           (COALESCE(i.invested_date, i.created_at::date) + 365)
         ) AS period_to
       FROM investments i
       JOIN customers c ON c.id = i.customer_id AND c.client_id = i.client_id
       LEFT JOIN LATERAL (
         SELECT period_from, period_to
         FROM investment_agreements ia
         WHERE ia.investment_id = i.id AND ia.client_id = i.client_id
         ORDER BY ia.agreement_date DESC, ia.created_at DESC
         LIMIT 1
       ) a ON TRUE
       WHERE i.customer_id = $1 AND i.client_id = $2 AND i.status = 'Active'
       ORDER BY COALESCE(i.invested_date, i.created_at::date) DESC`,
      [customerId, clientId]
    );

    res.json({
      agreements: result.rows.map((row) => {
        const periodTo = String(row.period_to).slice(0, 10);
        const days = daysUntilIst(periodTo);
        const isExpired = days < 0;
        const isActive = !isExpired;
        return {
          id: row.id,
          agreementId: resolveAgreementId(row.code, row.request_id, String(row.id)),
          customerId: String(row.customer_code ?? ''),
          fundAmount: money(row.fund_amount),
          startDate: String(row.period_from).slice(0, 10),
          endDate: periodTo,
          startDateLabel: formatDateLabel(row.period_from),
          endDateLabel: formatDateLabel(periodTo),
          daysUntilEnd: days,
          isActive,
          isExpired,
          showRenewalUpcoming: isActive && days <= 15,
          renewalInLabel: isExpired
            ? 'Expired'
            : days === 0
              ? 'Today'
              : `${days} Day${days === 1 ? '' : 's'}`,
        };
      }),
    });
  })
);

mobilePortalRouter.post(
  '/agreements/:investmentId/renewal',
  asyncHandler(async (req, res) => {
    const { id: customerId, clientId } = (req as CustomerRequest).customer;
    const investmentId = text(req.params.investmentId);
    const mode = text(req.body?.mode).toLowerCase();
    const incrementAmount = money(req.body?.incrementAmount ?? req.body?.increment_amount);

    if (!isUuid(investmentId)) {
      res.status(404).json({ error: 'Agreement not found for this investment.' });
      return;
    }
    if (mode !== 'same_amount' && mode !== 'increase') {
      res.status(400).json({ error: 'Choose same amount or increase investment.' });
      return;
    }

    const db = await pool.connect();
    try {
      await db.query('BEGIN');

      const investment = await db.query(
        `SELECT
           i.id,
           i.code,
           i.request_id,
           i.fund_amount,
           i.status,
           i.invested_date,
           i.created_at,
           c.customer_code,
           COALESCE(a.period_to, (COALESCE(i.invested_date, i.created_at::date) + 365)) AS period_to
         FROM investments i
         JOIN customers c ON c.id = i.customer_id AND c.client_id = i.client_id
         LEFT JOIN LATERAL (
           SELECT period_to
           FROM investment_agreements ia
           WHERE ia.investment_id = i.id AND ia.client_id = i.client_id
           ORDER BY ia.agreement_date DESC, ia.created_at DESC
           LIMIT 1
         ) a ON TRUE
         WHERE i.id = $1 AND i.customer_id = $2 AND i.client_id = $3
         FOR UPDATE OF i`,
        [investmentId, customerId, clientId]
      );
      const row = investment.rows[0];
      if (!row || row.status !== 'Active') {
        await db.query('ROLLBACK');
        res.status(404).json({ error: 'Agreement not found for this investment.' });
        return;
      }

      const pending = await db.query(
        `SELECT id FROM agreement_renewal_requests
         WHERE investment_id = $1 AND client_id = $2 AND status = 'Pending'
         LIMIT 1`,
        [investmentId, clientId]
      );
      if ((pending.rowCount ?? 0) > 0) {
        await db.query('ROLLBACK');
        res.status(409).json({ error: 'A renewal request is already pending for this agreement.' });
        return;
      }

      const days = daysUntilIst(String(row.period_to).slice(0, 10));
      const currentAmount = money(row.fund_amount);
      let increment: number | null = null;

      if (mode === 'increase') {
        if (!Number.isFinite(incrementAmount) || incrementAmount <= 0) {
          await db.query('ROLLBACK');
          res.status(400).json({ error: 'Enter a valid amount to add to your principal.' });
          return;
        }
        increment = incrementAmount;
        const settings = await db.query(
          `SELECT max_investment_amount FROM client_settings WHERE client_id = $1`,
          [clientId]
        );
        const maxAmount = money(settings.rows[0]?.max_investment_amount);
        if (maxAmount > 0 && currentAmount + increment > maxAmount) {
          await db.query('ROLLBACK');
          res.status(400).json({
            error: `New principal cannot exceed ${formatInr(maxAmount)}.`,
          });
          return;
        }
      } else if (days > 15) {
        await db.query('ROLLBACK');
        res.status(400).json({
          error:
            'Renew with same amount is only available when your agreement expires in 15 days or less.',
        });
        return;
      }

      const inserted = await db.query(
        `INSERT INTO agreement_renewal_requests (
           client_id, investment_id, customer_id, agreement_id,
           current_amount, increment_amount, mode, status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'Pending')
         RETURNING id, status, mode, current_amount, increment_amount, created_at`,
        [
          clientId,
          investmentId,
          customerId,
          resolveAgreementId(row.code, row.request_id, String(row.id)),
          currentAmount,
          increment,
          mode,
        ]
      );

      await db.query('COMMIT');
      const next = inserted.rows[0];
      res.status(201).json({
        ok: true,
        renewal: {
          id: next.id,
          status: next.status,
          mode: next.mode,
          currentAmount: money(next.current_amount),
          incrementAmount: next.increment_amount == null ? null : money(next.increment_amount),
          createdAt: next.created_at,
        },
      });
    } catch (error) {
      await db.query('ROLLBACK');
      if ((error as { code?: string }).code === '23505') {
        res.status(409).json({ error: 'A renewal request is already pending for this agreement.' });
        return;
      }
      throw error;
    } finally {
      db.release();
    }
  })
);

mobilePortalRouter.get(
  '/withdrawals',
  asyncHandler(async (req, res) => {
    const { id: customerId, clientId } = (req as CustomerRequest).customer;
    const result = await pool.query(
      `SELECT
         w.id, w.request_id, w.investment_id, w.status, w.strategy,
         w.withdrawal_amount, w.net_payout, w.requested_on, w.status_date,
         w.created_at, w.updated_at,
         i.code AS investment_code, i.name AS fund_name
       FROM withdrawals w
       JOIN investments i ON i.id = w.investment_id AND i.client_id = w.client_id
       WHERE w.customer_id = $1 AND w.client_id = $2
       ORDER BY w.created_at DESC`,
      [customerId, clientId]
    );
    res.json({ withdrawals: result.rows.map((row) => mapWithdrawal(row)) });
  })
);

mobilePortalRouter.post(
  '/withdrawals',
  asyncHandler(async (req, res) => {
    const { id: customerId, clientId } = (req as CustomerRequest).customer;
    const investmentId = text(req.body?.investmentId);
    const bankAccountId = text(req.body?.bankAccountId);
    const strategy = text(req.body?.strategy).toLowerCase() === 'partial' ? 'partial' : 'full';
    const amount = money(req.body?.withdrawalAmount ?? req.body?.amount);

    if (!isUuid(investmentId)) {
      res.status(400).json({ error: 'Select an active investment.' });
      return;
    }
    if (!isUuid(bankAccountId)) {
      res.status(400).json({ error: 'Select a payout bank account.' });
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ error: 'Enter a valid withdrawal amount.' });
      return;
    }

    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const fund = await db.query(
        `SELECT id, customer_id, fund_amount, current_value, total_earnings, status
         FROM investments
         WHERE id = $1 AND client_id = $2
         FOR UPDATE`,
        [investmentId, clientId]
      );
      const inv = fund.rows[0];
      if (!inv || inv.customer_id !== customerId || inv.status !== 'Active') {
        await db.query('ROLLBACK');
        res.status(400).json({ error: 'Active investment not found.' });
        return;
      }

      const bank = await db.query(
        `SELECT 1 FROM bank_accounts WHERE id = $1 AND customer_id = $2 AND client_id = $3`,
        [bankAccountId, customerId, clientId]
      );
      if ((bank.rowCount ?? 0) === 0) {
        await db.query('ROLLBACK');
        res.status(400).json({ error: 'Selected bank account does not belong to you.' });
        return;
      }

      const inserted = await db.query(
        `INSERT INTO withdrawals (
           client_id, customer_id, investment_id, bank_account_id,
           status, withdrawal_amount, strategy
         ) VALUES ($1,$2,$3,$4,'Processing',$5,$6)
         RETURNING id, request_id, investment_id, status, strategy,
                   withdrawal_amount, net_payout, requested_on, status_date, created_at`,
        [clientId, customerId, investmentId, bankAccountId, amount, strategy]
      );
      await db.query('COMMIT');

      const fundName = await pool.query(
        `SELECT code, name FROM investments WHERE id = $1 AND client_id = $2`,
        [investmentId, clientId]
      );
      const row = {
        ...inserted.rows[0],
        investment_code: fundName.rows[0]?.code,
        fund_name: fundName.rows[0]?.name,
      };
      res.status(201).json({ withdrawal: mapWithdrawal(row) });
    } catch (error) {
      await db.query('ROLLBACK');
      const message = pgMessage(error);
      if (
        message.includes('already has an open') ||
        message.includes('Minimum remaining') ||
        message.includes('Full withdrawal') ||
        message.includes('entire principal') ||
        message.includes('greater than zero') ||
        message.includes('Active investment')
      ) {
        res.status(400).json({ error: message });
        return;
      }
      throw error;
    } finally {
      db.release();
    }
  })
);

mobilePortalRouter.get(
  '/withdrawals/:id',
  asyncHandler(async (req, res) => {
    const { id: customerId, clientId } = (req as CustomerRequest).customer;
    const id = String(req.params.id ?? '');
    if (!isUuid(id)) {
      res.status(404).json({ error: 'Withdrawal not found.' });
      return;
    }
    const result = await pool.query(
      `SELECT
         w.id, w.request_id, w.investment_id, w.status, w.strategy,
         w.withdrawal_amount, w.net_payout, w.requested_on, w.status_date,
         w.created_at, w.updated_at,
         i.code AS investment_code, i.name AS fund_name
       FROM withdrawals w
       JOIN investments i ON i.id = w.investment_id AND i.client_id = w.client_id
       WHERE w.id = $1 AND w.customer_id = $2 AND w.client_id = $3
       LIMIT 1`,
      [id, customerId, clientId]
    );
    const row = result.rows[0];
    if (!row) {
      res.status(404).json({ error: 'Withdrawal not found.' });
      return;
    }
    res.json({ withdrawal: mapWithdrawal(row) });
  })
);

mobilePortalRouter.delete(
  '/withdrawals/:id',
  asyncHandler(async (req, res) => {
    const { id: customerId, clientId } = (req as CustomerRequest).customer;
    const id = String(req.params.id ?? '');
    if (!isUuid(id)) {
      res.status(404).json({ error: 'Withdrawal not found.' });
      return;
    }
    const result = await pool.query(
      `DELETE FROM withdrawals
       WHERE id = $1 AND customer_id = $2 AND client_id = $3 AND status = 'Processing'
       RETURNING id`,
      [id, customerId, clientId]
    );
    if ((result.rowCount ?? 0) === 0) {
      res.status(400).json({
        error:
          'This request can no longer be cancelled. It may already be approved or removed.',
      });
      return;
    }
    res.json({ ok: true });
  })
);

mobilePortalRouter.post(
  '/referrals/validate',
  asyncHandler(async (req, res) => {
    const { id: customerId, clientId, referralCode: ownCode } = (req as CustomerRequest).customer;
    const code = text(req.body?.code).toUpperCase();
    if (!code) {
      res.json({ valid: true });
      return;
    }
    if (!/^[A-Z0-9]{8}$/.test(code)) {
      res.status(400).json({
        valid: false,
        error: 'Customer referral code must be 8 letters or digits.',
      });
      return;
    }
    if (code === ownCode) {
      res.status(400).json({
        valid: false,
        error: 'You cannot use your own referral code.',
      });
      return;
    }
    const found = await pool.query(
      `SELECT id, full_name, status
       FROM customers
       WHERE client_id = $1 AND referral_code = $2 AND id <> $3
       LIMIT 1`,
      [clientId, code, customerId]
    );
    if (!found.rows[0] || found.rows[0].status !== 'active') {
      res.status(400).json({
        valid: false,
        error: 'Please enter a valid referral code or leave it blank.',
      });
      return;
    }
    res.json({ valid: true, referrerName: found.rows[0].full_name });
  })
);

mobilePortalRouter.get(
  '/profile',
  asyncHandler(async (req, res) => {
    const { id: customerId, clientId } = (req as CustomerRequest).customer;
    const [customer, kyc] = await Promise.all([
      pool.query(
        `SELECT full_name, mobile_number, email_address, date_of_birth, customer_code
         FROM customers
         WHERE id = $1 AND client_id = $2
         LIMIT 1`,
        [customerId, clientId]
      ),
      pool.query(
        `SELECT pan_number
         FROM kyc_documents
         WHERE customer_id = $1 AND client_id = $2
         LIMIT 1`,
        [customerId, clientId]
      ),
    ]);
    const row = customer.rows[0];
    if (!row) {
      res.status(404).json({ error: 'Profile not found.' });
      return;
    }
    const panNumber = text(kyc.rows[0]?.pan_number) || null;
    res.json({
      profile: {
        fullName: row.full_name,
        mobileNumber: row.mobile_number,
        emailAddress: row.email_address,
        dateOfBirth: toDateOnly(row.date_of_birth),
        panNumber,
        customerId: row.customer_code,
        verified: Boolean(panNumber),
      },
    });
  })
);

mobilePortalRouter.get(
  '/banks',
  asyncHandler(async (req, res) => {
    const { id: customerId, clientId } = (req as CustomerRequest).customer;
    const result = await pool.query(
      `SELECT id, bank_name, account_number, ifsc_code, account_type, is_primary
       FROM bank_accounts
       WHERE customer_id = $1 AND client_id = $2
       ORDER BY is_primary DESC, created_at ASC`,
      [customerId, clientId]
    );
    res.json({
      banks: result.rows.map((row) => ({
        id: row.id,
        bankName: row.bank_name,
        accountNumber: row.account_number,
        ifscCode: row.ifsc_code,
        accountType: row.account_type === 'Current' ? 'Current' : 'Savings',
        isPrimary: Boolean(row.is_primary),
      })),
    });
  })
);

mobilePortalRouter.post(
  '/banks',
  asyncHandler(async (req, res) => {
    const { id: customerId, clientId } = (req as CustomerRequest).customer;
    const accountHolderName = text(req.body?.accountHolderName);
    const accountNumber = String(req.body?.accountNumber ?? '').replace(/\D/g, '');
    const ifscCode = text(req.body?.ifscCode).toUpperCase();
    const accountType = text(req.body?.accountType);
    const bankName =
      text(req.body?.bankName) ||
      (ifscCode.slice(0, 4) ? `${ifscCode.slice(0, 4)} Bank` : 'Bank Account');

    if (!accountHolderName) {
      res.status(400).json({ error: 'Account holder name is required.' });
      return;
    }
    if (!/^\d{9,18}$/.test(accountNumber)) {
      res.status(400).json({ error: 'Enter a valid bank account number.' });
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

    const existing = await pool.query(
      `SELECT 1
       FROM bank_accounts
       WHERE customer_id = $1 AND client_id = $2 AND account_number = $3
       LIMIT 1`,
      [customerId, clientId, accountNumber]
    );
    if ((existing.rowCount ?? 0) > 0) {
      res.status(409).json({ error: 'That bank account is already saved.' });
      return;
    }

    const count = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM bank_accounts
       WHERE customer_id = $1 AND client_id = $2`,
      [customerId, clientId]
    );
    const isPrimary = Number(count.rows[0]?.total ?? 0) === 0;

    const inserted = await pool.query(
      `INSERT INTO bank_accounts (
         client_id, customer_id, account_holder_name, account_number,
         ifsc_code, bank_name, account_type, is_primary
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, bank_name, account_number, ifsc_code, account_type, is_primary`,
      [
        clientId,
        customerId,
        accountHolderName,
        accountNumber,
        ifscCode,
        bankName,
        accountType,
        isPrimary,
      ]
    );
    const row = inserted.rows[0];
    res.status(201).json({
      bank: {
        id: row.id,
        bankName: row.bank_name,
        accountNumber: row.account_number,
        ifscCode: row.ifsc_code,
        accountType: row.account_type === 'Current' ? 'Current' : 'Savings',
        isPrimary: Boolean(row.is_primary),
      },
    });
  })
);

mobilePortalRouter.get(
  '/nominees',
  asyncHandler(async (req, res) => {
    const { id: customerId, clientId } = (req as CustomerRequest).customer;
    const result = await pool.query(
      `SELECT id, nominee_name, relationship, nominee_aadhaar
       FROM nominees
       WHERE customer_id = $1 AND client_id = $2
       ORDER BY created_at ASC`,
      [customerId, clientId]
    );
    res.json({
      nominees: result.rows.map((row) => ({
        id: row.id,
        nomineeName: row.nominee_name,
        name: row.nominee_name,
        relationship: row.relationship,
        nomineeAadhaar: row.nominee_aadhaar ?? '',
      })),
    });
  })
);

mobilePortalRouter.post(
  '/nominees',
  asyncHandler(async (req, res) => {
    const { id: customerId, clientId } = (req as CustomerRequest).customer;
    const nomineeName = text(req.body?.nomineeName);
    const relationship = text(req.body?.relationship);
    const nomineeAadhaar = text(req.body?.nomineeAadhaar).replace(/\D/g, '');
    if (!nomineeName || !relationship || !/^\d{12}$/.test(nomineeAadhaar)) {
      res.status(400).json({
        error: 'Enter nominee name, relationship, and 12-digit Aadhaar.',
      });
      return;
    }
    const inserted = await pool.query(
      `INSERT INTO nominees (
         client_id, customer_id, nominee_name, relationship, nominee_aadhaar
       ) VALUES ($1,$2,$3,$4,$5)
       RETURNING id, nominee_name, relationship, nominee_aadhaar`,
      [clientId, customerId, nomineeName, relationship, nomineeAadhaar]
    );
    const row = inserted.rows[0];
    res.status(201).json({
      nominee: {
        id: row.id,
        nomineeName: row.nominee_name,
        name: row.nominee_name,
        relationship: row.relationship,
        nomineeAadhaar: row.nominee_aadhaar ?? '',
      },
    });
  })
);

mobilePortalRouter.get(
  '/referrals',
  asyncHandler(async (req, res) => {
    const { id: customerId, clientId, referralCode } = (req as CustomerRequest).customer;
    const [settings, rewards] = await Promise.all([
      pool.query(
        `SELECT referral_rate, referral_tds_rate
         FROM client_settings
         WHERE client_id = $1`,
        [clientId]
      ),
      pool.query(
        `SELECT
           r.id, r.capital_amount, r.net_bonus, r.referral_code, r.created_at, r.status,
           c.full_name AS referred_name,
           i.code AS investment_code
         FROM referral_rewards r
         JOIN customers c ON c.id = r.referred_customer_id AND c.client_id = r.client_id
         JOIN investments i ON i.id = r.investment_id AND i.client_id = r.client_id
         WHERE r.referrer_customer_id = $1 AND r.client_id = $2
         ORDER BY r.created_at DESC`,
        [customerId, clientId]
      ),
    ]);

    const paid = rewards.rows.filter((row) => row.status === 'Paid');
    const pending = rewards.rows.filter((row) => row.status !== 'Paid');
    res.json({
      referralCode,
      referralRate: Number(settings.rows[0]?.referral_rate ?? 0.01),
      tdsRate: Number(settings.rows[0]?.referral_tds_rate ?? 0.02),
      totalReferrals: rewards.rows.length,
      totalEarnings: paid.reduce((sum, row) => sum + money(row.net_bonus), 0),
      pendingEarnings: pending.reduce((sum, row) => sum + money(row.net_bonus), 0),
      history: rewards.rows.map((row) => ({
        id: row.id,
        referredName: row.referred_name,
        investmentCode: row.investment_code,
        capitalAmount: money(row.capital_amount),
        netBonus: money(row.net_bonus),
        referralCode: row.referral_code,
        createdAt: row.created_at,
      })),
    });
  })
);

mobilePortalRouter.get(
  '/transactions',
  asyncHandler(async (req, res) => {
    const { id: customerId, clientId } = (req as CustomerRequest).customer;
    const result = await pool.query(
      `SELECT
         id, transaction_code, transaction_type, amount,
         investment_plan_id, reference_id, transaction_date
       FROM transactions
       WHERE customer_id = $1 AND client_id = $2
       ORDER BY transaction_date DESC, created_at DESC
       LIMIT 200`,
      [customerId, clientId]
    );
    res.json({
      transactions: result.rows.map((row) => ({
        id: row.id,
        transactionCode: row.transaction_code,
        transactionType: row.transaction_type,
        amount: money(row.amount),
        investmentPlanId: row.investment_plan_id,
        referenceId: row.reference_id ?? null,
        transactionDate: toDateOnly(row.transaction_date),
      })),
    });
  })
);

function mapNotification(row: Record<string, unknown>) {
  return {
    id: row.id,
    kind: row.kind === 'withdrawal'
      ? 'withdrawal'
      : row.kind === 'agreement_renewal'
        ? 'agreement_renewal'
        : 'investment',
    title: row.title,
    body: row.body,
    decision: row.decision === 'rejected' ? 'rejected' : 'approved',
    referenceId: row.reference_id ?? null,
    isRead: Boolean(row.is_read),
    createdAt: row.created_at,
  };
}

mobilePortalRouter.get(
  '/notifications',
  asyncHandler(async (req, res) => {
    const { id: customerId, clientId } = (req as CustomerRequest).customer;
    const after = text(req.query.after);
    const params: unknown[] = [customerId, clientId];
    let afterSql = '';
    if (after) {
      params.push(after);
      afterSql = ` AND created_at > $${params.length}::timestamptz`;
    }
    const result = await pool.query(
      `SELECT id, kind, title, body, decision, reference_id, is_read, created_at
       FROM customer_notifications
       WHERE customer_id = $1 AND client_id = $2${afterSql}
       ORDER BY created_at DESC
       LIMIT 200`,
      params
    );
    res.json({ notifications: result.rows.map(mapNotification) });
  })
);

mobilePortalRouter.get(
  '/notifications/unread-count',
  asyncHandler(async (req, res) => {
    const { id: customerId, clientId } = (req as CustomerRequest).customer;
    const result = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM customer_notifications
       WHERE customer_id = $1 AND client_id = $2 AND is_read = FALSE`,
      [customerId, clientId]
    );
    res.json({ unreadCount: Number(result.rows[0]?.total ?? 0) });
  })
);

mobilePortalRouter.post(
  '/notifications/read-all',
  asyncHandler(async (req, res) => {
    const { id: customerId, clientId } = (req as CustomerRequest).customer;
    await pool.query(
      `UPDATE customer_notifications
       SET is_read = TRUE
       WHERE customer_id = $1 AND client_id = $2 AND is_read = FALSE`,
      [customerId, clientId]
    );
    res.json({ ok: true });
  })
);

mobilePortalRouter.post(
  '/notifications/:id/read',
  asyncHandler(async (req, res) => {
    const { id: customerId, clientId } = (req as CustomerRequest).customer;
    const id = text(req.params.id);
    if (!isUuid(id)) {
      res.status(404).json({ error: 'Notification not found.' });
      return;
    }
    const updated = await pool.query(
      `UPDATE customer_notifications
       SET is_read = TRUE
       WHERE id = $1 AND customer_id = $2 AND client_id = $3
       RETURNING id`,
      [id, customerId, clientId]
    );
    if ((updated.rowCount ?? 0) === 0) {
      res.status(404).json({ error: 'Notification not found.' });
      return;
    }
    res.json({ ok: true });
  })
);
