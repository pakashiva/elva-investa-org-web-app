import { api } from '../lib/api';
import type { ReferralListRow, ReferralPayoutStatus, ReferralsPageData } from '../types/admin';

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asStatus(value: unknown): ReferralPayoutStatus {
  return String(value) === 'Paid' ? 'Paid' : 'Pending';
}

function mapRow(row: Record<string, unknown>): ReferralListRow {
  return {
    id: String(row.id ?? ''),
    status: asStatus(row.status),
    referrer_user_id: String(row.referrer_user_id ?? ''),
    referred_user_id: String(row.referred_user_id ?? ''),
    referrer_name: String(row.referrer_name ?? 'Referrer'),
    referred_name: String(row.referred_name ?? 'Referred customer'),
    investment_id: String(row.investment_id ?? ''),
    investment_code: row.investment_code ? String(row.investment_code) : null,
    referral_code: String(row.referral_code ?? ''),
    capital_amount: asNumber(row.capital_amount),
    referral_rate: asNumber(row.referral_rate),
    gross_bonus: asNumber(row.gross_bonus),
    tds_rate: asNumber(row.tds_rate),
    tds_amount: asNumber(row.tds_amount),
    net_bonus: asNumber(row.net_bonus),
    lifetime_paid_net: asNumber(row.lifetime_paid_net),
    created_at: String(row.created_at ?? ''),
  };
}

export async function listReferrals(params: {
  page: number;
  pageSize: number;
}): Promise<ReferralsPageData> {
  const query = new URLSearchParams();
  query.set('page', String(params.page));
  query.set('pageSize', String(params.pageSize));
  const payload = await api<ReferralsPageData>(`/api/client-portal/referrals?${query.toString()}`);
  return {
    settings: {
      referral_rate: asNumber(payload.settings?.referral_rate) || 0.01,
      tds_rate: asNumber(payload.settings?.tds_rate) || 0.02,
    },
    kpis: {
      totalReferrals: asNumber(payload.kpis?.totalReferrals),
      grossCommission: asNumber(payload.kpis?.grossCommission),
      tdsAmount: asNumber(payload.kpis?.tdsAmount),
      netCommission: asNumber(payload.kpis?.netCommission),
    },
    rows: Array.isArray(payload.rows) ? payload.rows.map((row) => mapRow(row)) : [],
    total: asNumber(payload.total),
    limit: asNumber(payload.limit) || params.pageSize,
    offset: asNumber(payload.offset),
  };
}

export async function decideReferral(id: string, action: 'pay' | 'hold') {
  const row = await api<Record<string, unknown>>(`/api/client-portal/referrals/${id}/decision`, {
    method: 'POST',
    body: JSON.stringify({ action }),
  });
  return {
    id: String(row.id ?? id),
    status: asStatus(row.status),
    net_bonus: asNumber(row.net_bonus),
    action,
  };
}
