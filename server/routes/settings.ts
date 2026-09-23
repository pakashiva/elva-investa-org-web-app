import { Router } from 'express';
import {
  AGREEMENT_PARTY_COLUMNS,
  mapAgreementParty,
  parseAgreementParty,
  validateAgreementParty,
} from '../agreementParty.ts';
import { pool } from '../db.ts';
import { asyncHandler } from '../middleware.ts';
import type { AuthedRequest } from '../types.ts';
import { text } from '../util.ts';

export const settingsRouter = Router();

function mapSettings(row: Record<string, unknown>) {
  return {
    clientName: row.name,
    clientCode: row.client_code,
    supportEmail: row.support_email ?? '',
    supportPhone: row.support_phone ?? '',
    defaultCurrency: row.default_currency ?? 'INR',
    minInvestmentAmount: Number(row.min_investment_amount),
    maxInvestmentAmount: Number(row.max_investment_amount),
    agreementCharges: Number(row.agreement_charges),
    defaultInterestRate: Number(row.default_interest_rate),
    defaultTdsPercent: Number(row.default_tds_percent),
    defaultPayoutDay: Number(row.default_payout_day),
    referralRate: Number(row.referral_rate),
    referralTdsRate: Number(row.referral_tds_rate),
    updatedAt: row.updated_at,
    agreementParty: mapAgreementParty(row),
  };
}

const SETTINGS_SQL = `
  SELECT
    c.name, c.client_code, c.support_email, c.support_phone,
    s.default_currency, s.min_investment_amount, s.max_investment_amount,
    s.agreement_charges, s.default_interest_rate, s.default_tds_percent,
    s.default_payout_day, s.referral_rate, s.referral_tds_rate, s.updated_at,
    ${AGREEMENT_PARTY_COLUMNS}
  FROM clients c
  JOIN client_settings s ON s.client_id = c.id
  WHERE c.id = $1
  LIMIT 1
`;

settingsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { clientId } = (req as AuthedRequest).auth;
    const result = await pool.query(SETTINGS_SQL, [clientId]);
    if (!result.rows[0]) {
      res.status(404).json({ error: 'Client settings not found.' });
      return;
    }
    res.json({ settings: mapSettings(result.rows[0]) });
  })
);

settingsRouter.patch(
  '/',
  asyncHandler(async (req, res) => {
    const { clientId } = (req as AuthedRequest).auth;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const hasSupport = body.supportEmail !== undefined || body.supportPhone !== undefined;
    const hasParty = body.agreementParty !== undefined || body.secondParty !== undefined;

    if (hasSupport) {
      const supportEmail = text(body.supportEmail);
      const supportPhone = text(body.supportPhone);
      await pool.query(
        `UPDATE clients
         SET support_email = $2, support_phone = $3, updated_at = NOW()
         WHERE id = $1`,
        [clientId, supportEmail || null, supportPhone || null]
      );
    }

    if (hasParty) {
      const party = parseAgreementParty(body);
      const partyError = validateAgreementParty(party);
      if (partyError) {
        res.status(400).json({ error: partyError });
        return;
      }
      await pool.query(
        `UPDATE client_settings
         SET second_party_name = $2,
             agreement_offices = $3::jsonb,
             second_party_nominee_name = $4,
             second_party_nominee_aadhaar = $5,
             second_party_nominee_pan = $6,
             second_party_nominee_relation = $7,
             second_party_nominee_phone = $8,
             updated_at = NOW()
         WHERE client_id = $1`,
        [
          clientId,
          party.name,
          JSON.stringify(party.offices),
          party.nomineeName,
          party.nomineeAadhaar,
          party.nomineePan,
          party.nomineeRelation,
          party.nomineePhone,
        ]
      );
    }

    const result = await pool.query(SETTINGS_SQL, [clientId]);
    res.json({ settings: mapSettings(result.rows[0]) });
  })
);
