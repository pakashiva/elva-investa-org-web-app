import type { IncomingMessage, ServerResponse } from 'node:http';
import { app } from '../server/app.ts';
import { ensureReady } from '../server/ready.ts';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    await ensureReady();
    app(req, res);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'API failed to start. Check Vercel environment variables.';
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: message }));
    }
  }
}
