import cookieParser from 'cookie-parser';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { authRouter } from './routes/auth.ts';
import { clientPortalRouter } from './routes/clientPortal.ts';
import { clientsRouter } from './routes/clients.ts';
import { dashboardRouter } from './routes/dashboard.ts';
import { mobileAuthRouter } from './routes/mobileAuth.ts';
import { mobilePortalRouter } from './routes/mobilePortal.ts';

export const app = express();
app.use(express.json());
app.use(cookieParser());
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api/auth', authRouter);
app.use('/api/mobile/auth', mobileAuthRouter);
app.use('/api/mobile', mobilePortalRouter);
app.use('/api/clients', clientsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/client-portal', clientPortalRouter);

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof SyntaxError) {
    res.status(400).json({ error: 'Invalid request body.' });
    return;
  }
  console.error(error);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});
