import { api } from '../lib/api';
import type {
  ClientDetailPayload,
  ClientRecord,
  ClientStatus,
  CreateClientInput,
  CustomerDetailsPayload,
  CustomerListItem,
  CustomerStatus,
  PlatformInvestmentRow,
  PlatformReferralRow,
  PlatformWithdrawalRow,
} from '../types/platform';

export async function listClients() {
  const data = await api<{ clients: ClientRecord[] }>('/api/clients');
  return data.clients;
}

export async function getClient(id: string) {
  return api<ClientDetailPayload>(`/api/clients/${id}`);
}

export async function createClient(input: CreateClientInput) {
  const data = await api<{ client: ClientRecord }>('/api/clients', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return data.client;
}

export async function setClientStatus(id: string, status: ClientStatus) {
  const data = await api<{ client: ClientRecord }>(`/api/clients/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
  return data.client;
}

function queryString(params: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      query.set(key, String(value));
    }
  }
  const suffix = query.toString();
  return suffix ? `?${suffix}` : '';
}

export async function listPlatformCustomers(
  clientId: string,
  params: { q?: string; status?: 'all' | CustomerStatus; page?: number; pageSize?: number }
) {
  return api<{ customers: CustomerListItem[]; total: number; page: number; pageSize: number }>(
    `/api/clients/${clientId}/customers${queryString(params)}`
  );
}

export async function getPlatformCustomer(clientId: string, customerId: string) {
  return api<CustomerDetailsPayload>(`/api/clients/${clientId}/customers/${customerId}`);
}

export async function listPlatformInvestments(
  clientId: string,
  params: { q?: string; filter?: string; page?: number; pageSize?: number }
) {
  return api<{ rows: PlatformInvestmentRow[]; total: number; page: number; pageSize: number }>(
    `/api/clients/${clientId}/investments${queryString(params)}`
  );
}

export async function listPlatformWithdrawals(
  clientId: string,
  params: { q?: string; filter?: string; page?: number; pageSize?: number }
) {
  return api<{ rows: PlatformWithdrawalRow[]; total: number; page: number; pageSize: number }>(
    `/api/clients/${clientId}/withdrawals${queryString(params)}`
  );
}

export async function listPlatformReferrals(clientId: string, params: { page?: number; pageSize?: number }) {
  return api<{
    kpis: {
      totalReferrals: number;
      grossCommission: number;
      tdsAmount: number;
      netCommission: number;
    };
    rows: PlatformReferralRow[];
    total: number;
    page: number;
    pageSize: number;
  }>(`/api/clients/${clientId}/referrals${queryString(params)}`);
}
