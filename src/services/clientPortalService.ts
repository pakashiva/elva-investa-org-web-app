import { api } from '../lib/api';
import type { ClientPortalDashboard } from '../types/platform';

export async function fetchClientPortalDashboard() {
  return api<ClientPortalDashboard>('/api/client-portal/dashboard');
}
