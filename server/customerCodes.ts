import crypto from 'node:crypto';
import { pool } from './db';

const REFERRAL_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export function randomReferralCode() {
  let code = '';
  for (let i = 0; i < 8; i += 1) {
    code += REFERRAL_CHARS[crypto.randomInt(0, REFERRAL_CHARS.length)];
  }
  return code;
}

export async function uniqueReferralCode() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = randomReferralCode();
    const existing = await pool.query(
      'SELECT 1 FROM customers WHERE referral_code = $1 LIMIT 1',
      [code]
    );
    if ((existing.rowCount ?? 0) === 0) {
      return code;
    }
  }
  throw new Error('Could not generate a unique referral code.');
}

export function normalizeMobile(value: unknown) {
  return String(value ?? '').replace(/\D/g, '').slice(-10);
}

export function normalizeEmail(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}
