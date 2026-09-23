import { pool } from './db.ts';
import { money } from './util.ts';

export function toDateOnly(value: unknown) {
  const raw = String(value ?? '');
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    return raw.slice(0, 10);
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  }
  return raw;
}

export function mapCustomer(row: Record<string, unknown>) {
  return {
    id: row.id,
    customerCode: row.customer_code,
    fullName: row.full_name,
    mobileNumber: row.mobile_number,
    emailAddress: row.email_address,
    dateOfBirth: toDateOnly(row.date_of_birth),
    address: row.address,
    city: row.city,
    state: row.state,
    pinCode: row.pin_code,
    status: row.status,
    referralCode: row.referral_code,
    createdAt: row.created_at,
  };
}

export async function loadCustomerDetails(customerId: string, clientId: string) {
  const customer = await pool.query(
    `SELECT
       c.id, c.customer_code, c.full_name, c.mobile_number, c.email_address,
       c.date_of_birth, c.address, c.city, c.state, c.pin_code, c.status,
       c.referral_code, c.created_at, k.pan_number, k.aadhaar_number
     FROM customers c
     LEFT JOIN kyc_documents k ON k.customer_id = c.id AND k.client_id = c.client_id
     WHERE c.id = $1 AND c.client_id = $2
     LIMIT 1`,
    [customerId, clientId]
  );
  const row = customer.rows[0];
  if (!row) {
    return null;
  }

  const [banks, nominees, summary, investments, withdrawals, transactions] = await Promise.all([
    pool.query(
      `SELECT id, account_holder_name, account_number, ifsc_code, bank_name, account_type, is_primary
       FROM bank_accounts
       WHERE customer_id = $1 AND client_id = $2
       ORDER BY is_primary DESC, created_at ASC`,
      [customerId, clientId]
    ),
    pool.query(
      `SELECT id, nominee_name, relationship, nominee_aadhaar, nominee_pan, nominee_mobile
       FROM nominees
       WHERE customer_id = $1 AND client_id = $2
       ORDER BY created_at ASC`,
      [customerId, clientId]
    ),
    pool.query(
      `SELECT
         COALESCE(SUM(fund_amount) FILTER (WHERE status = 'Active'), 0) AS total_invested,
         COUNT(*) FILTER (WHERE status = 'Active')::int AS active_plans,
         COALESCE(SUM(total_earnings), 0) AS returns_earned
       FROM investments
       WHERE customer_id = $1 AND client_id = $2`,
      [customerId, clientId]
    ),
    pool.query(
      `SELECT id, code, request_id, name, fund_amount, status, invested_date, created_at,
              total_earnings, bank_account_id
       FROM investments
       WHERE customer_id = $1 AND client_id = $2
       ORDER BY created_at DESC`,
      [customerId, clientId]
    ),
    pool.query(
      `SELECT
         w.id, w.status, w.strategy, w.withdrawal_amount, w.net_payout, w.requested_on,
         i.code AS investment_code
       FROM withdrawals w
       JOIN investments i ON i.id = w.investment_id AND i.client_id = w.client_id
       WHERE w.customer_id = $1 AND w.client_id = $2
       ORDER BY w.requested_on DESC, w.created_at DESC`,
      [customerId, clientId]
    ),
    pool.query(
      `SELECT id, transaction_code, transaction_type, amount, transaction_date, investment_plan_id
       FROM transactions
       WHERE customer_id = $1 AND client_id = $2
       ORDER BY transaction_date DESC, created_at DESC
       LIMIT 50`,
      [customerId, clientId]
    ),
  ]);

  return {
    customer: {
      ...mapCustomer(row),
      panNumber: row.pan_number ? String(row.pan_number) : null,
      aadhaarNumber: row.aadhaar_number ? String(row.aadhaar_number) : null,
    },
    banks: banks.rows.map((bank) => ({
      id: bank.id,
      accountHolderName: bank.account_holder_name,
      accountNumber: bank.account_number,
      ifscCode: bank.ifsc_code,
      bankName: bank.bank_name,
      accountType: bank.account_type,
      isPrimary: bank.is_primary,
    })),
    nominees: nominees.rows.map((nominee) => ({
      id: nominee.id,
      nomineeName: nominee.nominee_name,
      relationship: nominee.relationship,
      nomineeAadhaar: nominee.nominee_aadhaar,
      nomineePan: nominee.nominee_pan,
      nomineeMobile: nominee.nominee_mobile,
    })),
    summary: {
      totalInvested: money(summary.rows[0]?.total_invested),
      activePlans: Number(summary.rows[0]?.active_plans ?? 0),
      returnsEarned: money(summary.rows[0]?.returns_earned),
    },
    investments: investments.rows.map((item) => ({
      id: item.id,
      code: item.code,
      requestId: item.request_id,
      name: item.name,
      fundAmount: money(item.fund_amount),
      status: item.status,
      investedDate: toDateOnly(item.invested_date) || null,
      createdAt: item.created_at,
      totalEarnings: money(item.total_earnings),
      bankAccountId: item.bank_account_id ? String(item.bank_account_id) : null,
    })),
    withdrawals: withdrawals.rows.map((item) => ({
      id: item.id,
      status: item.status,
      strategy: item.strategy,
      withdrawalAmount: money(item.withdrawal_amount),
      netPayout: money(item.net_payout),
      investmentCode: item.investment_code,
      requestedOn: toDateOnly(item.requested_on),
    })),
    transactions: transactions.rows.map((item) => ({
      id: item.id,
      transactionCode: item.transaction_code,
      transactionType: item.transaction_type,
      amount: money(item.amount),
      transactionDate: toDateOnly(item.transaction_date),
      investmentPlanId: item.investment_plan_id,
    })),
  };
}
