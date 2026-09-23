import { pool } from './db';
import type { AuthUser } from './types';

export type ClientSummary = {
  id: string;
  name: string;
  client_code: string;
  status: 'active' | 'inactive';
};

export async function findClientSummary(clientId: string) {
  const result = await pool.query<ClientSummary>(
    `SELECT id, name, client_code, status
     FROM clients
     WHERE id = $1
     LIMIT 1`,
    [clientId]
  );
  return result.rows[0] ?? null;
}

export function sessionUser(user: AuthUser, client: ClientSummary | null = null) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    fullName: user.fullName,
    clientId: user.clientId,
    clientName: client?.name ?? null,
    clientCode: client?.client_code ?? null,
  };
}
