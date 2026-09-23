import { api } from '../lib/api';
import type {
  AgreementRenewalDetail,
  AgreementRenewalMode,
  ApprovedInvestmentEdit,
  InvestmentDecision,
  InvestmentQueueKind,
  InvestmentRequestDetail,
  InvestmentRequestFilter,
  InvestmentRequestListResult,
  InvestmentRequestListRow,
  InvestmentRequestStatus,
  RenewalDecision,
  UpdateApprovedInvestmentInput,
} from '../types/admin';

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asStatus(value: unknown): InvestmentRequestStatus {
  const status = String(value ?? 'Pending');
  if (
    status === 'Under Review' ||
    status === 'Active' ||
    status === 'Closed' ||
    status === 'Approved' ||
    status === 'Rejected'
  ) {
    return status;
  }
  return 'Pending';
}

function asKind(value: unknown): InvestmentQueueKind {
  return value === 'renewal' ? 'renewal' : 'investment';
}

function asMode(value: unknown): AgreementRenewalMode | null {
  return value === 'increase' || value === 'same_amount' ? value : null;
}

function mapListRow(row: Record<string, unknown>): InvestmentRequestListRow {
  return {
    id: String(row.id ?? ''),
    kind: asKind(row.kind),
    code: row.code ? String(row.code) : null,
    request_id: row.request_id ? String(row.request_id) : null,
    customer_name: String(row.customer_name ?? ''),
    customer_id: row.customer_id ? String(row.customer_id) : null,
    plan_name: String(row.plan_name ?? 'New Fund Request'),
    fund_amount: asNumber(row.fund_amount),
    status: asStatus(row.status),
    created_at: String(row.created_at ?? ''),
    mode: asMode(row.mode),
    increment_amount: row.increment_amount == null ? null : asNumber(row.increment_amount),
    agreement_id: row.agreement_id ? String(row.agreement_id) : null,
  };
}

export async function listInvestmentRequests(params: {
  filter: InvestmentRequestFilter;
  search: string;
  page: number;
  pageSize: number;
}): Promise<InvestmentRequestListResult> {
  const query = new URLSearchParams();
  query.set('filter', params.filter);
  if (params.search.trim()) query.set('q', params.search.trim());
  query.set('page', String(params.page));
  query.set('pageSize', String(params.pageSize));
  const payload = await api<InvestmentRequestListResult>(
    `/api/client-portal/investments?${query.toString()}`
  );
  return {
    rows: Array.isArray(payload.rows) ? payload.rows.map((row) => mapListRow(row)) : [],
    total: asNumber(payload.total),
    limit: asNumber(payload.limit) || params.pageSize,
    offset: asNumber(payload.offset),
  };
}

const PAYOUT_DAY_OPTIONS = [1, 5, 10, 15, 20, 25] as const;

function asPayoutDay(value: unknown): number {
  const parsed = Number(value);
  if (PAYOUT_DAY_OPTIONS.includes(parsed as (typeof PAYOUT_DAY_OPTIONS)[number])) {
    return parsed;
  }
  return 10;
}

export async function getInvestmentRequest(id: string): Promise<InvestmentRequestDetail> {
  const row = await api<Record<string, unknown>>(`/api/client-portal/investments/${id}`);
  const bank = row.bank as Record<string, unknown> | null;

  return {
    id: String(row.id ?? ''),
    code: row.code ? String(row.code) : null,
    request_id: row.request_id ? String(row.request_id) : null,
    status: asStatus(row.status),
    plan_name: String(row.plan_name ?? 'New Fund Request'),
    fund_amount: asNumber(row.fund_amount),
    interest_rate: asNumber(row.interest_rate),
    tds_percent: asNumber(row.tds_percent),
    payout_day: asPayoutDay(row.payout_day),
    referral_rate: asNumber(row.referral_rate) || 0.01,
    referral_tds_rate: asNumber(row.referral_tds_rate) || 0.02,
    referral_code: row.referral_code ? String(row.referral_code) : null,
    referrer_user_id: row.referrer_user_id ? String(row.referrer_user_id) : null,
    referrer_name: row.referrer_name ? String(row.referrer_name) : null,
    created_at: String(row.created_at ?? ''),
    user_id: String(row.user_id ?? ''),
    customer_name: String(row.customer_name ?? ''),
    customer_id: row.customer_id ? String(row.customer_id) : null,
    active_portfolio: asNumber(row.active_portfolio),
    active_plans: asNumber(row.active_plans),
    bank: bank
      ? {
          bank_name: String(bank.bank_name ?? ''),
          account_number: String(bank.account_number ?? ''),
          ifsc_code: String(bank.ifsc_code ?? ''),
        }
      : null,
  };
}

export async function updateInvestmentTerms(
  id: string,
  interestRate: number,
  tdsPercent: number,
  payoutDay: number,
  referralRate?: number
): Promise<void> {
  await api(`/api/client-portal/investments/${id}/terms`, {
    method: 'PATCH',
    body: JSON.stringify({
      interestRate,
      tdsPercent,
      payoutDay,
      referralRate,
    }),
  });
}

export async function getAgreementRenewal(id: string): Promise<AgreementRenewalDetail> {
  const row = await api<Record<string, unknown>>(`/api/client-portal/investments/renewals/${id}`);
  const bank = row.bank as Record<string, unknown> | null;
  const status = String(row.status ?? 'Pending');
  return {
    id: String(row.id ?? ''),
    kind: 'renewal',
    status: status === 'Approved' || status === 'Rejected' ? status : 'Pending',
    mode: asMode(row.mode) ?? 'same_amount',
    agreement_id: String(row.agreement_id ?? ''),
    customer_id: row.customer_id ? String(row.customer_id) : null,
    customer_name: String(row.customer_name ?? ''),
    current_amount: asNumber(row.current_amount),
    increment_amount: row.increment_amount == null ? null : asNumber(row.increment_amount),
    new_principal: asNumber(row.new_principal),
    created_at: String(row.created_at ?? ''),
    user_id: String(row.user_id ?? ''),
    investment_id: String(row.investment_id ?? ''),
    plan_no: row.plan_no ? String(row.plan_no) : null,
    plan_name: String(row.plan_name ?? ''),
    investment_status: String(row.investment_status ?? ''),
    fund_amount: asNumber(row.fund_amount),
    interest_rate: asNumber(row.interest_rate),
    tds_percent: asNumber(row.tds_percent),
    payout_day: asPayoutDay(row.payout_day),
    invested_date: row.invested_date ? String(row.invested_date) : null,
    bank: bank
      ? {
          bank_name: String(bank.bank_name ?? ''),
          account_number: String(bank.account_number ?? ''),
          ifsc_code: String(bank.ifsc_code ?? ''),
        }
      : null,
  };
}

export async function decideAgreementRenewal(id: string, action: RenewalDecision) {
  const row = await api<Record<string, unknown>>(
    `/api/client-portal/investments/renewals/${id}/decision`,
    {
      method: 'POST',
      body: JSON.stringify({ action }),
    }
  );
  const status = String(row.status ?? '');
  return {
    id: String(row.id ?? id),
    status: status === 'Approved' || status === 'Rejected' ? status : status,
    fund_amount: asNumber(row.fund_amount),
    action,
  };
}

export async function decideInvestment(id: string, action: InvestmentDecision) {
  const row = await api<Record<string, unknown>>(`/api/client-portal/investments/${id}/decision`, {
    method: 'POST',
    body: JSON.stringify({ action }),
  });

  return {
    id: String(row.id ?? id),
    request_id: row.request_id ? String(row.request_id) : null,
    status: asStatus(row.status),
    fund_amount: asNumber(row.fund_amount),
    action,
  };
}

export type CustomerOption = {
  user_id: string;
  customer_id: string | null;
  full_name: string;
  mobile_number: string;
  investment_count: number;
};

export type CustomerBankOption = {
  id: string;
  account_number: string;
  branch_name: string;
  bank_name: string;
  ifsc_code: string;
  account_type: string;
  is_primary: boolean;
};

export async function listCustomerOptions(search = ''): Promise<CustomerOption[]> {
  const query = new URLSearchParams();
  if (search.trim()) query.set('q', search.trim());
  query.set('limit', '50');
  const suffix = query.toString() ? `?${query.toString()}` : '';
  const payload = await api<{ options: CustomerOption[] }>(
    `/api/client-portal/investments/customer-options${suffix}`
  );
  return Array.isArray(payload.options) ? payload.options : [];
}

export async function listCustomerBanks(userId: string): Promise<CustomerBankOption[]> {
  const payload = await api<{ banks: CustomerBankOption[] }>(
    `/api/client-portal/investments/customer-banks/${userId}`
  );
  return Array.isArray(payload.banks) ? payload.banks : [];
}

export type CreateInvestmentInput = {
  userId: string;
  amount: number;
  bankAccountId: string;
  fundTitle: string;
};

function localDigits(value: unknown): string {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export async function getApprovedInvestmentEdit(id: string): Promise<ApprovedInvestmentEdit> {
  const row = await api<Record<string, unknown>>(`/api/client-portal/investments/${id}/approved-edit`);
  const customer = (row.customer ?? {}) as Record<string, unknown>;
  const bank = row.bank as Record<string, unknown> | null;
  const nominee = row.nominee as Record<string, unknown> | null;
  const agreement = row.agreement as Record<string, unknown> | null;
  const dob = customer.date_of_birth ? String(customer.date_of_birth).slice(0, 10) : '';

  return {
    id: String(row.id ?? ''),
    code: row.code ? String(row.code) : null,
    request_id: row.request_id ? String(row.request_id) : null,
    status: asStatus(row.status),
    user_id: String(row.user_id ?? ''),
    customer_id: row.customer_id ? String(row.customer_id) : null,
    plan_name: String(row.plan_name ?? ''),
    fund_amount: asNumber(row.fund_amount),
    interest_rate: asNumber(row.interest_rate),
    tds_percent: asNumber(row.tds_percent),
    payout_day: asPayoutDay(row.payout_day),
    customer: {
      full_name: String(customer.full_name ?? ''),
      email: String(customer.email ?? ''),
      mobile: localDigits(customer.mobile),
      date_of_birth: dob,
      address: String(customer.address ?? ''),
      pan: String(customer.pan ?? ''),
      aadhaar: String(customer.aadhaar ?? '').replace(/\D/g, ''),
    },
    bank: bank
      ? {
          id: String(bank.id ?? ''),
          bank_name: String(bank.bank_name ?? ''),
          account_number: String(bank.account_number ?? ''),
          ifsc_code: String(bank.ifsc_code ?? ''),
          account_type: String(bank.account_type ?? 'Savings'),
          account_holder_name: String(bank.account_holder_name ?? ''),
          branch_name: String(bank.branch_name ?? ''),
        }
      : null,
    nominee: nominee
      ? {
          name: String(nominee.name ?? ''),
          relation: String(nominee.relation ?? ''),
          aadhaar: String(nominee.aadhaar ?? '').replace(/\D/g, ''),
          pan: String(nominee.pan ?? ''),
          mobile: localDigits(nominee.mobile),
        }
      : null,
    agreement: agreement
      ? {
          officeId: agreement.officeId ? String(agreement.officeId) : null,
          placeName: String(agreement.placeName ?? agreement.branch ?? ''),
          cheque_no: String(agreement.cheque_no ?? ''),
          cheque_bank_name: String(agreement.cheque_bank_name ?? ''),
          cheque_bank_address: String(agreement.cheque_bank_address ?? ''),
        }
      : null,
  };
}

export async function updateApprovedInvestment(input: UpdateApprovedInvestmentInput): Promise<void> {
  await api(`/api/client-portal/investments/${input.id}/approved`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function cancelApprovedInvestment(id: string): Promise<void> {
  await api(`/api/client-portal/investments/${id}/cancel`, {
    method: 'POST',
  });
}

export async function createInvestmentRequest(input: CreateInvestmentInput) {
  const row = await api<Record<string, unknown>>('/api/client-portal/investments', {
    method: 'POST',
    body: JSON.stringify({
      userId: input.userId,
      amount: input.amount,
      bankAccountId: input.bankAccountId,
      fundTitle: input.fundTitle.trim(),
    }),
  });

  return {
    ok: Boolean(row.ok),
    id: String(row.id ?? ''),
    user_id: String(row.user_id ?? ''),
    customer_id: row.customer_id ? String(row.customer_id) : null,
    fund_amount: asNumber(row.fund_amount),
    status: asStatus(row.status),
  };
}
