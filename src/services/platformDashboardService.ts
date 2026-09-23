import { api } from '../lib/api';
import type { PlatformDashboard } from '../types/platform';

export async function fetchPlatformDashboard(months = 6) {
  return api<PlatformDashboard>(`/api/dashboard?months=${months}`);
}
