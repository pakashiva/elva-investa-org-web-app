import { pool } from './db';
import type { AuthUser } from './types';

export type ClientSummary = {
  id: string;
  name: string;
  client_code: string;
  status: 'active' | 'inactive';
  enabled_modules: string[];
};

export async function findClientSummary(clientId: string) {
  // Repair older tenant rows where borrowing records/products exist but the
  // module flag was not saved. This keeps navigation, routes, and API checks
  // aligned after logout/login without asking the client to register again.
  await pool.query(
    `UPDATE clients c
       SET enabled_modules=array_append(COALESCE(c.enabled_modules,ARRAY['invest']::text[]),'borrow'),
           updated_at=NOW()
     WHERE c.id=$1
       AND NOT ('borrow'=ANY(COALESCE(c.enabled_modules,ARRAY['invest']::text[])))
       AND (
         EXISTS (SELECT 1 FROM loan_products lp WHERE lp.client_id=c.id AND lp.status='active')
         OR EXISTS (SELECT 1 FROM borrowers b WHERE b.client_id=c.id)
         OR EXISTS (SELECT 1 FROM loans l WHERE l.client_id=c.id)
       )`,
    [clientId]
  );
  const result = await pool.query<ClientSummary>(
    `SELECT c.id, c.name, c.client_code, c.status,
            CASE WHEN (
              EXISTS (SELECT 1 FROM loan_products lp WHERE lp.client_id=c.id AND lp.status='active')
              OR EXISTS (SELECT 1 FROM borrowers b WHERE b.client_id=c.id)
              OR EXISTS (SELECT 1 FROM loans l WHERE l.client_id=c.id)
            ) AND NOT ('borrow'=ANY(COALESCE(c.enabled_modules,ARRAY['invest']::text[])))
              THEN array_append(COALESCE(c.enabled_modules,ARRAY['invest']::text[]),'borrow')
              ELSE COALESCE(c.enabled_modules,ARRAY['invest']::text[])
            END AS enabled_modules
     FROM clients c
     WHERE c.id = $1
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
    enabledModules: client?.enabled_modules ?? ['invest'],
  };
}
