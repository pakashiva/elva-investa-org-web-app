import type { IncomingMessage, ServerResponse } from 'node:http';

function sendJson(res: ServerResponse, status: number, body: Record<string, unknown>) {
  if (res.headersSent) {
    return;
  }
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const bundled = await import('./handler.bundle.js');
    await bundled.default(req, res);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'API function failed to load.';
    console.error(error);
    sendJson(res, 500, { error: message });
  }
}
