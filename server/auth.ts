import bcrypt from 'bcryptjs';
import type { CookieOptions, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from './config.ts';
import { pool } from './db.ts';
import type { AuthUser, UserRole, UserRow } from './types.ts';

const cookieOptions: CookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL),
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

export type TokenPayload = {
  sub: string;
  role: UserRole | 'customer';
  username: string;
  purpose?: 'session' | 'password_reset';
  clientId?: string;
};

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, passwordHash: string) {
  return bcrypt.compare(password, passwordHash);
}

export function signAuthToken(user: AuthUser) {
  const payload: TokenPayload = {
    sub: user.id,
    role: user.role,
    username: user.username,
  };
  return jwt.sign(payload, config.jwtSecret, { expiresIn: '7d' });
}

export function signCustomerToken(customerId: string, mobileNumber: string, clientId: string) {
  if (!clientId) {
    throw new Error('Customer session must be bound to a trader.');
  }
  const payload: TokenPayload = {
    sub: customerId,
    role: 'customer',
    username: mobileNumber,
    purpose: 'session',
    clientId,
  };
  return jwt.sign(payload, config.jwtSecret, { expiresIn: '7d' });
}

export function signPasswordResetToken(customerId: string, mobileNumber: string) {
  const payload: TokenPayload = {
    sub: customerId,
    role: 'customer',
    username: mobileNumber,
    purpose: 'password_reset',
  };
  return jwt.sign(payload, config.jwtSecret, { expiresIn: '10m' });
}

export function setAuthCookie(res: Response, token: string) {
  res.cookie(config.cookieName, token, cookieOptions);
}

export function clearAuthCookie(res: Response) {
  res.clearCookie(config.cookieName, { path: '/' });
}

export function toAuthUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    fullName: row.full_name,
    clientId: row.client_id,
  };
}

export async function findUserByUsername(username: string) {
  const result = await pool.query<UserRow>(
    `SELECT id, username, password_hash, role, client_id, full_name, is_active
     FROM users
     WHERE lower(username) = lower($1)
     LIMIT 1`,
    [username.trim()]
  );
  return result.rows[0] ?? null;
}

export async function findUserById(id: string) {
  const result = await pool.query<UserRow>(
    `SELECT id, username, password_hash, role, client_id, full_name, is_active
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [id]
  );
  return result.rows[0] ?? null;
}

export function readToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    const bearer = header.slice(7).trim();
    if (bearer.length > 0) {
      return bearer;
    }
  }
  const cookie = req.cookies?.[config.cookieName];
  if (typeof cookie === 'string' && cookie.length > 0) {
    return cookie;
  }
  return null;
}

export function verifyAuthToken(token: string): TokenPayload {
  return jwt.verify(token, config.jwtSecret) as TokenPayload;
}
