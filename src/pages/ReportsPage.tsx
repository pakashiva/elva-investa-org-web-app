import {
  ArrowDownToLine,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  ChartPie,
  Coins,
  FileSpreadsheet,
  Landmark,
  Percent,
  Plus,
  Users,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { ErrorBanner } from '../components/States';
import { useAuth } from '../contexts/AuthContext';
import { useGeneratedReports } from '../hooks/useReports';
import type { AdminOutletContext } from '../layouts/AdminLayout';
import {
  buildReport,
  getGeneratedReport,
  saveGeneratedReport,
} from '../services/reportService';
import type { ReportDatePreset, ReportFormat, ReportKind } from '../types/admin';
import { adminRoleLabel, firstName, formatDate } from '../utils/format';
import { downloadReportFile } from '../utils/reportExport';
import { resolveReportRange } from '../utils/reportRange';

const CATEGORIES: {
  kind: Exclude<ReportKind, 'bulk'>;
  title: string;
  description: string;
  icon: ReactNode;
}[] = [
  {
    kind: 'investment',
    title: 'Investment Reports',
    description: 'Generate daily, monthly, customer-wise, plan-wise, or cycle-wise metrics.',
    icon: <Landmark size={18} />,
  },
  {
    kind: 'interest',
    title: 'Interest Reports',
    description: 'Analyze total interest payable, interest paid, and upcoming payout cycles.',
    icon: <Percent size={18} />,
  },
  {
    kind: 'withdrawal',
    title: 'Withdrawal Reports',
    description: 'Track pending and completed principal / interest withdrawals.',
    icon: <ArrowDownToLine size={18} />,
  },
  {
    kind: 'tds',
    title: 'TDS Reports',
    description: 'Export detailed Form 16A calculations, customer TDS ledgers, and FY files.',
    icon: <Coins size={18} />,
  },
  {
    kind: 'referral',
    title: 'Referral Reports',
    description: 'Download comprehensive partner referral activities, audits, and commissions.',
    icon: <Users size={18} />,
  },
  {
    kind: 'wealth',
    title: 'Wealth Reports',
    description: 'High-level assets under management (AUM) and overall portfolio health metrics.',
    icon: <ChartPie size={18} />,
  },
  {
    kind: 'upcoming_payout',
    title: 'Upcoming Payouts (31 Days)',
    description:
      'All Active investments due for interest — bank, PAN, interest, TDS, and referral commission columns.',
    icon: <CalendarClock size={18} />,
  },
  {
    kind: 'payout_range',
    title: 'Payouts by Date Range',
    description:
      'Same payout layout using the date preset above. Includes customer, bank, interest, TDS, and referral details.',
    icon: <CalendarRange size={18} />,
  },
];

function formatLabel(format: ReportFormat): string {
  if (format === 'csv') return 'CSV';
  if (format === 'pdf') return 'PDF';
  return 'Excel';
}

export function ReportsPage() {
  const { onOpenMenu } = useOutletContext<AdminOutletContext>();
  const { admin } = useAuth();
  const history = useGeneratedReports();
  const [preset, setPreset] = useState<ReportDatePreset>('last_30');
  const [format, setFormat] = useState<ReportFormat>('xlsx');
  const [busy, setBusy] = useState<ReportKind | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const generatedBy = admin
    ? `${firstName(admin.full_name)} (${adminRoleLabel(admin.role)})`
    : 'Admin';

  async function generate(kind: ReportKind) {
    setBusy(kind);
    setActionError(null);
    try {
      const range = resolveReportRange(preset);
      const built = await buildReport(kind, range.from, range.to);
      await saveGeneratedReport({
        name: built.name,
        type: built.type,
        from: range.from,
        to: range.to,
        rangeLabel: range.label,
        generatedBy,
        format,
        payload: built,
      });
      downloadReportFile(built.name, built.sheets, format);
      await history.reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not generate report');
    } finally {
      setBusy(null);
    }
  }

  async function download(id: string) {
    setActionError(null);
    try {
      const report = await getGeneratedReport(id);
      downloadReportFile(report.payload.name, report.payload.sheets, report.meta.format);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not download report');
    }
  }

  return (
    <>
      <AppHeader
        title="Reports"
        subtitle="Design, audit, and pull critical transactional and regulatory reports."
        onOpenMenu={onOpenMenu}
      />

      {history.error ? (
        <ErrorBanner message={history.error} onRetry={() => void history.reload()} />
      ) : null}
      {actionError ? <ErrorBanner message={actionError} /> : null}

      <section className="report-params">
        <strong>Custom Report Parameters:</strong>
        <label className="report-select">
          <CalendarDays size={16} />
          <select
            value={preset}
            onChange={(event) => setPreset(event.target.value as ReportDatePreset)}
          >
            <option value="last_7">Last 7 Days</option>
            <option value="last_30">Last 30 Days</option>
            <option value="last_90">Last 90 Days</option>
            <option value="this_fy">This Financial Year</option>
            <option value="inception">Inception to date</option>
          </select>
        </label>
        <label className="report-select">
          <FileSpreadsheet size={16} />
          <select
            value={format}
            onChange={(event) => setFormat(event.target.value as ReportFormat)}
          >
            <option value="xlsx">Excel (.xlsx)</option>
            <option value="csv">CSV</option>
            <option value="pdf">PDF</option>
          </select>
        </label>
        <button
          type="button"
          className="primary-btn"
          disabled={busy !== null}
          onClick={() => void generate('bulk')}
        >
          <Plus size={16} />
          {busy === 'bulk' ? 'Generating…' : 'Generate Bulk Audit Export'}
        </button>
      </section>

      <section className="report-grid">
        {CATEGORIES.map((item) => (
          <article className="card report-card" key={item.kind}>
            <div className="report-card-icon">{item.icon}</div>
            <h3>{item.title}</h3>
            <p>{item.description}</p>
            <button
              type="button"
              className="ghost-btn report-generate"
              disabled={busy !== null}
              onClick={() => void generate(item.kind)}
            >
              {busy === item.kind ? 'Generating…' : 'Generate'}
            </button>
          </article>
        ))}
      </section>

      <section className="table-shell" style={{ marginTop: 24 }}>
        <div className="table-toolbar">
          <h2 className="report-history-title">Recently Generated Reports</h2>
        </div>
        {history.isLoading ? (
          <div className="state-box">Loading reports…</div>
        ) : history.rows.length === 0 ? (
          <div className="state-box">No reports generated yet. Use Generate to create the first file.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table report-history-table">
              <thead>
                <tr>
                  <th>REPORT NAME</th>
                  <th>TYPE</th>
                  <th>DATE RANGE</th>
                  <th>GENERATED BY</th>
                  <th>GENERATED DATE</th>
                  <th>FORMAT</th>
                  <th>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {history.rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.report_name}</strong>
                    </td>
                    <td>{row.report_type}</td>
                    <td>{row.date_range_label}</td>
                    <td>{row.generated_by}</td>
                    <td>{formatDate(String(row.generated_date))}</td>
                    <td>{formatLabel(row.format)}</td>
                    <td>
                      <button
                        type="button"
                        className="report-download"
                        onClick={() => void download(row.id)}
                      >
                        Download
                      </button>
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
