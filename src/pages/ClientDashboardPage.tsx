import { useEffect, useState } from 'react';
import { useLocation, useOutletContext } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { FlowChart } from '../components/FlowChart';
import { KpiCard, KpiSkeleton } from '../components/KpiCard';
import { PendingActions } from '../components/PendingActions';
import { AllActivityPanel } from './AllActivityPage';
import { ErrorBanner } from '../components/States';
import { WealthChart } from '../components/WealthChart';
import { useDashboard } from '../hooks/useDashboard';
import { getBorrowOverview, type BorrowOverview } from '../services/borrowingService';
import type { AdminOutletContext } from '../layouts/AdminLayout';
import type { ChartRangeMonths } from '../types/admin';
import { formatCompactInr, formatSignedCount } from '../utils/format';

export function ClientDashboardPage() {
  const { onOpenMenu } = useOutletContext<AdminOutletContext>();
  const location = useLocation();
  const allWorkspace = new URLSearchParams(location.search).get('workspace') === 'all';
  const [months, setMonths] = useState<ChartRangeMonths>(6);
  const { data, isLoading, error, reload } = useDashboard(months);
  const [borrowing, setBorrowing] = useState<BorrowOverview | null>(null);
  const [borrowingError, setBorrowingError] = useState<string | null>(null);

  useEffect(() => {
    if (!allWorkspace) return;
    let active = true;
    void getBorrowOverview().then((result) => { if (active) setBorrowing(result); }).catch((err) => {
      if (active) setBorrowingError(err instanceof Error ? err.message : 'Unable to load borrowing dashboard data.');
    });
    return () => { active = false; };
  }, [allWorkspace]);

  const workspaceSuffix = allWorkspace ? '?workspace=all' : '';
  const pendingHref = allWorkspace ? `/all${workspaceSuffix}` :
    (data?.kpis.pendingWithdrawals ?? 0) > (data?.kpis.pendingInvestments ?? 0)
      ? '/withdrawals'
      : '/investment-requests';

  return (
    <>
      <AppHeader
        title="Operational Dashboard"
        subtitle="Overview of systemic capital, actions, and pending flows."
        onOpenMenu={onOpenMenu}
      />

      {error ? <ErrorBanner message={error} onRetry={() => void reload()} /> : null}
      {allWorkspace && borrowingError ? <ErrorBanner message={borrowingError} onRetry={() => void getBorrowOverview().then(setBorrowing).catch((err) => setBorrowingError(err instanceof Error ? err.message : 'Unable to load borrowing dashboard data.'))} /> : null}

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
              to={`/investment-requests${workspaceSuffix}`}
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
              to={`/tds${workspaceSuffix}`}
            />
            <KpiCard
              label="TOTAL WITHDRAWALS"
              value={formatCompactInr(data.kpis.totalWithdrawals)}
              subtext="Payout requests processed"
              to={`/withdrawals${workspaceSuffix}`}
            />
            <KpiCard
              label="TOTAL CUSTOMERS"
              value={data.kpis.totalCustomers.toLocaleString('en-IN')}
              subtext={`${formatSignedCount(data.kpis.newRegistrationsThisWeek)} new registrations`}
              to={`/customers${workspaceSuffix}`}
            />
            <KpiCard
              label="PENDING REQUESTS"
              value={`${data.kpis.pendingRequests + (allWorkspace ? Number(borrowing?.stats.pending ?? 0) : 0)} Actionable`}
              subtext={allWorkspace ? 'Investment + borrowing reviews' : 'Review required'}
              highlight
              to={pendingHref}
            />
            {allWorkspace ? <>
              <KpiCard label="ACTIVE LOANS" value={String(borrowing?.stats.active ?? '—')} subtext="Borrowing accounts" />
              <KpiCard label="ACTIVE BORROWERS" value={String(borrowing?.stats.borrowers ?? '—')} subtext="Customers with borrowing access" />
              <KpiCard label="LOAN OUTSTANDING" value={borrowing ? formatCompactInr(Number(borrowing.stats.outstanding)) : '—'} subtext="Scheduled principal and dues" />
              <KpiCard label="LOAN REQUESTS PENDING" value={String(borrowing?.stats.pending ?? '—')} subtext="Awaiting admin review" highlight />
            </> : null}
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

      {allWorkspace ? <AllActivityPanel /> : null}

      {!isLoading ? (
        <PendingActions
          pendingInvestments={data?.kpis.pendingInvestments ?? 0}
          pendingWithdrawals={data?.kpis.pendingWithdrawals ?? 0}
          pendingBorrowing={allWorkspace ? borrowing?.stats.pending ?? 0 : 0}
          allWorkspace={allWorkspace}
        />
      ) : null}
    </>
  );
}
