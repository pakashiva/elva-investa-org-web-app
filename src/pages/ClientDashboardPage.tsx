import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { FlowChart } from '../components/FlowChart';
import { KpiCard, KpiSkeleton } from '../components/KpiCard';
import { PendingActions } from '../components/PendingActions';
import { ErrorBanner } from '../components/States';
import { WealthChart } from '../components/WealthChart';
import { useDashboard } from '../hooks/useDashboard';
import type { AdminOutletContext } from '../layouts/AdminLayout';
import type { ChartRangeMonths } from '../types/admin';
import { formatCompactInr, formatSignedCount } from '../utils/format';

export function ClientDashboardPage() {
  const { onOpenMenu } = useOutletContext<AdminOutletContext>();
  const [months, setMonths] = useState<ChartRangeMonths>(6);
  const { data, isLoading, error, reload } = useDashboard(months);

  const pendingHref =
    (data?.kpis.pendingWithdrawals ?? 0) > (data?.kpis.pendingInvestments ?? 0)
      ? '/withdrawals'
      : '/investment-requests';

  return (
    <>
      <AppHeader
        title="Operational Dashboard"
        subtitle="Overview of systemic capital, actions, and pending flows."
        showSearch
        onOpenMenu={onOpenMenu}
      />

      {error ? <ErrorBanner message={error} onRetry={() => void reload()} /> : null}

      <section className="kpi-grid">
        {isLoading || !data ? (
          Array.from({ length: 8 }).map((_, index) => <KpiSkeleton key={index} />)
        ) : (
          <>
            <KpiCard
              label="TOTAL WEALTH MANAGED"
              value={formatCompactInr(data.kpis.totalWealthManaged)}
              subtext="Active assets"
            />
            <KpiCard
              label="TOTAL INVESTED"
              value={formatCompactInr(data.kpis.totalInvested)}
              subtext="Current active books"
            />
            <KpiCard
              label="ACTIVE INVESTMENTS"
              value={`${data.kpis.activeInvestments.toLocaleString('en-IN')} Plans`}
              subtext={`${formatSignedCount(data.kpis.activeInvestmentsThisWeek)} this week`}
              to="/investment-requests"
            />
            <KpiCard
              label="INTEREST PAID YTD"
              value={formatCompactInr(data.kpis.interestPaidYtd)}
              subtext="To investor balances"
            />
            <KpiCard
              label="TDS DEDUCTED YTD"
              value={formatCompactInr(data.kpis.tdsDeductedYtd)}
              subtext="Tax deposits"
              to="/tds"
            />
            <KpiCard
              label="TOTAL WITHDRAWALS"
              value={formatCompactInr(data.kpis.totalWithdrawals)}
              subtext="Payout requests processed"
              to="/withdrawals"
            />
            <KpiCard
              label="TOTAL CUSTOMERS"
              value={data.kpis.totalCustomers.toLocaleString('en-IN')}
              subtext={`${formatSignedCount(data.kpis.newRegistrationsThisWeek)} new registrations`}
              to="/customers"
            />
            <KpiCard
              label="PENDING REQUESTS"
              value={`${data.kpis.pendingRequests} Actionable`}
              subtext="Review required"
              highlight
              to={pendingHref}
            />
          </>
        )}
      </section>

      <section className="charts-grid">
        {isLoading ? (
          <>
            <div className="card chart-card">
              <p className="state-box">Loading wealth series…</p>
            </div>
            <div className="card chart-card">
              <p className="state-box">Loading inflow and outflow…</p>
            </div>
          </>
        ) : (
          <>
            <WealthChart
              points={data?.wealthSeries ?? []}
              months={months}
              onMonthsChange={setMonths}
            />
            <FlowChart points={data?.flowSeries ?? []} />
          </>
        )}
      </section>

      {!isLoading ? (
        <PendingActions
          pendingInvestments={data?.kpis.pendingInvestments ?? 0}
          pendingWithdrawals={data?.kpis.pendingWithdrawals ?? 0}
        />
      ) : null}
    </>
  );
}
