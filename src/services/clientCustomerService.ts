import { api } from '../lib/api';
import type {
  CreateCustomerInput,
  CustomerDetailsPayload,
  CustomerListFilter,
  CustomerListItem,
  CustomerStatus,
} from '../types/platform';

export type CustomerListResult = {
  customers: CustomerListItem[];
  total: number;
  page: number;
  pageSize: number;
};

export async function listClientCustomers(params: {
  q?: string;
  filter?: CustomerListFilter;
  status?: 'all' | CustomerStatus;
  sort?: 'joined_desc' | 'joined_asc';
  joinFrom?: string | null;
  joinTo?: string | null;
  page?: number;
  pageSize?: number;
}) {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.filter) query.set('filter', params.filter);
  if (params.status) query.set('status', params.status);
  if (params.sort) query.set('sort', params.sort);
  if (params.joinFrom) query.set('joinFrom', params.joinFrom);
  if (params.joinTo) query.set('joinTo', params.joinTo);
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('pageSize', String(params.pageSize));
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return api<CustomerListResult>(`/api/client-portal/customers${suffix}`);
}

export async function getClientCustomer(id: string) {
  return api<CustomerDetailsPayload>(`/api/client-portal/customers/${id}`);
}

export async function createCustomer(input: CreateCustomerInput) {
  return api<{
    ok: boolean;
    user_id: string;
    customer_id: string;
    customer: CustomerListItem;
  }>('/api/client-portal/customers', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function setCustomerStatus(id: string, status: CustomerStatus) {
  const data = await api<{ customer: CustomerListItem }>(
    `/api/client-portal/customers/${id}/status`,
    {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }
  );
  return data.customer;
}

export type UpdateCustomerProfileInput = {
  fullName: string;
  email: string;
  mobile: string;
  dateOfBirth: string;
  address: string;
  panNumber: string;
  aadhaarNumber: string;
  nomineeName: string;
  nomineeRelationship: string;
  nomineeAadhaar: string;
  nomineePan: string;
  nomineeMobile: string;
};

export async function updateCustomerProfile(id: string, input: UpdateCustomerProfileInput) {
  return api<CustomerDetailsPayload>(`/api/client-portal/customers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export type CustomerBankInput = {
  accountHolderName: string;
  bankName: string;
  accountNumber: string;
  ifscCode: string;
  accountType: 'Savings' | 'Current';
  isPrimary: boolean;
};

export async function addCustomerBank(id: string, input: CustomerBankInput) {
  return api<CustomerDetailsPayload>(`/api/client-portal/customers/${id}/banks`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateCustomerBank(id: string, bankId: string, input: CustomerBankInput) {
  return api<CustomerDetailsPayload>(`/api/client-portal/customers/${id}/banks/${bankId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function updateInvestmentBank(id: string, investmentId: string, bankAccountId: string) {
  return api<CustomerDetailsPayload>(
    `/api/client-portal/customers/${id}/investments/${investmentId}/bank`,
    {
      method: 'PATCH',
      body: JSON.stringify({ bankAccountId }),
    }
  );
}

export type { CreateCustomerInput };
