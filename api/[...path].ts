import type { IncomingMessage, ServerResponse } from 'node:http';

function sendJson(res: ServerResponse, status: number, body: Record<string, unknown>) {
  if (res.headersSent) {
    return;
  }
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function missingEnv(): string[] {
  const missing: string[] = [];
  if (!process.env.JWT_SECRET?.trim()) {
    missing.push('JWT_SECRET');
  }
  if (!process.env.SUPABASE_URL?.trim() && !process.env.DATABASE_URL?.trim()) {
    missing.push('SUPABASE_URL');
  }
  if (!process.env.SUPABASE_DB_PASSWORD?.trim() && !process.env.DATABASE_URL?.trim()) {
    missing.push('SUPABASE_DB_PASSWORD');
  }
  return missing;
}

function restoreApiPath(req: IncomingMessage) {
  const url = req.url ?? '/';
  if (url.startsWith('/api')) {
    return;
  }
  req.url = url === '/' ? '/api' : `/api${url.startsWith('/') ? url : `/${url}`}`;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const url = req.url ?? '/';
  if (req.method === 'GET' && (url === '/api/health' || url === '/health' || url === '/api')) {
    const missing = missingEnv();
    sendJson(res, missing.length ? 503 : 200, {
      ok: missing.length === 0,
      missing,
    });
    return;
  }

  try {
    const missing = missingEnv();
    if (missing.length > 0) {
      sendJson(res, 500, {
        error: `Missing Vercel environment variables: ${missing.join(', ')}. Add them under Project Settings → Environment Variables, then redeploy.`,
      });
      return;
    }

    restoreApiPath(req);
    const { app } = await import('../server/app.ts');
    const { ensureReady } = await import('../server/ready.ts');
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
