import type { IncomingMessage, ServerResponse } from 'node:http';
import { app } from './app';
import { ensureReady } from './ready';

function restoreApiPath(req: IncomingMessage) {
  const raw = req.url ?? '/';
  try {
    const url = new URL(raw, 'http://local');
    const forwarded = url.searchParams.get('p');
    if (forwarded) {
      url.searchParams.delete('p');
      const query = url.searchParams.toString();
      req.url = `/api/${forwarded.replace(/^\//, '')}${query ? `?${query}` : ''}`;
      return;
    }
  } catch {
    // keep the original url
  }

  if (!raw.startsWith('/api')) {
    req.url = raw === '/' ? '/api' : `/api${raw.startsWith('/') ? raw : `/${raw}`}`;
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
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
}
