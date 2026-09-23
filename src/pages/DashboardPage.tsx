import { useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { FlowChart } from '../components/FlowChart';
import { KpiCard, KpiSkeleton } from '../components/KpiCard';
import { EmptyState, ErrorBanner } from '../components/States';
import { WealthChart } from '../components/WealthChart';
import type { AdminOutletContext } from '../layouts/AdminLayout';
import { fetchPlatformDashboard } from '../services/platformDashboardService';
import type { ChartRangeMonths } from '../types/admin';
import type { PlatformDashboard } from '../types/platform';
import { formatCompactInr, formatDate, formatInr } from '../utils/format';

export function DashboardPage() {
  const { onOpenMenu } = useOutletContext<AdminOutletContext>();
  const [months, setMonths] = useState<ChartRangeMonths>(6);
  const [data, setData] = useState<PlatformDashboard | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setIsLoading(true);
    setError(null);
    try {
      setData(await fetchPlatformDashboard(months));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load dashboard.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [months]);

  return (
    <>
      <AppHeader
        title="Platform Dashboard"
        subtitle="ELVA Investa clients, customers, and invested capital across all tenants."
        onOpenMenu={onOpenMenu}
        actions={
          <Link className="primary-btn" to="/clients/new">
            + Add Client
          </Link>
        }
      />

      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

      <section className="kpi-grid">
        {isLoading || !data ? (
          Array.from({ length: 8 }).map((_, index) => <KpiSkeleton key={index} />)
        ) : (
          <>
            <KpiCard
              label="TOTAL CLIENTS"
              value={data.kpis.totalClients.toLocaleString('en-IN')}
              subtext="Traders on the platform"
              to="/clients"
            />
            <KpiCard
              label="ACTIVE CLIENTS"
              value={data.kpis.activeClients.toLocaleString('en-IN')}
              subtext="Open for customer onboarding"
              to="/clients"
            />
            <KpiCard
              label="INACTIVE CLIENTS"
              value={data.kpis.inactiveClients.toLocaleString('en-IN')}
              subtext="Closed for customer onboarding"
            />
            <KpiCard
              label="TOTAL CUSTOMERS"
              value={data.kpis.totalCustomers.toLocaleString('en-IN')}
              subtext="Across all clients"
              to="/clients"
            />
            <KpiCard
              label="ACTIVE INVESTMENTS"
              value={data.kpis.totalActiveInvestments.toLocaleString('en-IN')}
              subtext="Live funds"
            />
            <KpiCard
              label="TOTAL INVESTED"
              value={formatCompactInr(data.kpis.totalInvestedAmount)}
              subtext="Platform AUM"
            />
            <KpiCard
              label="TOTAL WEALTH"
              value={formatCompactInr(data.kpis.totalWealthManaged)}
              subtext="Principal plus earnings"
            />
            <KpiCard
              label="PENDING REQUESTS"
              value={`${data.kpis.pendingRequests} Open`}
              subtext={`${data.kpis.pendingInvestments} funds · ${data.kpis.pendingWithdrawals} withdrawals`}
              highlight
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

      <section className="table-shell">
        <div className="table-toolbar">
          <h2 className="table-title">Recent clients</h2>
          <Link className="text-action" to="/clients">
            View all
          </Link>
        </div>
        {isLoading ? (
          <p className="state-box">Loading clients…</p>
        ) : !data || data.recentClients.length === 0 ? (
          <EmptyState
            title="No clients yet"
            message="Create the first trader to start multi-tenant onboarding."
          />
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Code</th>
                  <th>Admin</th>
                  <th>Customers</th>
                  <th>AUM</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.recentClients.map((client) => (
                  <tr key={client.id}>
                    <td>
                      <Link className="text-action" to={`/clients/${client.id}`}>
                        {client.name}
                      </Link>
                    </td>
                    <td>{client.clientCode}</td>
                    <td>{client.adminUsername}</td>
                    <td>{client.customerCount.toLocaleString('en-IN')}</td>
                    <td>{formatInr(client.totalInvested)}</td>
                    <td>
                      <span className={`status-pill ${client.status}`}>{client.status}</span>
                    </td>
                    <td>{formatDate(client.createdAt)}</td>
                    <td>
                      <Link className="text-action" to={`/clients/${client.id}`}>
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
