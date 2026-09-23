import { api } from '../lib/api';
import type {
  WithdrawalDecision,
  WithdrawalFilter,
  WithdrawalListResult,
  WithdrawalListRow,
  WithdrawalStatus,
} from '../types/admin';

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asStatus(value: unknown): WithdrawalStatus {
  const status = String(value ?? 'Processing');
  if (
    status === 'On Hold' ||
    status === 'Approved' ||
    status === 'Paid' ||
    status === 'Rejected'
  ) {
    return status;
  }
  return 'Processing';
}

function mapRow(row: Record<string, unknown>): WithdrawalListRow {
  return {
    id: String(row.id ?? ''),
    status: asStatus(row.status),
    strategy: row.strategy === 'partial' ? 'partial' : 'full',
    customer_name: String(row.customer_name ?? ''),
    investment_code: String(row.investment_code ?? '—'),
    plan_name: String(row.plan_name ?? 'Active plan'),
    available_principal: asNumber(row.available_principal),
    withdrawal_amount: asNumber(row.withdrawal_amount),
    tds_amount: asNumber(row.tds_amount),
    tds_percent: asNumber(row.tds_percent),
    net_payout: asNumber(row.net_payout),
    bank_name: row.bank_name ? String(row.bank_name) : null,
    account_number: row.account_number ? String(row.account_number) : null,
    requested_on: String(row.requested_on ?? ''),
    updated_at: String(row.updated_at ?? ''),
    agreement_ok: Boolean(row.agreement_ok),
  };
}

export async function listWithdrawals(params: {
  filter: WithdrawalFilter;
  search: string;
  page: number;
  pageSize: number;
}): Promise<WithdrawalListResult> {
  const query = new URLSearchParams();
  query.set('filter', params.filter);
  if (params.search.trim()) query.set('q', params.search.trim());
  query.set('page', String(params.page));
  query.set('pageSize', String(params.pageSize));
  const payload = await api<WithdrawalListResult>(
    `/api/client-portal/withdrawals?${query.toString()}`
  );
  return {
    rows: Array.isArray(payload.rows) ? payload.rows.map((row) => mapRow(row)) : [],
    total: asNumber(payload.total),
    limit: asNumber(payload.limit) || params.pageSize,
    offset: asNumber(payload.offset),
  };
}

export async function decideWithdrawal(id: string, action: WithdrawalDecision) {
  const row = await api<Record<string, unknown>>(
    `/api/client-portal/withdrawals/${id}/decision`,
    {
      method: 'POST',
      body: JSON.stringify({ action }),
    }
  );
  return {
    id: String(row.id ?? id),
    status: asStatus(row.status),
    net_payout: asNumber(row.net_payout),
    withdrawal_amount: asNumber(row.withdrawal_amount),
    action,
  };
}

export type ActiveFundOption = {
  id: string;
  code: string;
  name: string;
  fund_amount: number;
  current_value: number;
  total_earnings: number;
  tds_percent: number;
};

export async function listActiveFunds(customerId: string): Promise<ActiveFundOption[]> {
  const payload = await api<{ funds: ActiveFundOption[] }>(
    `/api/client-portal/withdrawals/active-funds/${customerId}`
  );
  return Array.isArray(payload.funds) ? payload.funds : [];
}

export async function createWithdrawalRequest(input: {
  userId: string;
  investmentId: string;
  bankAccountId: string;
  strategy: 'full' | 'partial';
  amount: number;
}) {
  return api<{
    ok: boolean;
    id: string;
    status: WithdrawalStatus;
    withdrawal_amount: number;
  }>('/api/client-portal/withdrawals', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
