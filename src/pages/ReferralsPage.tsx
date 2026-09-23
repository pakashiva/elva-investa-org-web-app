import { FileText, Gift, Users, Wallet } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { ReferralDetailModal } from '../components/ReferralDetailModal';
import { ErrorBanner } from '../components/States';
import { TablePager } from '../components/TablePager';
import { useReferrals } from '../hooks/useReferrals';
import type { AdminOutletContext } from '../layouts/AdminLayout';
import type { ReferralListRow } from '../types/admin';
import {
  formatDayMonth,
  formatInr,
  formatTdsRate,
} from '../utils/format';

function Kpi({
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
  tone: 'orange' | 'green' | 'purple' | 'navy';
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

export function ReferralsPage() {
  const { onOpenMenu } = useOutletContext<AdminOutletContext>();
  const referrals = useReferrals();
  const [selected, setSelected] = useState<ReferralListRow | null>(null);

  const rows = referrals.data?.rows ?? [];
  const settings = referrals.data?.settings;
  const kpis = referrals.data?.kpis;
  const total = referrals.data?.total ?? 0;
  const from = total === 0 ? 0 : (referrals.page - 1) * referrals.pageSize + 1;
  const to = Math.min(referrals.page * referrals.pageSize, total);
  const tdsLabel = formatTdsRate(settings?.tds_rate ?? 0.02);

  return (
    <>
      <AppHeader
        title="Referrals & Commissions"
        subtitle="Track customer referral metrics and commission earnings."
        onOpenMenu={onOpenMenu}
      />

      {referrals.error ? (
        <ErrorBanner message={referrals.error} onRetry={() => void referrals.reload()} />
      ) : null}

      <section className="referral-kpi-grid">
        {referrals.isLoading || !kpis ? (
          Array.from({ length: 4 }).map((_, index) => (
            <article className="card tds-kpi" key={index}>
              <p className="kpi-label">Loading</p>
              <p className="kpi-value">—</p>
              <p className="kpi-sub">Fetching live data</p>
            </article>
          ))
        ) : (
          <>
            <Kpi
              label="TOTAL REFERRALS"
              value={kpis.totalReferrals.toLocaleString('en-IN')}
              subtext="ITD Referrals"
              tone="navy"
              icon={<Users size={18} />}
            />
            <Kpi
              label="COMMISSION GENERATED"
              value={formatInr(kpis.grossCommission)}
              subtext="Gross commission payout"
              tone="orange"
              icon={<Gift size={18} />}
            />
            <Kpi
              label="TDS ON COMMISSION"
              value={formatInr(kpis.tdsAmount)}
              subtext={`${tdsLabel} regulatory TDS deducted`}
              tone="purple"
              icon={<FileText size={18} />}
            />
            <Kpi
              label="NET COMMISSION"
              value={formatInr(kpis.netCommission)}
              subtext="Total post-tax payable"
              tone="green"
              icon={<Wallet size={18} />}
            />
          </>
        )}
      </section>

      <section className="table-shell" style={{ marginTop: 16 }}>
        {referrals.isLoading ? (
          <div className="state-box">Loading referrals…</div>
        ) : rows.length === 0 ? (
          <div className="state-box">No referral commissions recorded yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table referral-table">
              <thead>
                <tr>
                  <th>REFERRER NAME</th>
                  <th>REFERRED CUSTOMER</th>
                  <th>INVESTMENT AMT</th>
                  <th>COMM. RATE</th>
                  <th>GROSS COMM.</th>
                  <th>TDS ({tdsLabel})</th>
                  <th>NET COMMISSION</th>
                  <th>STATUS</th>
                  <th>DATE</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} onClick={() => setSelected(row)}>
                    <td>
                      <strong>{row.referrer_name}</strong>
                    </td>
                    <td>{row.referred_name}</td>
                    <td>{formatInr(row.capital_amount)}</td>
                    <td>{formatTdsRate(row.referral_rate)}</td>
                    <td>{formatInr(row.gross_bonus)}</td>
                    <td>{formatInr(row.tds_amount)}</td>
                    <td>
                      <strong>{formatInr(row.net_bonus)}</strong>
                    </td>
                    <td>
                      <span
                        className={`status-pill ${row.status === 'Paid' ? 'paid' : 'pending'}`}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td>{formatDayMonth(row.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="table-footer">
          <span>{total === 0 ? '0 referrals' : `Showing ${from}–${to} of ${total}`}</span>
          <TablePager
            page={referrals.page}
            pageCount={referrals.pageCount}
            total={total}
            onPageChange={referrals.setPage}
          />
        </div>
      </section>

      {selected ? (
        <ReferralDetailModal
          row={
            rows.find((row) => row.id === selected.id) ?? selected
          }
          onClose={() => setSelected(null)}
          onChanged={() => void referrals.reload()}
        />
      ) : null}
    </>
  );
}
