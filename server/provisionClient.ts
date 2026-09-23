import { hashPassword } from './auth.ts';
import { pool } from './db.ts';
import {
  parseAgreementParty,
  validateAgreementParty,
} from './agreementParty.ts';

const PAYOUT_DAYS = new Set([1, 5, 10, 15, 20, 25]);

export type ProvisionClientBody = {
  name?: unknown;
  clientCode?: unknown;
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

export async function provisionClient(
  body: ProvisionClientBody,
  options: { createdBy: string | null; forceStatus?: 'active' | 'inactive' }
): Promise<ProvisionClientResult> {
  const name = text(body.name);
  const clientCode = text(body.clientCode).toUpperCase();
  const status = (options.forceStatus ?? text(body.status || 'active').toLowerCase()) as string;
  const adminFullName = text(body.adminFullName);
  const adminUsername = text(body.adminUsername).toLowerCase();
  const adminPassword = String(body.adminPassword ?? '');
  const supportEmail = text(body.supportEmail) || null;
  const supportPhoneDigits = text(body.supportPhone).replace(/\D/g, '');
  const supportPhone = supportPhoneDigits || null;
  const minInvestmentAmount = money(body.minInvestmentAmount);
  const maxInvestmentAmount = money(body.maxInvestmentAmount);
  const agreementCharges = money(body.agreementCharges ?? 1000);
  const defaultInterestRate = percentToRate(body.interestRatePercent, 0.05);
  const defaultTdsPercent = percentToRate(body.tdsPercent, 0.1);
  const referralRate = percentToRate(body.referralRatePercent, 0.01);
  const referralTdsRate = percentToRate(body.referralTdsPercent, 0.02);
  const payoutDay = Number(body.payoutDay ?? 10);
  const party = parseAgreementParty(body as Record<string, unknown>);

  if (!name) {
    return { ok: false, status: 400, error: 'Client name is required.' };
  }
  if (!/^[A-Z0-9]{3,20}$/.test(clientCode)) {
    return { ok: false, status: 400, error: 'Client code must be 3–20 letters or numbers.' };
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
  if (!(minInvestmentAmount > 0) || !(maxInvestmentAmount >= minInvestmentAmount)) {
    return { ok: false, status: 400, error: 'Enter a valid min and max investment. Max must be ≥ min.' };
  }
  if (!(agreementCharges >= 0) || Number.isNaN(agreementCharges)) {
    return { ok: false, status: 400, error: 'Enter a valid agreement charge.' };
  }
  if (
    Number.isNaN(defaultInterestRate) ||
    Number.isNaN(defaultTdsPercent) ||
    Number.isNaN(referralRate) ||
    Number.isNaN(referralTdsRate)
  ) {
    return { ok: false, status: 400, error: 'Rates must be percentages between 0 and 100.' };
  }
  if (!PAYOUT_DAYS.has(payoutDay)) {
    return { ok: false, status: 400, error: 'Payout day must be 1, 5, 10, 15, 20, or 25.' };
  }
  const partyError = validateAgreementParty(party);
  if (partyError) {
    return { ok: false, status: 400, error: partyError };
  }

  const passwordHash = await hashPassword(adminPassword);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const created = await client.query(
      `INSERT INTO clients (name, client_code, status, support_email, support_phone, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [name, clientCode, status, supportEmail, supportPhone, options.createdBy]
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
