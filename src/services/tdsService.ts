import { api } from '../lib/api';
import type { TdsDashboardData, TdsFilingRow, TdsQuarterSlice } from '../types/admin';

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapRow(row: Record<string, unknown>): TdsFilingRow {
  return {
    investment_id: String(row.investment_id ?? ''),
    customer_name: String(row.customer_name ?? ''),
    investment_code: String(row.investment_code ?? '—'),
    principal: asNumber(row.principal),
    gross_interest: asNumber(row.gross_interest),
    tds_percent: asNumber(row.tds_percent),
    tds_amount: asNumber(row.tds_amount),
    quarter: asNumber(row.quarter),
    period: String(row.period ?? ''),
  };
}

function mapQuarter(row: Record<string, unknown>): TdsQuarterSlice {
  return {
    quarter: asNumber(row.quarter),
    label: String(row.label ?? ''),
    amount: asNumber(row.amount),
    isCurrent: Boolean(row.isCurrent),
  };
}

export async function getTdsDashboard(): Promise<TdsDashboardData> {
  const payload = await api<TdsDashboardData>('/api/client-portal/tds');
  const kpis = payload.kpis ?? ({} as TdsDashboardData['kpis']);
  return {
    kpis: {
      totalTds: asNumber(kpis.totalTds),
      currentMonthTds: asNumber(kpis.currentMonthTds),
      currentFyTds: asNumber(kpis.currentFyTds),
      fyLabel: String(kpis.fyLabel ?? ''),
      fyShort: String(kpis.fyShort ?? ''),
    },
    rows: Array.isArray(payload.rows) ? payload.rows.map((row) => mapRow(row)) : [],
    quarters: Array.isArray(payload.quarters)
      ? payload.quarters.map((row) => mapQuarter(row))
      : [],
  };
}
