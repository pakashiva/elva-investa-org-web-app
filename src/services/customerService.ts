import { supabase } from '../lib/supabase';
import type {
  CustomerBankAccount,
  CustomerDetails,
  CustomerLedgerRow,
  CustomerListParams,
  CustomerListResult,
  CustomerListRow,
  CustomerProfile,
} from '../types/admin';
import { parseRpcError } from '../utils/format';

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapRow(row: Record<string, unknown>): CustomerListRow {
  return {
    user_id: String(row.user_id ?? ''),
    customer_id: row.customer_id ? String(row.customer_id) : null,
    full_name: String(row.full_name ?? ''),
    mobile_number: String(row.mobile_number ?? ''),
    email_address: String(row.email_address ?? ''),
    pan_number: row.pan_number ? String(row.pan_number) : null,
    active_investments: asNumber(row.active_investments),
    pending_investments: asNumber(row.pending_investments),
    closed_investments: asNumber(row.closed_investments),
    total_investments: asNumber(row.total_investments),
    total_invested: asNumber(row.total_invested),
    joined_at: String(row.joined_at ?? ''),
  };
}

export async function listCustomers(
  params: CustomerListParams
): Promise<CustomerListResult> {
  const offset = (params.page - 1) * params.pageSize;

  const { data, error } = await supabase.rpc('admin_list_customers', {
    p_filter: params.filter,
    p_search: params.search.trim() || null,
    p_join_from: params.joinFrom,
    p_join_to: params.joinTo,
    p_sort: params.sort,
    p_limit: params.pageSize,
    p_offset: offset,
  });

  if (error) {
    throw new Error(parseRpcError(error));
  }

  const payload = (data ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(payload.rows)
    ? payload.rows.map((row) => mapRow(row as Record<string, unknown>))
    : [];

  return {
    rows,
    total: asNumber(payload.total),
    limit: asNumber(payload.limit) || params.pageSize,
    offset: asNumber(payload.offset),
  };
}

function mapProfile(row: Record<string, unknown>): CustomerProfile {
  return {
    user_id: String(row.user_id ?? ''),
    customer_id: row.customer_id ? String(row.customer_id) : null,
    full_name: String(row.full_name ?? ''),
    mobile_number: String(row.mobile_number ?? ''),
    email_address: String(row.email_address ?? ''),
    date_of_birth: String(row.date_of_birth ?? ''),
    address: String(row.address ?? ''),
    city: String(row.city ?? ''),
    state: String(row.state ?? ''),
    pin_code: String(row.pin_code ?? ''),
    pan_number: row.pan_number ? String(row.pan_number) : null,
  };
}

function mapBank(row: Record<string, unknown>): CustomerBankAccount {
  return {
    id: String(row.id ?? ''),
    bank_name: String(row.bank_name ?? ''),
    account_number: String(row.account_number ?? ''),
    ifsc_code: String(row.ifsc_code ?? ''),
    account_type: String(row.account_type ?? 'Savings'),
    is_primary: Boolean(row.is_primary),
  };
}

function mapLedger(row: Record<string, unknown>): CustomerLedgerRow {
  const type = String(row.transaction_type ?? 'instant_credit');
  const status = String(row.status ?? 'Completed');

  return {
    id: String(row.id ?? ''),
    occurred_on: String(row.occurred_on ?? ''),
    transaction_type:
      type === 'withdrawal' || type === 'referral_bonus'
        ? type
        : 'instant_credit',
    amount: asNumber(row.amount),
    status: status === 'Pending' ? 'Pending' : 'Completed',
  };
}

export async function getCustomerDetails(userId: string): Promise<CustomerDetails> {
  const { data, error } = await supabase.rpc('admin_get_customer_details', {
    p_user_id: userId,
  });

  if (error) {
    throw new Error(parseRpcError(error));
  }

  const payload = (data ?? {}) as Record<string, unknown>;
  const profile = payload.profile as Record<string, unknown> | null;
  if (!profile) {
    throw new Error('Customer not found');
  }

  const summary = (payload.summary ?? {}) as Record<string, unknown>;

  return {
    profile: mapProfile(profile),
    account_active: Boolean(payload.account_active),
    summary: {
      total_invested: asNumber(summary.total_invested),
      active_plans: asNumber(summary.active_plans),
      returns_earned: asNumber(summary.returns_earned),
    },
    banks: Array.isArray(payload.banks)
      ? payload.banks.map((row) => mapBank(row as Record<string, unknown>))
      : [],
    transactions: Array.isArray(payload.transactions)
      ? payload.transactions.map((row) => mapLedger(row as Record<string, unknown>))
      : [],
  };
}

export type CreateCustomerInput = {
  fullName: string;
  email: string;
  mobile: string;
  dateOfBirth: string;
  nomineeName: string;
  nomineeRelationship: string;
  address: string;
  accountHolderName: string;
  accountNumber: string;
  ifscCode: string;
  branchName: string;
  accountType: 'Savings' | 'Current';
};

export type CreateCustomerResult = {
  ok: boolean;
  user_id: string;
  customer_id: string | null;
};

export async function createCustomer(
  input: CreateCustomerInput
): Promise<CreateCustomerResult> {
  const { data, error } = await supabase.rpc('admin_create_customer', {
    p_full_name: input.fullName,
    p_email: input.email,
    p_mobile: input.mobile,
    p_date_of_birth: input.dateOfBirth,
    p_nominee_name: input.nomineeName,
    p_nominee_relationship: input.nomineeRelationship,
    p_address: input.address,
    p_account_holder_name: input.accountHolderName,
    p_account_number: input.accountNumber,
    p_ifsc_code: input.ifscCode,
    p_branch_name: input.branchName,
    p_account_type: input.accountType,
  });

  if (error) {
    throw new Error(parseRpcError(error));
  }

  const row = (data ?? {}) as Record<string, unknown>;
  return {
    ok: Boolean(row.ok),
    user_id: String(row.user_id ?? ''),
    customer_id: row.customer_id ? String(row.customer_id) : null,
  };
}
