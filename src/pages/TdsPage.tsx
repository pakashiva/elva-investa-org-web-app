import { Calculator, CalendarDays, FilePenLine } from 'lucide-react';
import type { ReactNode } from 'react';
import { useOutletContext } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { ErrorBanner } from '../components/States';
import { TdsQuarterChart } from '../components/TdsQuarterChart';
import { useTdsDashboard } from '../hooks/useTdsDashboard';
import type { AdminOutletContext } from '../layouts/AdminLayout';
import { formatInr, formatTdsRate } from '../utils/format';

function TdsKpi({
  label,
  value,
  subtext,
  icon,
  tone,
}: {
  label: string;
  value: string;
  subtext: string;
  icon: ReactNode;
  tone: 'orange' | 'green' | 'purple';
}) {
  return (
    <article className="card tds-kpi">
      <div className={`tds-kpi-icon ${tone}`}>{icon}</div>
      <p className="kpi-label">{label}</p>
      <p className="kpi-value">{value}</p>
      <p className="kpi-sub">{subtext}</p>
    </article>
  );
}

export function TdsPage() {
  const { onOpenMenu } = useOutletContext<AdminOutletContext>();
  const { data, isLoading, error, reload } = useTdsDashboard();

  return (
    <>
      <AppHeader
        title="TDS Dashboard"
        subtitle="Track tax deductions at source and manage Quarterly Form 16A filings."
        onOpenMenu={onOpenMenu}
      />

      {error ? <ErrorBanner message={error} onRetry={() => void reload()} /> : null}

      <section className="tds-kpi-grid">
        {isLoading || !data ? (
          <>
            <article className="card tds-kpi">
              <p className="kpi-label">Loading</p>
              <p className="kpi-value">—</p>
              <p className="kpi-sub">Fetching live data</p>
            </article>
            <article className="card tds-kpi">
              <p className="kpi-label">Loading</p>
              <p className="kpi-value">—</p>
              <p className="kpi-sub">Fetching live data</p>
            </article>
            <article className="card tds-kpi">
              <p className="kpi-label">Loading</p>
              <p className="kpi-value">—</p>
              <p className="kpi-sub">Fetching live data</p>
            </article>
          </>
        ) : (
          <>
            <TdsKpi
              label="TOTAL TDS DEDUCTED"
              value={formatInr(data.kpis.totalTds)}
              subtext="Inception to date"
              tone="orange"
              icon={<Calculator size={18} />}
            />
            <TdsKpi
              label="CURRENT MONTH TDS"
              value={formatInr(data.kpis.currentMonthTds)}
              subtext="Deducted in current cycle"
              tone="green"
              icon={<CalendarDays size={18} />}
            />
            <TdsKpi
              label="CURRENT FY TDS"
              value={formatInr(data.kpis.currentFyTds)}
              subtext={data.kpis.fyLabel || 'Current financial year'}
              tone="purple"
              icon={<FilePenLine size={18} />}
            />
          </>
        )}
      </section>

      <section className="tds-layout">
        <article className="card tds-table-card">
          <h2>TDS Deductions & Filings</h2>
          {isLoading ? (
            <div className="state-box">Loading filings…</div>
          ) : !data || data.rows.length === 0 ? (
            <div className="state-box">No completed interest periods in the current financial year.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table tds-table">
                <thead>
                  <tr>
                    <th>CUSTOMER NAME</th>
                    <th>INVESTMENT ID</th>
                    <th>PRINCIPAL</th>
                    <th>GROSS INT.</th>
                    <th>TDS RATE</th>
                    <th>TDS AMOUNT</th>
                    <th>PERIOD</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={`${row.investment_id}-${row.quarter}`}>
                      <td>
                        <strong>{row.customer_name}</strong>
                      </td>
                      <td>{row.investment_code}</td>
                      <td>{formatInr(row.principal)}</td>
                      <td>{formatInr(row.gross_interest)}</td>
                      <td>{formatTdsRate(row.tds_percent)}</td>
                      <td>
                        <strong>{formatInr(row.tds_amount)}</strong>
                      </td>
                      <td>{row.period}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>

        {isLoading ? (
          <section className="card tds-chart-card">
            <h2>TDS Distribution by Quarter</h2>
            <p className="state-box">Loading distribution…</p>
          </section>
        ) : (
          <TdsQuarterChart
            slices={data?.quarters ?? []}
            fyTotal={data?.kpis.currentFyTds ?? 0}
            fyShort={data?.kpis.fyShort ?? ''}
          />
        )}
      </section>
    </>
  );
}
