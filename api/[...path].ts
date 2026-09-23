import type { IncomingMessage, ServerResponse } from 'node:http';
import { app } from '../server/app';
import { ensureReady } from '../server/ready';

function sendJson(res: ServerResponse, status: number, body: Record<string, unknown>) {
  if (res.headersSent) {
    return;
  }
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function restoreApiPath(req: IncomingMessage) {
  const url = req.url ?? '/';
  if (url.startsWith('/api')) {
    return;
  }
  req.url = url === '/' ? '/api' : `/api${url.startsWith('/') ? url : `/${url}`}`;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    restoreApiPath(req);
    await ensureReady();
    await new Promise<void>((resolve, reject) => {
      res.once('finish', resolve);
      res.once('close', resolve);
      app(req as never, res as never, (error?: unknown) => {
        if (error) {
          reject(error);
        }
      });
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'API failed to start. Check Vercel environment variables.';
    sendJson(res, 500, { error: message });
  }
}
