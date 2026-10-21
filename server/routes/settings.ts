import { Router } from 'express';
import {
  AGREEMENT_PARTY_COLUMNS,
  mapAgreementParty,
  parseAgreementParty,
  validateAgreementParty,
} from '../agreementParty';
import { pool } from '../db';
import { asyncHandler } from '../middleware';
import type { AuthedRequest } from '../types';
import { text } from '../util';

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
    const loanDefaults=await pool.query(`SELECT id,name,interest_model,interest_rate_percent,interest_rate_period,interest_frequency,repayment_model,repayment_frequency,payment_allocation,grace_period_days,overdue_rule,overdue_charge,part_payments_allowed,advance_payment_treatment,approval_workflow,receipt_required,write_off_allowed,closure_mode,rounding_scale,required_documents FROM loan_products WHERE client_id=$1 AND status='active' ORDER BY created_at LIMIT 1`,[clientId]);
    res.json({ settings: { ...mapSettings(result.rows[0]), loanDefaults: loanDefaults.rows[0] ?? null } });
  })
);

settingsRouter.patch(
  '/',
  asyncHandler(async (req, res) => {
    const { clientId } = (req as AuthedRequest).auth;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const hasSupport = body.supportEmail !== undefined || body.supportPhone !== undefined;
    const hasParty = body.agreementParty !== undefined || body.secondParty !== undefined;
    if(body.loanDefaults && typeof body.loanDefaults==='object') {
      const d=body.loanDefaults as Record<string,unknown>; const id=text(d.id);
      const rate=Number(d.interest_rate_percent), charge=Number(d.overdue_charge), grace=Number(d.grace_period_days);
      if(!id||!Number.isFinite(rate)||rate<0||rate>100||!Number.isFinite(charge)||charge<0||!Number.isInteger(grace)||grace<0){res.status(400).json({error:'Enter valid default loan terms.'});return;}
      await pool.query(`UPDATE loan_products SET interest_model=$3,interest_rate_percent=$4,interest_rate_period=$5,interest_frequency=$6,repayment_model=$7,repayment_frequency=$8,payment_allocation=$9,grace_period_days=$10,overdue_rule=$11,overdue_charge=$12,part_payments_allowed=$13,advance_payment_treatment=$14,approval_workflow=$15,receipt_required=$16,write_off_allowed=$17,closure_mode=$18,rounding_scale=$19,updated_at=NOW() WHERE id=$1 AND client_id=$2 AND status='active'`,[id,clientId,d.interest_model,rate,d.interest_rate_period,d.interest_frequency,d.repayment_model,d.repayment_frequency,d.payment_allocation,grace,d.overdue_rule,charge,d.part_payments_allowed===true,d.advance_payment_treatment,d.approval_workflow,d.receipt_required===true,d.write_off_allowed===true,d.closure_mode,Number(d.rounding_scale??2)]);
    }

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
    const loanDefaults=await pool.query(`SELECT id,name,interest_model,interest_rate_percent,interest_rate_period,interest_frequency,repayment_model,repayment_frequency,payment_allocation,grace_period_days,overdue_rule,overdue_charge,part_payments_allowed,advance_payment_treatment,approval_workflow,receipt_required,write_off_allowed,closure_mode,rounding_scale,required_documents FROM loan_products WHERE client_id=$1 AND status='active' ORDER BY created_at LIMIT 1`,[clientId]);
    res.json({ settings: { ...mapSettings(result.rows[0]), loanDefaults: loanDefaults.rows[0] ?? null } });
  })
);
