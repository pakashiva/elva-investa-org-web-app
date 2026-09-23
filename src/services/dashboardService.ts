import { api } from '../lib/api';
import type { ChartRangeMonths, DashboardData } from '../types/admin';

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function getDashboard(months: ChartRangeMonths): Promise<DashboardData> {
  const payload = await api<{
    kpis: DashboardData['kpis'];
    wealthSeries: DashboardData['wealthSeries'];
    flowSeries: DashboardData['flowSeries'];
  }>(`/api/client-portal/dashboard?months=${months}`);

  const kpis = payload.kpis ?? ({} as DashboardData['kpis']);
  return {
    kpis: {
      totalWealthManaged: asNumber(kpis.totalWealthManaged),
      totalInvested: asNumber(kpis.totalInvested),
      activeInvestments: asNumber(kpis.activeInvestments),
      activeInvestmentsThisWeek: asNumber(kpis.activeInvestmentsThisWeek),
      interestPaidYtd: asNumber(kpis.interestPaidYtd),
      tdsDeductedYtd: asNumber(kpis.tdsDeductedYtd),
      totalWithdrawals: asNumber(kpis.totalWithdrawals),
      totalCustomers: asNumber(kpis.totalCustomers),
      newRegistrationsThisWeek: asNumber(kpis.newRegistrationsThisWeek),
      pendingRequests: asNumber(kpis.pendingRequests),
      pendingInvestments: asNumber(kpis.pendingInvestments),
      pendingWithdrawals: asNumber(kpis.pendingWithdrawals),
    },
    wealthSeries: Array.isArray(payload.wealthSeries) ? payload.wealthSeries : [],
    flowSeries: Array.isArray(payload.flowSeries) ? payload.flowSeries : [],
  };
}
