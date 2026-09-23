import type { NextFunction, Request, Response } from 'express';
import { findUserById, readToken, toAuthUser, verifyAuthToken } from './auth.ts';
import { pool } from './db.ts';
import type { AuthedRequest, CustomerAuth, CustomerRequest } from './types.ts';

export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    void handler(req, res, next).catch(next);
  };
}

export const requireAuth = asyncHandler(async (req, res, next) => {
  const token = readToken(req);
  if (!token) {
    res.status(401).json({ error: 'Please sign in.' });
    return;
  }

  try {
    const payload = verifyAuthToken(token);
    if (payload.role === 'customer') {
      res.status(403).json({ error: 'Customer accounts cannot use the admin portal.' });
      return;
    }
    const row = await findUserById(payload.sub);
    if (!row || !row.is_active) {
      res.status(401).json({ error: 'Session is no longer valid.' });
      return;
    }
    (req as AuthedRequest).auth = toAuthUser(row);
    next();
  } catch {
    res.status(401).json({ error: 'Please sign in.' });
  }
});

export const requireCustomer = asyncHandler(async (req, res, next) => {
  const token = readToken(req);
  if (!token) {
    res.status(401).json({ error: 'Please sign in.' });
    return;
  }

  try {
    const payload = verifyAuthToken(token);
    if (payload.role !== 'customer') {
      res.status(403).json({ error: 'Only customers can do this.' });
      return;
    }
    if (payload.purpose === 'password_reset') {
      res.status(403).json({ error: 'Finish setting your new password first.' });
      return;
    }

    const result = await pool.query(
      `SELECT
         c.id, c.full_name, c.mobile_number, c.email_address, c.customer_code,
         c.referral_code, c.status, c.mobile_verified, c.client_id,
         cl.name AS client_name, cl.client_code, cl.status AS client_status
       FROM customers c
       JOIN clients cl ON cl.id = c.client_id
       WHERE c.id = $1
       LIMIT 1`,
      [payload.sub]
    );
    const row = result.rows[0];
    if (!row || row.status !== 'active' || row.client_status !== 'active') {
      res.status(401).json({ error: 'Session is no longer valid.' });
      return;
    }
    if (!payload.clientId || payload.clientId !== row.client_id) {
      res.status(401).json({ error: 'This session does not belong to that trader. Sign in again.' });
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
    (req as CustomerRequest).customer = customer;
    next();
  } catch {
    res.status(401).json({ error: 'Please sign in.' });
  }
});

export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  const auth = (req as AuthedRequest).auth;
  if (!auth || auth.role !== 'super_admin') {
    res.status(403).json({ error: 'Only Super Admin can do this.' });
    return;
  }
  next();
}

export function requireClientAdmin(req: Request, res: Response, next: NextFunction) {
  const auth = (req as AuthedRequest).auth;
  if (!auth || auth.role !== 'client_admin' || !auth.clientId) {
    res.status(403).json({ error: 'Only Client Admin can do this.' });
    return;
  }
  next();
}
