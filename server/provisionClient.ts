import { hashPassword } from './auth';
import { pool } from './db';
import {
  parseAgreementParty,
  validateAgreementParty,
} from './agreementParty';

const PAYOUT_DAYS = new Set([1, 5, 10, 15, 20, 25]);

export type ProvisionClientBody = {
  name?: unknown;
  clientCode?: unknown;
  enabledModules?: unknown;
  loanProduct?: unknown;
  status?: unknown;
  adminFullName?: unknown;
  adminUsername?: unknown;
  adminPassword?: unknown;
  supportEmail?: unknown;
  supportPhone?: unknown;
  minInvestmentAmount?: unknown;
  maxInvestmentAmount?: unknown;
  agreementCharges?: unknown;
  interestRatePercent?: unknown;
  tdsPercent?: unknown;
  payoutDay?: unknown;
  referralRatePercent?: unknown;
  referralTdsPercent?: unknown;
};

export type ProvisionClientResult =
  | { ok: true; clientId: string }
  | { ok: false; status: number; error: string };

function text(value: unknown) {
  return String(value ?? '').trim();
}

function money(value: unknown) {
  const n = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

function percentToRate(value: unknown, fallback: number) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    return NaN;
  }
  return Number((n / 100).toFixed(6));
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function enumValue(value: unknown, allowed: string[]) {
  const next = text(value);
  return allowed.includes(next) ? next : '';
}

export async function provisionClient(
  body: ProvisionClientBody,
  options: { createdBy: string | null; forceStatus?: 'active' | 'inactive' }
): Promise<ProvisionClientResult> {
  const name = text(body.name);
  const clientCode = text(body.clientCode).toUpperCase();
  const modules = Array.isArray(body.enabledModules)
    ? [...new Set(body.enabledModules.map((item) => text(item)))]
    : ['invest'];
  const hasInvest = modules.includes('invest');
  const hasBorrow = modules.includes('borrow');
  const status = (options.forceStatus ?? text(body.status || 'active').toLowerCase()) as string;
  const adminFullName = text(body.adminFullName);
  const adminUsername = text(body.adminUsername).toLowerCase();
  const adminPassword = String(body.adminPassword ?? '');
  const supportEmail = text(body.supportEmail) || null;
  const supportPhoneDigits = text(body.supportPhone).replace(/\D/g, '');
  const supportPhone = supportPhoneDigits || null;
  const minInvestmentAmount = hasInvest ? money(body.minInvestmentAmount) : 1;
  const maxInvestmentAmount = hasInvest ? money(body.maxInvestmentAmount) : 1;
  const agreementCharges = hasInvest ? money(body.agreementCharges ?? 1000) : 0;
  const defaultInterestRate = percentToRate(body.interestRatePercent, 0.05);
  const defaultTdsPercent = percentToRate(body.tdsPercent, 0.1);
  const referralRate = percentToRate(body.referralRatePercent, 0.01);
  const referralTdsRate = percentToRate(body.referralTdsPercent, 0.02);
  const payoutDay = hasInvest ? Number(body.payoutDay ?? 10) : 10;
  const party = parseAgreementParty(body as Record<string, unknown>);
  const loan = objectValue(body.loanProduct);
  const loanName = text(loan.name);
  const interestModel = enumValue(loan.interestModel, ['simple', 'flat', 'reducing_balance']);
  const interestRatePercent = Number(loan.interestRatePercent);
  const interestRatePeriod = enumValue(loan.interestRatePeriod, ['daily', 'weekly', 'monthly', 'annual']);
  const interestFrequency = enumValue(loan.interestFrequency, ['daily', 'weekly', 'monthly', 'quarterly', 'at_maturity']);
  const repaymentModel = enumValue(loan.repaymentModel, ['interest_only', 'principal_and_interest', 'bullet']);
  const repaymentFrequency = enumValue(loan.repaymentFrequency, ['weekly', 'monthly', 'quarterly', 'at_maturity']);
  const paymentAllocation = enumValue(loan.paymentAllocation, ['interest_first', 'principal_first']);
  const gracePeriodDays = Number(loan.gracePeriodDays);
  const overdueRule = enumValue(loan.overdueRule, ['status_only', 'percentage_charge', 'fixed_charge']);
  const overdueCharge = Number(loan.overdueCharge);
  const advancePaymentTreatment = enumValue(loan.advancePaymentTreatment, ['reduce_principal', 'cover_future_dues', 'credit_balance']);
  const approvalWorkflow = enumValue(loan.approvalWorkflow, ['manual', 'direct_activation']);
  const closureMode = enumValue(loan.closureMode, ['automatic', 'manual']);
  const roundingScale = Number(loan.roundingScale);
  const allowedDocuments = ['aadhaar', 'pan', 'address_proof', 'income_proof', 'bank_statement'];
  const requiredDocuments = Array.isArray(loan.requiredDocuments)
    ? [...new Set(loan.requiredDocuments.map((item) => text(item)))]
    : [];

  if (!name) {
    return { ok: false, status: 400, error: 'Client name is required.' };
  }
  if (!/^[A-Z0-9]{3,20}$/.test(clientCode)) {
    return { ok: false, status: 400, error: 'Client code must be 3–20 letters or numbers.' };
  }
  if (modules.length === 0 || modules.some((item) => item !== 'invest' && item !== 'borrow')) {
    return { ok: false, status: 400, error: 'Select Invest, Borrow, or both modules.' };
  }
  if (status !== 'active' && status !== 'inactive') {
    return { ok: false, status: 400, error: 'Status must be active or inactive.' };
  }
  if (!adminFullName) {
    return { ok: false, status: 400, error: 'Client Admin name is required.' };
  }
  if (!/^[a-z0-9._-]{3,40}$/.test(adminUsername)) {
    return {
      ok: false,
      status: 400,
      error: 'Admin username must be 3–40 characters (letters, numbers, . _ -).',
    };
  }
  if (adminPassword.length < 8) {
    return { ok: false, status: 400, error: 'Admin password must be at least 8 characters.' };
  }
  if (supportEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail)) {
    return { ok: false, status: 400, error: 'Enter a valid support email.' };
  }
  if (supportPhone && !/^[6-9]\d{9}$/.test(supportPhone.replace(/\D/g, ''))) {
    return { ok: false, status: 400, error: 'Support phone must be a 10-digit Indian mobile number.' };
  }
  if (hasInvest && (!(minInvestmentAmount > 0) || !(maxInvestmentAmount >= minInvestmentAmount))) {
    return { ok: false, status: 400, error: 'Enter a valid min and max investment. Max must be ≥ min.' };
  }
  if (hasInvest && (!(agreementCharges >= 0) || Number.isNaN(agreementCharges))) {
    return { ok: false, status: 400, error: 'Enter a valid agreement charge.' };
  }
  if (hasInvest && (
    Number.isNaN(defaultInterestRate) ||
    Number.isNaN(defaultTdsPercent) ||
    Number.isNaN(referralRate) ||
    Number.isNaN(referralTdsRate)
  )) {
    return { ok: false, status: 400, error: 'Rates must be percentages between 0 and 100.' };
  }
  if (hasInvest && !PAYOUT_DAYS.has(payoutDay)) {
    return { ok: false, status: 400, error: 'Payout day must be 1, 5, 10, 15, 20, or 25.' };
  }
  const partyError = hasInvest ? validateAgreementParty(party) : null;
  if (partyError) {
    return { ok: false, status: 400, error: partyError };
  }
  if (hasBorrow) {
    const booleansAreSet = ['partPaymentsAllowed', 'receiptRequired', 'writeOffAllowed']
      .every((key) => typeof loan[key] === 'boolean');
    if (
      !loanName || !interestModel || !Number.isFinite(interestRatePercent) || interestRatePercent < 0 || interestRatePercent > 100 ||
      !interestRatePeriod || !interestFrequency || !repaymentModel || !repaymentFrequency || !paymentAllocation ||
      !Number.isInteger(gracePeriodDays) || gracePeriodDays < 0 || !overdueRule ||
      !Number.isFinite(overdueCharge) || overdueCharge < 0 || !booleansAreSet ||
      !advancePaymentTreatment || !approvalWorkflow || !closureMode || !Number.isInteger(roundingScale) ||
      roundingScale < 0 || roundingScale > 4 || requiredDocuments.length === 0 ||
      requiredDocuments.some((document) => !allowedDocuments.includes(document))
    ) {
      return { ok: false, status: 400, error: 'Complete all borrowing product and policy settings.' };
    }
    if (overdueRule === 'status_only' && overdueCharge !== 0) {
      return { ok: false, status: 400, error: 'Set overdue charge to 0 when overdue treatment is status only.' };
    }
  }

  const passwordHash = await hashPassword(adminPassword);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const created = await client.query(
      `INSERT INTO clients (name, client_code, status, support_email, support_phone, created_by, enabled_modules)
       VALUES ($1, $2, $3, $4, $5, $6, $7::text[])
       RETURNING id`,
      [name, clientCode, status, supportEmail, supportPhone, options.createdBy, modules]
    );
    const clientId = created.rows[0].id as string;

    await client.query(
      `INSERT INTO client_settings (
         client_id, min_investment_amount, max_investment_amount, agreement_charges,
         default_interest_rate, default_tds_percent, default_payout_day,
         referral_rate, referral_tds_rate,
         second_party_name, agreement_offices, second_party_nominee_name, second_party_nominee_aadhaar,
         second_party_nominee_pan, second_party_nominee_relation, second_party_nominee_phone
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16)`,
      [
        clientId,
        minInvestmentAmount,
        maxInvestmentAmount,
        agreementCharges,
        defaultInterestRate,
        defaultTdsPercent,
        payoutDay,
        referralRate,
        referralTdsRate,
        party.name,
        JSON.stringify(party.offices),
        party.nomineeName,
        party.nomineeAadhaar,
        party.nomineePan,
        party.nomineeRelation,
        party.nomineePhone,
      ]
    );

    if (hasBorrow) {
      await client.query(
        `INSERT INTO loan_products (
           client_id, name, interest_model, interest_rate_percent, interest_rate_period,
           interest_frequency, repayment_model, repayment_frequency, payment_allocation,
           grace_period_days, overdue_rule, overdue_charge, part_payments_allowed,
           advance_payment_treatment, approval_workflow, receipt_required, write_off_allowed,
           closure_mode, rounding_scale, required_documents
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::text[])`,
        [
          clientId, loanName, interestModel, interestRatePercent, interestRatePeriod,
          interestFrequency, repaymentModel, repaymentFrequency, paymentAllocation,
          gracePeriodDays, overdueRule, overdueCharge, loan.partPaymentsAllowed,
          advancePaymentTreatment, approvalWorkflow, loan.receiptRequired, loan.writeOffAllowed,
          closureMode, roundingScale, requiredDocuments,
        ]
      );
    }

    await client.query(
      `INSERT INTO users (username, password_hash, role, client_id, full_name, is_active)
       VALUES ($1, $2, 'client_admin', $3, $4, TRUE)`,
      [adminUsername, passwordHash, clientId, adminFullName]
    );

    await client.query('COMMIT');
    return { ok: true, clientId };
  } catch (error) {
    await client.query('ROLLBACK');
    const code = (error as { code?: string }).code;
    const message = String((error as { message?: string }).message ?? '');
    if (code === '23505' && message.includes('clients_code_lower_idx')) {
      return { ok: false, status: 409, error: 'That client code is already in use.' };
    }
    if (code === '23505' && message.includes('users_username_lower_idx')) {
      return { ok: false, status: 409, error: 'That admin username is already in use.' };
    }
    throw error;
  } finally {
    client.release();
  }
}
