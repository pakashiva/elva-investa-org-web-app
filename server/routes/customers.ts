import crypto from 'node:crypto';
import { Router } from 'express';
import { hashPassword } from '../auth.ts';
import { normalizeEmail, normalizeMobile, uniqueReferralCode } from '../customerCodes.ts';
import { mapCustomer, loadCustomerDetails } from '../customerView.ts';
import { pool } from '../db.ts';
import { asyncHandler } from '../middleware.ts';
import type { AuthedRequest } from '../types.ts';
import { EMAIL_MOBILE_COMBO_ERROR, isEmailMobileComboDuplicate, money } from '../util.ts';

export const customersRouter = Router();

function text(value: unknown) {
  return String(value ?? '').trim();
}

function mapCustomerList(row: Record<string, unknown>) {
  return {
    ...mapCustomer(row),
    panNumber: row.pan_number ? String(row.pan_number) : null,
    activeInvestments: Number(row.active_investments ?? 0),
    pendingInvestments: Number(row.pending_investments ?? 0),
    closedInvestments: Number(row.closed_investments ?? 0),
    totalInvested: money(row.total_invested),
  };
}

customersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { clientId } = (req as AuthedRequest).auth;
    const filter = text(req.query.filter || req.query.status).toLowerCase() || 'all';
    const search = text(req.query.q);
    const sort = text(req.query.sort) === 'joined_asc' ? 'ASC' : 'DESC';
    const joinFrom = text(req.query.joinFrom);
    const joinTo = text(req.query.joinTo);
    const page = Math.max(1, Number(req.query.page ?? 1) || 1);
    const pageSize = Math.min(50, Math.max(10, Number(req.query.pageSize ?? 10) || 10));
    const offset = (page - 1) * pageSize;

    const filters = ['c.client_id = $1'];
    const params: unknown[] = [clientId];

    if (filter === 'active' || filter === 'inactive') {
      params.push(filter);
      filters.push(`c.status = $${params.length}`);
    }
    if (filter === 'with_investments') {
      filters.push(
        `EXISTS (SELECT 1 FROM investments i WHERE i.customer_id = c.id AND i.client_id = c.client_id)`
      );
    }
    if (filter === 'no_investment') {
      filters.push(
        `NOT EXISTS (SELECT 1 FROM investments i WHERE i.customer_id = c.id AND i.client_id = c.client_id)`
      );
    }
    if (joinFrom) {
      params.push(joinFrom);
      filters.push(`(c.created_at AT TIME ZONE 'Asia/Kolkata')::date >= $${params.length}::date`);
    }
    if (joinTo) {
      params.push(joinTo);
      filters.push(`(c.created_at AT TIME ZONE 'Asia/Kolkata')::date <= $${params.length}::date`);
    }

    if (search) {
      params.push(`%${search}%`);
      const idx = params.length;
      filters.push(
        `(c.full_name ILIKE $${idx} OR c.mobile_number ILIKE $${idx} OR c.email_address ILIKE $${idx} OR c.customer_code ILIKE $${idx} OR c.referral_code ILIKE $${idx} OR COALESCE(k.pan_number, '') ILIKE $${idx})`
      );
    }

    const where = filters.join(' AND ');
    const fromSql = `
      FROM customers c
      LEFT JOIN kyc_documents k ON k.customer_id = c.id AND k.client_id = c.client_id
      WHERE ${where}
    `;
    const count = await pool.query(
      `SELECT COUNT(*)::int AS total ${fromSql}`,
      params
    );
    const result = await pool.query(
      `SELECT
         c.id, c.customer_code, c.full_name, c.mobile_number, c.email_address,
         c.date_of_birth, c.address, c.city, c.state, c.pin_code, c.status,
         c.referral_code, c.created_at, k.pan_number,
         (SELECT COUNT(*)::int FROM investments i
           WHERE i.customer_id = c.id AND i.client_id = c.client_id AND i.status = 'Active') AS active_investments,
         (SELECT COUNT(*)::int FROM investments i
           WHERE i.customer_id = c.id AND i.client_id = c.client_id AND i.status IN ('Pending', 'Under Review')) AS pending_investments,
         (SELECT COUNT(*)::int FROM investments i
           WHERE i.customer_id = c.id AND i.client_id = c.client_id AND i.status IN ('Closed', 'Rejected')) AS closed_investments,
         (SELECT COALESCE(SUM(i.fund_amount), 0) FROM investments i
           WHERE i.customer_id = c.id AND i.client_id = c.client_id AND i.status = 'Active') AS total_invested
       ${fromSql}
       ORDER BY c.created_at ${sort}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset]
    );

    res.json({
      customers: result.rows.map((row) => mapCustomerList(row)),
      total: Number(count.rows[0]?.total ?? 0),
      page,
      pageSize,
    });
  })
);

customersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { clientId } = (req as AuthedRequest).auth;
    const details = await loadCustomerDetails(text(req.params.id), clientId!);
    if (!details) {
      res.status(404).json({ error: 'Customer not found.' });
      return;
    }
    res.json(details);
  })
);

customersRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { clientId } = (req as AuthedRequest).auth;
    const fullName = text(req.body?.fullName);
    const email = normalizeEmail(req.body?.email);
    const mobile = normalizeMobile(req.body?.mobile);
    const dateOfBirth = text(req.body?.dateOfBirth);
    const address = text(req.body?.address);
    const panNumber = text(req.body?.panNumber).toUpperCase().replace(/\s/g, '');
    const aadhaarNumber = String(req.body?.aadhaarNumber ?? '').replace(/\D/g, '');
    const nomineeName = text(req.body?.nomineeName);
    const nomineeRelationship = text(req.body?.nomineeRelationship);
    const nomineeAadhaar = String(req.body?.nomineeAadhaar ?? '').replace(/\D/g, '');
    const nomineePan = text(req.body?.nomineePan).toUpperCase().replace(/\s/g, '');
    const nomineeMobile = normalizeMobile(req.body?.nomineeMobile);
    const accountHolderName = text(req.body?.accountHolderName);
    const accountNumber = String(req.body?.accountNumber ?? '').replace(/\D/g, '');
    const ifscCode = text(req.body?.ifscCode).toUpperCase();
    const branchName = text(req.body?.branchName);
    const accountType = text(req.body?.accountType);
    const referredByCode = text(req.body?.referredByCode).toUpperCase();

    if (!fullName) {
      res.status(400).json({ error: 'Full name is required.' });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: 'Enter a valid email address.' });
      return;
    }
    if (!/^[6-9]\d{9}$/.test(mobile)) {
      res.status(400).json({ error: 'Enter a valid 10-digit Indian mobile number.' });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
      res.status(400).json({ error: 'Enter a valid date of birth.' });
      return;
    }
    const dob = new Date(`${dateOfBirth}T00:00:00`);
    const adult = new Date();
    adult.setFullYear(adult.getFullYear() - 18);
    if (Number.isNaN(dob.getTime()) || dob > adult) {
      res.status(400).json({ error: 'Customer must be at least 18 years old.' });
      return;
    }
    if (!address) {
      res.status(400).json({ error: 'Address is required.' });
      return;
    }
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(panNumber)) {
      res.status(400).json({ error: 'Enter a valid PAN number.' });
      return;
    }
    if (!/^\d{12}$/.test(aadhaarNumber)) {
      res.status(400).json({ error: 'Aadhaar must be 12 digits.' });
      return;
    }
    if (!nomineeName || !nomineeRelationship) {
      res.status(400).json({ error: 'Nominee name and relationship are required.' });
      return;
    }
    if (!/^\d{12}$/.test(nomineeAadhaar)) {
      res.status(400).json({ error: 'Nominee Aadhaar must be 12 digits.' });
      return;
    }
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(nomineePan)) {
      res.status(400).json({ error: 'Enter a valid nominee PAN number.' });
      return;
    }
    if (!/^[6-9]\d{9}$/.test(nomineeMobile)) {
      res.status(400).json({ error: 'Enter a valid 10-digit nominee mobile number.' });
      return;
    }
    if (!accountHolderName) {
      res.status(400).json({ error: 'Account holder name is required.' });
      return;
    }
    if (!/^\d{9,18}$/.test(accountNumber)) {
      res.status(400).json({ error: 'Account number must be 9 to 18 digits.' });
      return;
    }
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifscCode)) {
      res.status(400).json({ error: 'Enter a valid IFSC code.' });
      return;
    }
    if (!branchName) {
      res.status(400).json({ error: 'Branch name is required.' });
      return;
    }
    if (accountType !== 'Savings' && accountType !== 'Current') {
      res.status(400).json({ error: 'Account type must be Savings or Current.' });
      return;
    }

    const passwordHash = await hashPassword(crypto.randomBytes(16).toString('hex'));
    const referralCode = await uniqueReferralCode();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      let referredByCustomerId: string | null = null;
      if (referredByCode) {
        if (!/^[A-Z0-9]{8}$/.test(referredByCode)) {
          await client.query('ROLLBACK');
          res.status(400).json({ error: 'Referral code must be 8 letters or digits.' });
          return;
        }
        const referrer = await client.query(
          `SELECT id FROM customers WHERE client_id = $1 AND referral_code = $2 LIMIT 1`,
          [clientId, referredByCode]
        );
        if (!referrer.rows[0]) {
          await client.query('ROLLBACK');
          res.status(400).json({ error: 'That referral code was not found for this client.' });
          return;
        }
        referredByCustomerId = referrer.rows[0].id;
      }
      const created = await client.query(
        `INSERT INTO customers (
           client_id, full_name, mobile_number, email_address, date_of_birth,
           address, password_hash, referral_code, referred_by_customer_id, authorized, status
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, TRUE, 'active')
         RETURNING
           id, customer_code, full_name, mobile_number, email_address,
           date_of_birth, address, city, state, pin_code, status,
           referral_code, created_at`,
        [clientId, fullName, mobile, email, dateOfBirth, address, passwordHash, referralCode, referredByCustomerId]
      );
      const customer = created.rows[0];

      await client.query(
        `INSERT INTO kyc_documents (client_id, customer_id, aadhaar_number, pan_number)
         VALUES ($1,$2,$3,$4)`,
        [clientId, customer.id, aadhaarNumber, panNumber]
      );

      await client.query(
        `INSERT INTO bank_accounts (
           client_id, customer_id, account_holder_name, account_number,
           ifsc_code, bank_name, account_type, is_primary
         ) VALUES ($1,$2,$3,$4,$5,$6,$7, TRUE)`,
        [clientId, customer.id, accountHolderName, accountNumber, ifscCode, branchName, accountType]
      );

      await client.query(
        `INSERT INTO nominees (
           client_id, customer_id, nominee_name, relationship,
           nominee_aadhaar, nominee_pan, nominee_mobile
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [clientId, customer.id, nomineeName, nomineeRelationship, nomineeAadhaar, nomineePan, nomineeMobile]
      );

      await client.query('COMMIT');
      res.status(201).json({
        customer: mapCustomer(customer),
        ok: true,
        user_id: customer.id,
        customer_id: customer.customer_code,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      if (isEmailMobileComboDuplicate(error)) {
        res.status(409).json({ error: EMAIL_MOBILE_COMBO_ERROR });
        return;
      }
      throw error;
    } finally {
      client.release();
    }
  })
);

customersRouter.patch(
  '/:id/status',
  asyncHandler(async (req, res) => {
    const { clientId } = (req as AuthedRequest).auth;
    const id = text(req.params.id);
    const status = text(req.body?.status).toLowerCase();
    if (status !== 'active' && status !== 'inactive') {
      res.status(400).json({ error: 'Status must be active or inactive.' });
      return;
    }

    const updated = await pool.query(
      `UPDATE customers
       SET status = $3, updated_at = NOW()
       WHERE id = $1 AND client_id = $2
       RETURNING
         id, customer_code, full_name, mobile_number, email_address,
         date_of_birth, address, city, state, pin_code, status,
         referral_code, created_at`,
      [id, clientId, status]
    );
    if ((updated.rowCount ?? 0) === 0) {
      res.status(404).json({ error: 'Customer not found.' });
      return;
    }
    res.json({ customer: mapCustomer(updated.rows[0]) });
  })
);

function parseBankBody(body: Record<string, unknown>) {
  return {
    accountHolderName: text(body.accountHolderName),
    bankName: text(body.bankName ?? body.branchName),
    accountNumber: String(body.accountNumber ?? '').replace(/\D/g, ''),
    ifscCode: text(body.ifscCode).toUpperCase(),
    accountType: text(body.accountType),
    isPrimary: Boolean(body.isPrimary),
  };
}

function bankError(bank: ReturnType<typeof parseBankBody>): string | null {
  if (!bank.accountHolderName) return 'Account holder name is required.';
  if (!bank.bankName) return 'Bank / branch name is required.';
  if (!/^\d{9,18}$/.test(bank.accountNumber)) return 'Account number must be 9 to 18 digits.';
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(bank.ifscCode)) return 'Enter a valid IFSC code.';
  if (bank.accountType !== 'Savings' && bank.accountType !== 'Current') {
    return 'Account type must be Savings or Current.';
  }
  return null;
}

async function setPrimaryBank(
  client: { query: typeof pool.query },
  clientId: string,
  customerId: string,
  bankId: string
) {
  await client.query(
    `UPDATE bank_accounts
     SET is_primary = (id = $3)
     WHERE customer_id = $1 AND client_id = $2`,
    [customerId, clientId, bankId]
  );
}

customersRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { clientId } = (req as AuthedRequest).auth;
    const id = text(req.params.id);
    const fullName = text(req.body?.fullName);
    const email = normalizeEmail(req.body?.email);
    const mobile = normalizeMobile(req.body?.mobile);
    const dateOfBirth = text(req.body?.dateOfBirth);
    const address = text(req.body?.address);
    const panNumber = text(req.body?.panNumber).toUpperCase().replace(/\s/g, '');
    const aadhaarNumber = String(req.body?.aadhaarNumber ?? '').replace(/\D/g, '');
    const nomineeName = text(req.body?.nomineeName);
    const nomineeRelationship = text(req.body?.nomineeRelationship);
    const nomineeAadhaar = String(req.body?.nomineeAadhaar ?? '').replace(/\D/g, '');
    const nomineePan = text(req.body?.nomineePan).toUpperCase().replace(/\s/g, '');
    const nomineeMobile = normalizeMobile(req.body?.nomineeMobile);

    if (!fullName) {
      res.status(400).json({ error: 'Full name is required.' });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: 'Enter a valid email address.' });
      return;
    }
    if (!/^[6-9]\d{9}$/.test(mobile)) {
      res.status(400).json({ error: 'Enter a valid 10-digit Indian mobile number.' });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
      res.status(400).json({ error: 'Enter a valid date of birth.' });
      return;
    }
    const dob = new Date(`${dateOfBirth}T00:00:00`);
    const adult = new Date();
    adult.setFullYear(adult.getFullYear() - 18);
    if (Number.isNaN(dob.getTime()) || dob > adult) {
      res.status(400).json({ error: 'Customer must be at least 18 years old.' });
      return;
    }
    if (!address) {
      res.status(400).json({ error: 'Address is required.' });
      return;
    }
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(panNumber)) {
      res.status(400).json({ error: 'Enter a valid PAN number.' });
      return;
    }
    if (!/^\d{12}$/.test(aadhaarNumber)) {
      res.status(400).json({ error: 'Aadhaar must be 12 digits.' });
      return;
    }
    if (!nomineeName || !nomineeRelationship) {
      res.status(400).json({ error: 'Nominee name and relationship are required.' });
      return;
    }
    if (!/^\d{12}$/.test(nomineeAadhaar)) {
      res.status(400).json({ error: 'Nominee Aadhaar must be 12 digits.' });
      return;
    }
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(nomineePan)) {
      res.status(400).json({ error: 'Enter a valid nominee PAN number.' });
      return;
    }
    if (!/^[6-9]\d{9}$/.test(nomineeMobile)) {
      res.status(400).json({ error: 'Enter a valid 10-digit nominee mobile number.' });
      return;
    }

    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const updated = await db.query(
        `UPDATE customers
         SET full_name = $3, email_address = $4, mobile_number = $5,
             date_of_birth = $6, address = $7, updated_at = NOW()
         WHERE id = $1 AND client_id = $2
         RETURNING id`,
        [id, clientId, fullName, email, mobile, dateOfBirth, address]
      );
      if ((updated.rowCount ?? 0) === 0) {
        await db.query('ROLLBACK');
        res.status(404).json({ error: 'Customer not found.' });
        return;
      }

      await db.query(
        `INSERT INTO kyc_documents (client_id, customer_id, aadhaar_number, pan_number)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (customer_id)
         DO UPDATE SET aadhaar_number = EXCLUDED.aadhaar_number, pan_number = EXCLUDED.pan_number`,
        [clientId, id, aadhaarNumber, panNumber]
      );

      const nominee = await db.query(
        `SELECT id FROM nominees WHERE customer_id = $1 AND client_id = $2
         ORDER BY created_at ASC LIMIT 1`,
        [id, clientId]
      );
      if (nominee.rows[0]) {
        await db.query(
          `UPDATE nominees
           SET nominee_name = $3, relationship = $4, nominee_aadhaar = $5,
               nominee_pan = $6, nominee_mobile = $7
           WHERE id = $1 AND client_id = $2`,
          [
            nominee.rows[0].id,
            clientId,
            nomineeName,
            nomineeRelationship,
            nomineeAadhaar,
            nomineePan,
            nomineeMobile,
          ]
        );
      } else {
        await db.query(
          `INSERT INTO nominees (
             client_id, customer_id, nominee_name, relationship,
             nominee_aadhaar, nominee_pan, nominee_mobile
           ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [clientId, id, nomineeName, nomineeRelationship, nomineeAadhaar, nomineePan, nomineeMobile]
        );
      }

      await db.query('COMMIT');
      const details = await loadCustomerDetails(id, clientId!);
      res.json(details);
    } catch (error) {
      await db.query('ROLLBACK');
      if (isEmailMobileComboDuplicate(error)) {
        res.status(409).json({ error: EMAIL_MOBILE_COMBO_ERROR });
        return;
      }
      throw error;
    } finally {
      db.release();
    }
  })
);

customersRouter.post(
  '/:id/banks',
  asyncHandler(async (req, res) => {
    const { clientId } = (req as AuthedRequest).auth;
    const customerId = text(req.params.id);
    const bank = parseBankBody(req.body ?? {});
    const error = bankError(bank);
    if (error) {
      res.status(400).json({ error });
      return;
    }

    const owner = await pool.query(
      `SELECT id FROM customers WHERE id = $1 AND client_id = $2 LIMIT 1`,
      [customerId, clientId]
    );
    if (!owner.rows[0]) {
      res.status(404).json({ error: 'Customer not found.' });
      return;
    }

    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const created = await db.query(
        `INSERT INTO bank_accounts (
           client_id, customer_id, account_holder_name, account_number,
           ifsc_code, bank_name, account_type, is_primary
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id`,
        [
          clientId,
          customerId,
          bank.accountHolderName,
          bank.accountNumber,
          bank.ifscCode,
          bank.bankName,
          bank.accountType,
          bank.isPrimary,
        ]
      );
      if (bank.isPrimary) {
        await setPrimaryBank(db, clientId!, customerId, created.rows[0].id);
      }
      await db.query('COMMIT');
      res.status(201).json(await loadCustomerDetails(customerId, clientId!));
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    } finally {
      db.release();
    }
  })
);

customersRouter.patch(
  '/:id/banks/:bankId',
  asyncHandler(async (req, res) => {
    const { clientId } = (req as AuthedRequest).auth;
    const customerId = text(req.params.id);
    const bankId = text(req.params.bankId);
    const bank = parseBankBody(req.body ?? {});
    const error = bankError(bank);
    if (error) {
      res.status(400).json({ error });
      return;
    }

    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const updated = await db.query(
        `UPDATE bank_accounts
         SET account_holder_name = $4, account_number = $5, ifsc_code = $6,
             bank_name = $7, account_type = $8, is_primary = $9
         WHERE id = $1 AND customer_id = $2 AND client_id = $3
         RETURNING id`,
        [
          bankId,
          customerId,
          clientId,
          bank.accountHolderName,
          bank.accountNumber,
          bank.ifscCode,
          bank.bankName,
          bank.accountType,
          bank.isPrimary,
        ]
      );
      if ((updated.rowCount ?? 0) === 0) {
        await db.query('ROLLBACK');
        res.status(404).json({ error: 'Bank account not found.' });
        return;
      }
      if (bank.isPrimary) {
        await setPrimaryBank(db, clientId!, customerId, bankId);
      }
      await db.query('COMMIT');
      res.json(await loadCustomerDetails(customerId, clientId!));
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    } finally {
      db.release();
    }
  })
);

customersRouter.patch(
  '/:id/investments/:investmentId/bank',
  asyncHandler(async (req, res) => {
    const { clientId } = (req as AuthedRequest).auth;
    const customerId = text(req.params.id);
    const investmentId = text(req.params.investmentId);
    const bankAccountId = text(req.body?.bankAccountId ?? req.body?.bank_account_id);
    if (!bankAccountId) {
      res.status(400).json({ error: 'Select a bank account.' });
      return;
    }

    const bank = await pool.query(
      `SELECT id FROM bank_accounts
       WHERE id = $1 AND customer_id = $2 AND client_id = $3
       LIMIT 1`,
      [bankAccountId, customerId, clientId]
    );
    if (!bank.rows[0]) {
      res.status(400).json({ error: 'That bank account does not belong to this customer.' });
      return;
    }

    const updated = await pool.query(
      `UPDATE investments
       SET bank_account_id = $4, updated_at = NOW()
       WHERE id = $1 AND customer_id = $2 AND client_id = $3
       RETURNING id`,
      [investmentId, customerId, clientId, bankAccountId]
    );
    if ((updated.rowCount ?? 0) === 0) {
      res.status(404).json({ error: 'Investment not found.' });
      return;
    }

    res.json(await loadCustomerDetails(customerId, clientId!));
  })
);
