import { Router } from 'express';
import {
  AGREEMENT_PARTY_COLUMNS,
  isAgreementPartyComplete,
  mapAgreementParty,
  officeForSelection,
} from '../agreementParty';
import { pool } from '../db';
import { asyncHandler } from '../middleware';
import type { AuthedRequest } from '../types';
import { asNumber, isUuid, money, text } from '../util';

export const agreementsRouter = Router();

const FIELD_KINDS = ['cheque_no', 'bank_name', 'bank_address'] as const;
type FieldKind = (typeof FIELD_KINDS)[number];

function isFieldKind(value: string): value is FieldKind {
  return FIELD_KINDS.includes(value as FieldKind);
}

function dateOnly(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const raw = String(value ?? '').trim();
  if (!raw) {
    return '';
  }
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) {
    return iso[1];
  }
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return '';
}

function customerAddress(row: Record<string, unknown>) {
  return [row.address, row.city, row.state, row.pin_code]
    .map((part) => text(part))
    .filter(Boolean)
    .join(', ');
}

async function rememberChequeField(
  client: { query: typeof pool.query },
  clientId: string,
  kind: FieldKind,
  value: string
) {
  const trimmed = text(value);
  if (!trimmed) return;
  const updated = await client.query(
    `UPDATE agreement_cheque_field_presets
     SET used_count = used_count + 1,
         last_used_at = NOW(),
         field_value = $3
     WHERE client_id = $1
       AND field_kind = $2
       AND lower(field_value) = lower($3)`,
    [clientId, kind, trimmed]
  );
  if ((updated.rowCount ?? 0) > 0) return;
  try {
    await client.query(
      `INSERT INTO agreement_cheque_field_presets (client_id, field_kind, field_value)
       VALUES ($1, $2, $3)`,
      [clientId, kind, trimmed]
    );
  } catch (error) {
    if ((error as { code?: string }).code !== '23505') {
      throw error;
    }
  }
}

async function agreementPayload(clientId: string, agreementId: string) {
  const result = await pool.query(
    `SELECT
       a.id,
       a.branch,
       a.agreement_date::text AS agreement_date,
       a.period_from::text AS period_from,
       a.period_to::text AS period_to,
       a.cheque_no,
       a.cheque_bank_name,
       a.cheque_bank_address,
       a.renewal_id,
       a.fund_amount AS agreement_amount,
       i.id AS investment_id,
       i.code,
       i.name AS plan_name,
       i.interest_rate,
       i.tds_percent,
       c.customer_code,
       c.full_name,
       c.address,
       c.city,
       c.state,
       c.pin_code,
       c.email_address,
       c.mobile_number,
       k.pan_number,
       k.aadhaar_number,
       ba.account_holder_name,
       ba.account_number,
       ba.ifsc_code,
       ba.bank_name,
       n.nominee_name,
       n.relationship,
       n.nominee_aadhaar,
       n.nominee_pan,
       n.nominee_mobile,
       s.agreement_charges,
       a.notice_days,
       ${AGREEMENT_PARTY_COLUMNS}
     FROM investment_agreements a
     JOIN investments i ON i.id = a.investment_id AND i.client_id = a.client_id
     JOIN customers c ON c.id = i.customer_id AND c.client_id = i.client_id
     JOIN client_settings s ON s.client_id = a.client_id
     LEFT JOIN kyc_documents k ON k.customer_id = c.id AND k.client_id = c.client_id
     LEFT JOIN bank_accounts ba ON ba.id = i.bank_account_id AND ba.client_id = i.client_id
     LEFT JOIN nominees n ON n.id = i.nominee_id AND n.client_id = i.client_id
     WHERE a.id = $1 AND a.client_id = $2
     LIMIT 1`,
    [agreementId, clientId]
  );

  const row = result.rows[0];
  if (!row) return null;

  const party = mapAgreementParty(row);
  const storedPlace = text(row.branch);
  const office = officeForSelection(party, { placeName: storedPlace });
  const noticeDays = asNumber(row.notice_days) || office?.noticeDays || 30;
  const executionPlace = storedPlace || office?.placeName || '';

  return {
    agreement: {
      id: row.id,
      branch: executionPlace,
      noticeDays,
      agreement_date: dateOnly(row.agreement_date),
      period_from: dateOnly(row.period_from),
      period_to: dateOnly(row.period_to),
      cheque_no: String(row.cheque_no ?? ''),
      cheque_bank_name: String(row.cheque_bank_name ?? ''),
      cheque_bank_address: String(row.cheque_bank_address ?? ''),
      renewal_id: row.renewal_id ? String(row.renewal_id) : null,
    },
    investment: {
      id: row.investment_id,
      code: row.code ? String(row.code) : null,
      plan_name: String(row.plan_name ?? ''),
      fund_amount: money(row.agreement_amount),
      interest_rate: asNumber(row.interest_rate) || 0,
      tds_percent: asNumber(row.tds_percent) || 0,
    },
    customer: {
      customer_id: row.customer_code ? String(row.customer_code) : null,
      full_name: String(row.full_name ?? ''),
      address: customerAddress(row),
      email: String(row.email_address ?? ''),
      mobile: String(row.mobile_number ?? ''),
      pan: String(row.pan_number ?? ''),
      aadhaar: String(row.aadhaar_number ?? ''),
    },
    bank: row.account_number
      ? {
          holder: text(row.account_holder_name) || String(row.full_name ?? ''),
          account_number: String(row.account_number ?? ''),
          ifsc_code: String(row.ifsc_code ?? ''),
          bank_name: String(row.bank_name ?? ''),
          branch_name: '',
        }
      : null,
    nominee: row.nominee_name
      ? {
          name: String(row.nominee_name ?? ''),
          relation: String(row.relationship ?? ''),
          aadhaar: String(row.nominee_aadhaar ?? ''),
          pan: String(row.nominee_pan ?? ''),
          mobile: String(row.nominee_mobile ?? ''),
        }
      : null,
    processingFee: asNumber(row.agreement_charges) || 0,
    secondParty: {
      name: party.name,
      address: office?.address ?? '',
      phone: office?.phone ?? '',
      email: office?.email ?? '',
      placeName: office?.placeName || executionPlace,
      noticeDays: office?.noticeDays || noticeDays,
      nomineeName: party.nomineeName,
      nomineeAadhaar: party.nomineeAadhaar,
      nomineePan: party.nomineePan,
      nomineeRelation: party.nomineeRelation,
      nomineePhone: party.nomineePhone,
    },
  };
}

agreementsRouter.get(
  '/cheque-presets',
  asyncHandler(async (req, res) => {
    const { clientId } = (req as AuthedRequest).auth;
    if (!clientId) {
      res.status(403).json({ error: 'Client context is required.' });
      return;
    }
    const result = await pool.query(
      `SELECT field_kind, field_value, last_used_at
       FROM agreement_cheque_field_presets
       WHERE client_id = $1
       ORDER BY last_used_at DESC`,
      [clientId]
    );

    const cheque_nos: string[] = [];
    const bank_names: string[] = [];
    const bank_addresses: string[] = [];
    for (const row of result.rows) {
      const value = text(row.field_value);
      if (!value) continue;
      if (row.field_kind === 'cheque_no' && cheque_nos.length < 100) cheque_nos.push(value);
      if (row.field_kind === 'bank_name' && bank_names.length < 100) bank_names.push(value);
      if (row.field_kind === 'bank_address' && bank_addresses.length < 100) {
        bank_addresses.push(value);
      }
    }

    res.json({ cheque_nos, bank_names, bank_addresses });
  })
);

agreementsRouter.post(
  '/cheque-presets',
  asyncHandler(async (req, res) => {
    const { clientId } = (req as AuthedRequest).auth;
    if (!clientId) {
      res.status(403).json({ error: 'Client context is required.' });
      return;
    }
    const kind = text(req.body?.fieldKind ?? req.body?.field_kind).toLowerCase();
    const value = text(req.body?.fieldValue ?? req.body?.field_value);
    if (!isFieldKind(kind)) {
      res.status(400).json({ error: 'Field must be cheque_no, bank_name, or bank_address.' });
      return;
    }
    if (!value) {
      res.status(400).json({ error: 'Enter a value to save.' });
      return;
    }
    await rememberChequeField(pool, clientId, kind, value);
    res.status(201).json({ ok: true });
  })
);

agreementsRouter.delete(
  '/cheque-presets',
  asyncHandler(async (req, res) => {
    const { clientId } = (req as AuthedRequest).auth;
    if (!clientId) {
      res.status(403).json({ error: 'Client context is required.' });
      return;
    }
    const kind = text(req.body?.fieldKind ?? req.query.fieldKind).toLowerCase();
    const value = text(req.body?.fieldValue ?? req.query.fieldValue);
    if (!isFieldKind(kind) || !value) {
      res.status(400).json({ error: 'Select a saved cheque field to remove.' });
      return;
    }
    await pool.query(
      `DELETE FROM agreement_cheque_field_presets
       WHERE client_id = $1 AND field_kind = $2 AND lower(field_value) = lower($3)`,
      [clientId, kind, value]
    );
    res.json({ ok: true });
  })
);

agreementsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { clientId } = (req as AuthedRequest).auth;
    if (!clientId) {
      res.status(403).json({ error: 'Client context is required.' });
      return;
    }
    const investmentId = text(req.query.investmentId);
    const renewalId = text(req.query.renewalId);
    if (!isUuid(investmentId)) {
      res.status(400).json({ error: 'Investment is required.' });
      return;
    }

    const result = renewalId
      ? await pool.query(
          `SELECT id FROM investment_agreements
           WHERE client_id = $1 AND investment_id = $2 AND renewal_id = $3
           LIMIT 1`,
          [clientId, investmentId, renewalId]
        )
      : await pool.query(
          `SELECT id FROM investment_agreements
           WHERE client_id = $1 AND investment_id = $2 AND renewal_id IS NULL
           LIMIT 1`,
          [clientId, investmentId]
        );

    const agreementId = result.rows[0]?.id;
    if (!agreementId) {
      res.json({ agreement: null });
      return;
    }

    res.json({ agreement: await agreementPayload(clientId, agreementId) });
  })
);

agreementsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { clientId } = (req as AuthedRequest).auth;
    if (!clientId) {
      res.status(403).json({ error: 'Client context is required.' });
      return;
    }
    const investmentId = text(req.body?.investmentId ?? req.body?.investment_id);
    const renewalId = text(req.body?.renewalId ?? req.body?.renewal_id);
    const officeId = text(req.body?.officeId ?? req.body?.office_id);
    const placeName = text(req.body?.placeName ?? req.body?.branch);
    const chequeNo = text(req.body?.chequeNo ?? req.body?.cheque_no);
    const chequeBankName = text(req.body?.chequeBankName ?? req.body?.cheque_bank_name);
    const chequeBankAddress = text(req.body?.chequeBankAddress ?? req.body?.cheque_bank_address);

    if (!isUuid(investmentId)) {
      res.status(400).json({ error: 'Investment is required.' });
      return;
    }
    if (!chequeNo) {
      res.status(400).json({ error: 'Cheque number is required.' });
      return;
    }
    if (!chequeBankName) {
      res.status(400).json({ error: 'Cheque bank name is required.' });
      return;
    }
    if (!chequeBankAddress) {
      res.status(400).json({ error: 'Cheque bank address is required.' });
      return;
    }
    if (renewalId && !isUuid(renewalId)) {
      res.status(400).json({ error: 'Renewal request is invalid.' });
      return;
    }

    const partyRow = await pool.query(
      `SELECT ${AGREEMENT_PARTY_COLUMNS}
       FROM client_settings s
       WHERE s.client_id = $1
       LIMIT 1`,
      [clientId]
    );
    const party = mapAgreementParty(partyRow.rows[0] ?? {});
    if (!isAgreementPartyComplete(party)) {
      res.status(400).json({
        error: 'Complete Second Party details in Settings before generating an agreement.',
      });
      return;
    }
    const office = officeForSelection(party, { officeId, placeName });
    if (!office) {
      res.status(400).json({ error: 'Select the office where this agreement is executed.' });
      return;
    }

    const db = await pool.connect();
    try {
      await db.query('BEGIN');

      const investment = await db.query(
        `SELECT id, fund_amount, status
         FROM investments
         WHERE id = $1 AND client_id = $2
         FOR UPDATE`,
        [investmentId, clientId]
      );
      const inv = investment.rows[0];
      if (!inv) {
        await db.query('ROLLBACK');
        res.status(404).json({ error: 'Investment not found.' });
        return;
      }

      if (renewalId) {
        const renewal = await db.query(
          `SELECT id FROM agreement_renewal_requests
           WHERE id = $1 AND investment_id = $2 AND client_id = $3
           LIMIT 1`,
          [renewalId, investmentId, clientId]
        );
        if ((renewal.rowCount ?? 0) === 0) {
          await db.query('ROLLBACK');
          res.status(400).json({ error: 'Renewal request does not belong to this investment.' });
          return;
        }
      }

      try {
        await rememberChequeField(db, clientId, 'cheque_no', chequeNo);
        await rememberChequeField(db, clientId, 'bank_name', chequeBankName);
        await rememberChequeField(db, clientId, 'bank_address', chequeBankAddress);
      } catch {
        // Preset remember must never block the agreement row.
      }

      const existing = renewalId
        ? await db.query(
            `SELECT id, agreement_date
             FROM investment_agreements
             WHERE client_id = $1 AND renewal_id = $2
             LIMIT 1`,
            [clientId, renewalId]
          )
        : await db.query(
            `SELECT id, agreement_date
             FROM investment_agreements
             WHERE client_id = $1 AND investment_id = $2 AND renewal_id IS NULL
             LIMIT 1`,
            [clientId, investmentId]
          );

      let agreementId = existing.rows[0]?.id as string | undefined;
      const start = existing.rows[0]?.agreement_date ?? null;

      if (!agreementId) {
        const inserted = await db.query(
          `INSERT INTO investment_agreements (
             client_id, investment_id, renewal_id, branch, notice_days,
             agreement_date, period_from, period_to, fund_amount,
             cheque_no, cheque_bank_name, cheque_bank_address
           ) VALUES (
             $1, $2, $3, $4, $5,
             (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE,
             (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE,
             ((NOW() AT TIME ZONE 'Asia/Kolkata')::DATE + INTERVAL '1 year' - INTERVAL '1 day')::DATE,
             $6, $7, $8, $9
           )
           RETURNING id`,
          [
            clientId,
            investmentId,
            renewalId || null,
            office.placeName,
            office.noticeDays,
            money(inv.fund_amount),
            chequeNo,
            chequeBankName,
            chequeBankAddress,
          ]
        );
        agreementId = inserted.rows[0].id;
      } else {
        await db.query(
          `UPDATE investment_agreements
           SET branch = $3,
               notice_days = $4,
               agreement_date = COALESCE($5, agreement_date),
               period_from = COALESCE($5, period_from),
               period_to = (COALESCE($5, agreement_date) + INTERVAL '1 year' - INTERVAL '1 day')::DATE,
               fund_amount = $6,
               cheque_no = $7,
               cheque_bank_name = $8,
               cheque_bank_address = $9,
               updated_at = NOW()
           WHERE id = $1 AND client_id = $2`,
          [
            agreementId,
            clientId,
            office.placeName,
            office.noticeDays,
            start,
            money(inv.fund_amount),
            chequeNo,
            chequeBankName,
            chequeBankAddress,
          ]
        );
      }

      await db.query('COMMIT');
      res.json({ agreement: await agreementPayload(clientId, agreementId!) });
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
  })
);
