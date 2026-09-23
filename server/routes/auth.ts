import { Router } from 'express';
import {
  clearAuthCookie,
  findUserById,
  findUserByUsername,
  hashPassword,
  setAuthCookie,
  signAuthToken,
  toAuthUser,
  verifyPassword,
} from '../auth.ts';
import { pool } from '../db.ts';
import { asyncHandler, requireAuth } from '../middleware.ts';
import { provisionClient } from '../provisionClient.ts';
import { findClientSummary, sessionUser } from '../session.ts';
import type { AuthedRequest, UserRow } from '../types.ts';

export const authRouter = Router();

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const username = String(req.body?.username ?? '').trim();
    const password = String(req.body?.password ?? '');

    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required.' });
      return;
    }

    const row = await findUserByUsername(username);
    if (!row) {
      res.status(401).json({ error: 'Invalid username or password.' });
      return;
    }

    const ok = await verifyPassword(password, row.password_hash);
    if (!ok) {
      res.status(401).json({ error: 'Invalid username or password.' });
      return;
    }

    if (!row.is_active) {
      res.status(403).json({ error: 'This account is inactive.' });
      return;
    }

    const user = toAuthUser(row);
    let client = null;
    if (user.role === 'client_admin') {
      if (!user.clientId) {
        res.status(403).json({ error: 'This Client Admin is not linked to a client.' });
        return;
      }
      client = await findClientSummary(user.clientId);
      if (!client || client.status !== 'active') {
        res.status(403).json({ error: 'This client is inactive. Contact ELVA.' });
        return;
      }
    }

    const token = signAuthToken(user);
    setAuthCookie(res, token);
    res.json({ user: sessionUser(user, client), token });
  })
);

authRouter.post('/logout', (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

authRouter.post(
  '/change-password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = (req as AuthedRequest).auth;
    const oldPassword = String(req.body?.oldPassword ?? '');
    const newPassword = String(req.body?.newPassword ?? '');
    if (!oldPassword || !newPassword) {
      res.status(400).json({ error: 'Current and new passwords are required.' });
      return;
    }
    if (newPassword.length < 4) {
      res.status(400).json({ error: 'New password must be at least 4 characters.' });
      return;
    }
    const row = await findUserById(user.id);
    if (!row) {
      res.status(401).json({ error: 'Session is no longer valid.' });
      return;
    }
    const ok = await verifyPassword(oldPassword, row.password_hash);
    if (!ok) {
      res.status(400).json({ error: 'Current password is incorrect.' });
      return;
    }
    const passwordHash = await hashPassword(newPassword);
    await pool.query(
      `UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1`,
      [user.id, passwordHash]
    );
    res.json({ ok: true });
  })
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = (req as AuthedRequest).auth;
    let client = null;
    if (user.role === 'client_admin') {
      if (!user.clientId) {
        res.status(403).json({ error: 'This Client Admin is not linked to a client.' });
        return;
      }
      client = await findClientSummary(user.clientId);
      if (!client || client.status !== 'active') {
        res.status(403).json({ error: 'This client is inactive. Contact ELVA.' });
        return;
      }
    }
    res.json({ user: sessionUser(user, client) });
  })
);

authRouter.get(
  '/client-code/:code',
  asyncHandler(async (req, res) => {
    const code = String(req.params.code ?? '')
      .trim()
      .toUpperCase();
    if (!/^[A-Z0-9]{3,20}$/.test(code)) {
      res.status(400).json({ error: 'Client code must be 3–20 letters or numbers.' });
      return;
    }
    const result = await pool.query(
      `SELECT name, client_code FROM clients WHERE lower(client_code) = lower($1) LIMIT 1`,
      [code]
    );
    if (result.rowCount && result.rowCount > 0) {
      res.json({
        available: false,
        name: result.rows[0].name as string,
        clientCode: result.rows[0].client_code as string,
      });
      return;
    }
    res.json({ available: true, clientCode: code });
  })
);

authRouter.get(
  '/admin-username/:username',
  asyncHandler(async (req, res) => {
    const username = String(req.params.username ?? '')
      .trim()
      .toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) {
      res.status(400).json({ error: 'Admin username must be 3–40 characters (letters, numbers, . _ -).' });
      return;
    }
    const existing = await findUserByUsername(username);
    res.json({ available: !existing, username });
  })
);

authRouter.post(
  '/register-client',
  asyncHandler(async (req, res) => {
    const provisioned = await provisionClient(req.body ?? {}, {
      createdBy: null,
      forceStatus: 'active',
    });
    if (!provisioned.ok) {
      res.status(provisioned.status).json({ error: provisioned.error });
      return;
    }

    const result = await pool.query<UserRow & { name: string; client_code: string }>(
      `SELECT
         u.id,
         u.username,
         u.password_hash,
         u.role,
         u.client_id,
         u.full_name,
         u.is_active,
         c.name,
         c.client_code
       FROM users u
       JOIN clients c ON c.id = u.client_id
       WHERE u.client_id = $1 AND u.role = 'client_admin'
       LIMIT 1`,
      [provisioned.clientId]
    );
    const row = result.rows[0];
    if (!row) {
      res.status(500).json({ error: 'Client was created but the admin login could not be started.' });
      return;
    }
    const user = toAuthUser(row);
    const client = await findClientSummary(provisioned.clientId);
    const token = signAuthToken(user);
    setAuthCookie(res, token);
    res.status(201).json({
      client: {
        name: row.name,
        clientCode: row.client_code,
        adminFullName: row.full_name,
        adminUsername: row.username,
      },
      user: sessionUser(user, client),
      token,
    });
  })
);
