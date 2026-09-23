import { Router } from 'express';
import {
  hashPassword,
  readToken,
  signCustomerToken,
  signPasswordResetToken,
  verifyAuthToken,
  verifyPassword,
} from '../auth.ts';
import { normalizeEmail, normalizeMobile, uniqueReferralCode } from '../customerCodes.ts';
import { pool } from '../db.ts';
import { asyncHandler, requireCustomer } from '../middleware.ts';
import { callElvatechOtp, maskMobileNumber, toOtpPhone } from '../otp.ts';
import type { CustomerAuth, CustomerRequest } from '../types.ts';
import { customerPasswordError, isEmailMobileComboDuplicate, EMAIL_MOBILE_COMBO_ERROR, text } from '../util.ts';

export const mobileAuthRouter = Router();

function customerPayload(row: CustomerAuth) {
  return {
    id: row.id,
    fullName: row.fullName,
    mobileNumber: row.mobileNumber,
    emailAddress: row.emailAddress,
    customerCode: row.customerCode,
    referralCode: row.referralCode,
    clientId: row.clientId,
    clientName: row.clientName,
    clientCode: row.clientCode,
    mobileVerified: row.mobileVerified,
  };
}

async function loadCustomerAuth(customerId: string): Promise<CustomerAuth | null> {
  const result = await pool.query(
    `SELECT
       c.id, c.full_name, c.mobile_number, c.email_address, c.customer_code,
       c.referral_code, c.status, c.mobile_verified, c.client_id,
       cl.name AS client_name, cl.client_code, cl.status AS client_status
     FROM customers c
     JOIN clients cl ON cl.id = c.client_id
     WHERE c.id = $1
     LIMIT 1`,
    [customerId]
  );
  const row = result.rows[0];
  if (!row || row.status !== 'active' || row.client_status !== 'active') {
    return null;
  }
  return {
    id: row.id,
    fullName: row.full_name,
    mobileNumber: row.mobile_number,
    emailAddress: row.email_address,
    customerCode: row.customer_code,
    referralCode: row.referral_code,
    clientId: row.client_id,
    clientName: row.client_name,
    clientCode: row.client_code,
    mobileVerified: Boolean(row.mobile_verified),
  };
}

async function resumeUnverifiedRegistration(
  clientId: string,
  mobile: string,
  email: string,
  password: string
): Promise<CustomerAuth | 'conflict' | null> {
  const result = await pool.query(
    `SELECT id, password_hash, mobile_verified
     FROM customers
     WHERE client_id = $1 AND mobile_number = $2 AND lower(email_address) = $3
     LIMIT 1`,
    [clientId, mobile, email]
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  if (row.mobile_verified) {
    return 'conflict';
  }
  const passwordOk = await verifyPassword(password, row.password_hash);
  if (!passwordOk) {
    return 'conflict';
  }
  const customer = await loadCustomerAuth(row.id);
  return customer ?? 'conflict';
}

function sendCustomerSession(
  res: {
    status: (code: number) => { json: (body: unknown) => void };
    json: (body: unknown) => void;
  },
  customer: CustomerAuth,
  status = 200,
  extra: Record<string, unknown> = {}
) {
  const token = signCustomerToken(customer.id, customer.mobileNumber, customer.clientId);
  const body = {
    token,
    customer: customerPayload(customer),
    ...extra,
  };
  if (status === 200) {
    res.json(body);
    return;
  }
  res.status(status).json(body);
}

mobileAuthRouter.get(
  '/client/:code',
  asyncHandler(async (req, res) => {
    const clientCode = text(req.params.code).toUpperCase();
    if (!/^[A-Z0-9]{3,20}$/.test(clientCode)) {
      res.status(400).json({ error: 'Enter a valid client code.' });
      return;
    }
    const result = await pool.query(
      `SELECT name, client_code, status
       FROM clients
       WHERE lower(client_code) = lower($1)
       LIMIT 1`,
      [clientCode]
    );
    const client = result.rows[0];
    if (!client) {
      res.status(404).json({ error: 'That client code was not found.' });
      return;
    }
    if (client.status !== 'active') {
      res.status(403).json({ error: 'This client is not accepting new customers.' });
      return;
    }
    res.json({
      client: {
        name: client.name,
        clientCode: client.client_code,
      },
    });
  })
);

mobileAuthRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const clientCode = text(req.body?.clientCode).toUpperCase();
    const fullName = text(req.body?.fullName);
    const email = normalizeEmail(req.body?.email ?? req.body?.emailAddress);
    const mobile = normalizeMobile(req.body?.mobile ?? req.body?.mobileNumber);
    const dateOfBirth = text(req.body?.dateOfBirth);
    const address = text(req.body?.address);
    const city = text(req.body?.city);
    const state = text(req.body?.state);
    const pinCode = text(req.body?.pinCode).replace(/\D/g, '');
    const aadhaarNumber = text(req.body?.aadhaarNumber).replace(/\D/g, '');
    const panNumber = text(req.body?.panNumber).toUpperCase();
    const accountHolderName = text(req.body?.accountHolderName);
    const accountNumber = String(req.body?.accountNumber ?? '').replace(/\D/g, '');
    const ifscCode = text(req.body?.ifscCode).toUpperCase();
    const bankName = text(req.body?.bankName);
    const accountType = text(req.body?.accountType);
    const nomineeName = text(req.body?.nomineeName);
    const relationship = text(req.body?.relationship ?? req.body?.nomineeRelationship);
    const nomineeAadhaar = text(req.body?.nomineeAadhaar).replace(/\D/g, '');
    const nomineeMobile = text(req.body?.nomineeMobile).replace(/\D/g, '');
    const nomineePan = text(req.body?.nomineePan).toUpperCase();
    const password = String(req.body?.password ?? '');
    const authorized = Boolean(req.body?.authorized);

    if (!/^[A-Z0-9]{3,20}$/.test(clientCode)) {
      res.status(400).json({ error: 'Enter a valid client code.' });
      return;
    }
    const clientRow = await pool.query(
      `SELECT id, name, client_code, status
       FROM clients
       WHERE lower(client_code) = lower($1)
       LIMIT 1`,
      [clientCode]
    );
    const client = clientRow.rows[0];
    if (!client) {
      res.status(400).json({ error: 'That client code was not found.' });
      return;
    }
    if (client.status !== 'active') {
      res.status(403).json({ error: 'This client is not accepting new customers.' });
      return;
    }
    const clientId = client.id as string;

    if (!fullName) {
      res.status(400).json({ error: 'Full name is required.' });
      return;
    }
    if (!/^[6-9][0-9]{9}$/.test(mobile)) {
      res.status(400).json({ error: 'Enter a valid 10-digit mobile number.' });
      return;
    }
    if (!email || !email.includes('@')) {
      res.status(400).json({ error: 'Enter a valid email address.' });
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
      res.status(400).json({ error: 'Enter your full address.' });
      return;
    }
    if (!/^\d{12}$/.test(aadhaarNumber)) {
      res.status(400).json({ error: 'Aadhaar number must be 12 digits.' });
      return;
    }
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(panNumber)) {
      res.status(400).json({ error: 'Enter a valid PAN number.' });
      return;
    }
    if (!accountHolderName || !/^\d{9,18}$/.test(accountNumber)) {
      res.status(400).json({ error: 'Enter a valid bank account.' });
      return;
    }
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifscCode) || !bankName) {
      res.status(400).json({ error: 'Enter a valid IFSC code and bank name.' });
      return;
    }
    if (accountType !== 'Savings' && accountType !== 'Current') {
      res.status(400).json({ error: 'Account type must be Savings or Current.' });
      return;
    }
    if (!nomineeName || !relationship || !/^\d{12}$/.test(nomineeAadhaar)) {
      res.status(400).json({ error: 'Enter nominee name, relationship, and 12-digit Aadhaar.' });
      return;
    }
    if (nomineeMobile && !/^[6-9][0-9]{9}$/.test(nomineeMobile)) {
      res.status(400).json({ error: 'Enter a valid nominee mobile number.' });
      return;
    }
    if (nomineePan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(nomineePan)) {
      res.status(400).json({ error: 'Enter a valid nominee PAN number.' });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters.' });
      return;
    }
    if (!authorized) {
      res.status(400).json({ error: 'Please accept the terms to continue.' });
      return;
    }

    const existing = await resumeUnverifiedRegistration(clientId, mobile, email, password);
    if (existing === 'conflict') {
      res.status(409).json({ error: EMAIL_MOBILE_COMBO_ERROR });
      return;
    }
    if (existing) {
      sendCustomerSession(res, existing, 200, { resumed: true });
      return;
    }

    const passwordHash = await hashPassword(password);
    const referralCode = await uniqueReferralCode();
    const db = await pool.connect();

    try {
      await db.query('BEGIN');

      const created = await db.query(
        `INSERT INTO customers (
           client_id, full_name, mobile_number, email_address, date_of_birth,
           address, city, state, pin_code, password_hash, referral_code,
           referred_by_customer_id, authorized, status, mobile_verified
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, NULL, TRUE, 'active', FALSE)
         RETURNING id`,
        [
          clientId,
          fullName,
          mobile,
          email,
          dateOfBirth,
          address,
          city,
          state,
          pinCode,
          passwordHash,
          referralCode,
        ]
      );
      const customerId = created.rows[0].id as string;

      await db.query(
        `INSERT INTO kyc_documents (client_id, customer_id, aadhaar_number, pan_number)
         VALUES ($1,$2,$3,$4)`,
        [clientId, customerId, aadhaarNumber, panNumber]
      );
      await db.query(
        `INSERT INTO bank_accounts (
           client_id, customer_id, account_holder_name, account_number,
           ifsc_code, bank_name, account_type, is_primary
         ) VALUES ($1,$2,$3,$4,$5,$6,$7, TRUE)`,
        [clientId, customerId, accountHolderName, accountNumber, ifscCode, bankName, accountType]
      );
      await db.query(
        `INSERT INTO nominees (
           client_id, customer_id, nominee_name, relationship, nominee_aadhaar,
           nominee_mobile, nominee_pan
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          clientId,
          customerId,
          nomineeName,
          relationship,
          nomineeAadhaar,
          nomineeMobile || null,
          nomineePan || null,
        ]
      );

      await db.query('COMMIT');
      const customer = await loadCustomerAuth(customerId);
      if (!customer) {
        res.status(500).json({ error: 'Account was created but could not be loaded.' });
        return;
      }
      const token = signCustomerToken(customer.id, customer.mobileNumber, customer.clientId);
      res.status(201).json({
        token,
        customer: customerPayload(customer),
      });
    } catch (error) {
      await db.query('ROLLBACK');
      if (isEmailMobileComboDuplicate(error)) {
        const existing = await resumeUnverifiedRegistration(clientId, mobile, email, password);
        if (existing && existing !== 'conflict') {
          sendCustomerSession(res, existing, 200, { resumed: true });
          return;
        }
        res.status(409).json({ error: EMAIL_MOBILE_COMBO_ERROR });
        return;
      }
      throw error;
    } finally {
      db.release();
    }
  })
);

mobileAuthRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const identifier = text(req.body?.mobileOrEmail ?? req.body?.username);
    const password = String(req.body?.password ?? '');
    const clientCode = text(req.body?.clientCode).toUpperCase();
    if (!identifier || !password) {
      res.status(400).json({ error: 'Mobile/email and password are required.' });
      return;
    }

    const usingEmail = identifier.includes('@');
    const mobile = normalizeMobile(identifier);
    const email = normalizeEmail(identifier);
    if (!usingEmail && mobile.length !== 10) {
      res.status(400).json({ error: 'Enter a valid 10-digit mobile number or email.' });
      return;
    }
    if (!/^[A-Z0-9]{3,20}$/.test(clientCode)) {
      res.status(400).json({
        error: 'Enter the client code of the trader you are signing in to.',
      });
      return;
    }

    const result = await pool.query(
      `SELECT
         c.id, c.password_hash, c.status, c.full_name, c.mobile_number, c.email_address,
         c.customer_code, c.referral_code, c.mobile_verified, c.client_id,
         cl.name AS client_name, cl.client_code, cl.status AS client_status
       FROM customers c
       JOIN clients cl ON cl.id = c.client_id
       WHERE ${usingEmail ? 'lower(c.email_address) = $1' : 'c.mobile_number = $1'}
         AND lower(cl.client_code) = lower($2)`,
      [usingEmail ? email : mobile, clientCode]
    );

    const matches: typeof result.rows = [];
    for (const candidate of result.rows) {
      if (await verifyPassword(password, candidate.password_hash)) {
        matches.push(candidate);
      }
    }
    if (matches.length === 0) {
      res.status(401).json({ error: 'Invalid mobile/email, password, or client code.' });
      return;
    }
    if (matches.length > 1) {
      res.status(409).json({ error: 'More than one account matched this login. Contact ELVA.' });
      return;
    }
    const row = matches[0];
    if (row.status !== 'active') {
      res.status(403).json({ error: 'This account is inactive. Contact your trader.' });
      return;
    }
    if (row.client_status !== 'active') {
      res.status(403).json({ error: 'This client is inactive. Contact ELVA.' });
      return;
    }

    const customer: CustomerAuth = {
      id: row.id,
      fullName: row.full_name,
      mobileNumber: row.mobile_number,
      emailAddress: row.email_address,
      customerCode: row.customer_code,
      referralCode: row.referral_code,
      clientId: row.client_id,
      clientName: row.client_name,
      clientCode: row.client_code,
      mobileVerified: Boolean(row.mobile_verified),
    };
    const token = signCustomerToken(customer.id, customer.mobileNumber, customer.clientId);
    res.json({
      token,
      customer: customerPayload(customer),
    });
  })
);

mobileAuthRouter.post(
  '/verify-mobile',
  requireCustomer,
  asyncHandler(async (req, res) => {
    const { id: customerId } = (req as CustomerRequest).customer;
    await pool.query(
      `UPDATE customers
       SET mobile_verified = TRUE, updated_at = NOW()
       WHERE id = $1`,
      [customerId]
    );
    const customer = await loadCustomerAuth(customerId);
    if (!customer) {
      res.status(401).json({ error: 'Session is no longer valid.' });
      return;
    }
    res.json({ customer: customerPayload(customer) });
  })
);

mobileAuthRouter.get(
  '/me',
  requireCustomer,
  asyncHandler(async (req, res) => {
    const customer = (req as CustomerRequest).customer;
    res.json({ customer: customerPayload(customer) });
  })
);

async function findCustomerForRecovery(
  identifier: string,
  clientCode: string
): Promise<CustomerAuth | null> {
  const usingEmail = identifier.includes('@');
  const mobile = normalizeMobile(identifier);
  const email = normalizeEmail(identifier);
  if (!usingEmail && mobile.length !== 10) {
    return null;
  }
  const code = text(clientCode).toUpperCase();
  if (!/^[A-Z0-9]{3,20}$/.test(code)) {
    throw Object.assign(
      new Error('Enter the client code of the trader for this account.'),
      { status: 400 }
    );
  }
  const result = await pool.query(
    `SELECT
       c.id, c.full_name, c.mobile_number, c.email_address, c.customer_code,
       c.referral_code, c.status, c.mobile_verified, c.client_id,
       cl.name AS client_name, cl.client_code, cl.status AS client_status
     FROM customers c
     JOIN clients cl ON cl.id = c.client_id
     WHERE ${usingEmail ? 'lower(c.email_address) = $1' : 'c.mobile_number = $1'}
       AND lower(cl.client_code) = lower($2)`,
    [usingEmail ? email : mobile, code]
  );
  if (result.rows.length === 0) {
    return null;
  }
  if (result.rows.length > 1) {
    throw Object.assign(
      new Error('More than one account matched this login. Contact ELVA.'),
      { status: 409 }
    );
  }
  const row = result.rows[0];
  if (row.status !== 'active') {
    throw Object.assign(new Error('This account is inactive. Contact your trader.'), {
      status: 403,
    });
  }
  if (row.client_status !== 'active') {
    throw Object.assign(new Error('This client is inactive. Contact ELVA.'), { status: 403 });
  }
  return {
    id: row.id,
    fullName: row.full_name,
    mobileNumber: row.mobile_number,
    emailAddress: row.email_address,
    customerCode: row.customer_code,
    referralCode: row.referral_code,
    clientId: row.client_id,
    clientName: row.client_name,
    clientCode: row.client_code,
    mobileVerified: Boolean(row.mobile_verified),
  };
}

async function customerFromPasswordFlow(
  req: Parameters<typeof readToken>[0],
  mode: string,
  identifier: string
): Promise<CustomerAuth> {
  if (mode === 'changePassword' || mode === 'changeMpin') {
    const token = readToken(req);
    if (!token) {
      throw Object.assign(new Error('Please sign in to change your password.'), { status: 401 });
    }
    let payload;
    try {
      payload = verifyAuthToken(token);
    } catch {
      throw Object.assign(new Error('Please sign in to change your password.'), { status: 401 });
    }
    if (payload.role !== 'customer' || payload.purpose === 'password_reset') {
      throw Object.assign(new Error('Please sign in to change your password.'), { status: 401 });
    }
    const customer = await loadCustomerAuth(payload.sub);
    if (!customer) {
      throw Object.assign(new Error('Session is no longer valid.'), { status: 401 });
    }
    return customer;
  }

  if (!identifier) {
    throw Object.assign(
      new Error('Enter the mobile number or email on your account.'),
      { status: 400 }
    );
  }
  const customer = await findCustomerForRecovery(
    identifier,
    text((req as { body?: { clientCode?: unknown } }).body?.clientCode)
  );
  if (!customer) {
    throw Object.assign(
      new Error('No account was found for that mobile number or email.'),
      { status: 404 }
    );
  }
  return customer;
}

function httpError(error: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }) {
  const status = Number((error as { status?: number }).status ?? 0);
  const message = error instanceof Error ? error.message : 'Request failed.';
  if (status >= 400 && status < 500) {
    res.status(status).json({ error: message });
    return true;
  }
  return false;
}

mobileAuthRouter.post(
  '/otp/send',
  asyncHandler(async (req, res) => {
    const mode = text(req.body?.mode) || 'forgotPassword';
    const identifier = text(req.body?.email ?? req.body?.identifier);
    const action = text(req.body?.action) === 'resend' ? 'resend' : 'send';

    if (
      mode !== 'forgotPassword' &&
      mode !== 'changePassword' &&
      mode !== 'forgotMpin' &&
      mode !== 'changeMpin' &&
      mode !== 'registration'
    ) {
      res.status(400).json({ error: 'Unsupported OTP mode.' });
      return;
    }

    try {
      if (mode === 'registration') {
        const mobile = normalizeMobile(req.body?.mobileNumber ?? req.body?.mobile ?? identifier);
        if (!/^[6-9][0-9]{9}$/.test(mobile)) {
          res.status(400).json({ error: 'Enter a valid 10-digit mobile number.' });
          return;
        }
        const result = await callElvatechOtp(action, toOtpPhone(mobile));
        res.json({
          success: true,
          message: result.message || 'OTP sent successfully',
          expiresIn: result.expiresIn,
          requestId: result.requestId,
          maskedPhone: maskMobileNumber(mobile),
        });
        return;
      }

      const customer = await customerFromPasswordFlow(req, mode, identifier);
      const result = await callElvatechOtp(action, toOtpPhone(customer.mobileNumber));
      res.json({
        success: true,
        message: result.message,
        expiresIn: result.expiresIn,
        requestId: result.requestId,
        maskedPhone: maskMobileNumber(customer.mobileNumber),
      });
    } catch (error) {
      if (httpError(error, res)) {
        return;
      }
      const message = error instanceof Error ? error.message : 'OTP request failed.';
      res.status(400).json({ error: message });
    }
  })
);

mobileAuthRouter.post(
  '/otp/verify',
  asyncHandler(async (req, res) => {
    const mode = text(req.body?.mode) || 'forgotPassword';
    const identifier = text(req.body?.email ?? req.body?.identifier);
    const otp = String(req.body?.otp ?? '').replace(/\D/g, '');

    if (
      mode !== 'forgotPassword' &&
      mode !== 'changePassword' &&
      mode !== 'forgotMpin' &&
      mode !== 'changeMpin' &&
      mode !== 'registration'
    ) {
      res.status(400).json({ error: 'Unsupported OTP mode.' });
      return;
    }
    if (!/^\d{6}$/.test(otp)) {
      res.status(400).json({ error: 'Please enter a valid 6-digit OTP.' });
      return;
    }

    try {
      if (mode === 'registration') {
        const mobile = normalizeMobile(req.body?.mobileNumber ?? req.body?.mobile ?? identifier);
        if (!/^[6-9][0-9]{9}$/.test(mobile)) {
          res.status(400).json({ error: 'Enter a valid 10-digit mobile number.' });
          return;
        }
        const result = await callElvatechOtp('verify', toOtpPhone(mobile), otp);
        res.json({
          success: true,
          message: result.message || 'OTP verified successfully.',
          maskedPhone: maskMobileNumber(mobile),
        });
        return;
      }

      const customer = await customerFromPasswordFlow(req, mode, identifier);
      const result = await callElvatechOtp('verify', toOtpPhone(customer.mobileNumber), otp);
      const resetToken = signPasswordResetToken(customer.id, customer.mobileNumber);
      res.json({
        success: true,
        message: result.message,
        maskedPhone: maskMobileNumber(customer.mobileNumber),
        resetToken,
      });
    } catch (error) {
      if (httpError(error, res)) {
        return;
      }
      const message = error instanceof Error ? error.message : 'OTP verification failed.';
      res.status(400).json({ error: message });
    }
  })
);

mobileAuthRouter.post(
  '/reset-password',
  asyncHandler(async (req, res) => {
    const resetToken = text(req.body?.resetToken);
    const newPassword = String(req.body?.newPassword ?? '');
    if (!resetToken) {
      res.status(400).json({ error: 'Verify the OTP before setting a new password.' });
      return;
    }
    const passwordError = customerPasswordError(newPassword);
    if (passwordError) {
      res.status(400).json({ error: passwordError });
      return;
    }

    let customerId: string;
    try {
      const payload = verifyAuthToken(resetToken);
      if (payload.role !== 'customer' || payload.purpose !== 'password_reset') {
        res.status(401).json({ error: 'OTP verification expired. Please request a new OTP.' });
        return;
      }
      customerId = payload.sub;
    } catch {
      res.status(401).json({ error: 'OTP verification expired. Please request a new OTP.' });
      return;
    }

    const passwordHash = await hashPassword(newPassword);
    const updated = await pool.query(
      `UPDATE customers
       SET password_hash = $2, mobile_verified = TRUE, updated_at = NOW()
       WHERE id = $1
       RETURNING id`,
      [customerId, passwordHash]
    );
    if ((updated.rowCount ?? 0) === 0) {
      res.status(404).json({ error: 'Account not found.' });
      return;
    }

    const customer = await loadCustomerAuth(customerId);
    if (!customer) {
      res.status(403).json({ error: 'This account is inactive. Contact your trader.' });
      return;
    }
    const token = signCustomerToken(customer.id, customer.mobileNumber, customer.clientId);
    res.json({
      token,
      customer: customerPayload(customer),
      message: 'Password updated successfully.',
    });
  })
);
