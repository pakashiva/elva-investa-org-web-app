import { useEffect, useMemo, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { EmptyState, ErrorBanner } from '../components/States';
import type { AdminOutletContext } from '../layouts/AdminLayout';
import { getBorrowOverview } from '../services/borrowingService';
import { listInvestmentRequests } from '../services/investmentRequestService';
import { listWithdrawals } from '../services/withdrawalService';
import { formatDate, formatInr } from '../utils/format';
import type { InvestmentRequestListRow, WithdrawalListRow } from '../types/admin';
import type { BorrowOverview } from '../services/borrowingService';

type ActivitySource = 'Investment' | 'Borrowing';
type ActivityRow = {
  id: string;
  source: ActivitySource;
  type: string;
  reference: string;
  customer: string;
  amount: number;
  status: string;
  createdAt: string;
  href: string;
};

const PAGE_SIZE = 25;
const SOURCE_PAGE_SIZE = 50;

async function collectPages<Row>(
  first: { rows: Row[]; total: number; limit: number },
  loadPage: (page: number) => Promise<{ rows: Row[]; total: number; limit: number }>
): Promise<Row[]> {
  const rows = [...first.rows];
  const pageCount = Math.ceil(first.total / Math.max(1, first.limit));
  for (let start = 2; start <= pageCount; start += 5) {
    const pages = Array.from({ length: Math.min(5, pageCount - start + 1) }, (_, index) => start + index);
    const batch = await Promise.all(pages.map(loadPage));
    batch.forEach((result) => rows.push(...result.rows));
  }
  return rows;
}

function investmentRows(rows: InvestmentRequestListRow[]): ActivityRow[] {
  return rows.map((row) => ({
    id: `investment-${row.kind ?? 'investment'}-${row.id}`,
    source: 'Investment',
    type: row.kind === 'renewal' ? 'Investment renewal' : 'Investment request',
    reference: row.code || row.request_id || '—',
    customer: row.customer_name,
    amount: row.fund_amount,
    status: row.status,
    createdAt: row.created_at,
    href: row.kind === 'renewal' ? `/investment-requests/renewal/${row.id}?workspace=all` : `/investment-requests/${row.id}?workspace=all`,
  }));
}

function withdrawalRows(rows: WithdrawalListRow[]): ActivityRow[] {
  return rows.map((row) => ({
    id: `withdrawal-${row.id}`,
    source: 'Investment',
    type: 'Withdrawal request',
    reference: row.investment_code || row.id,
    customer: row.customer_name,
    amount: row.withdrawal_amount,
    status: row.status,
    createdAt: row.requested_on,
    href: '/withdrawals?workspace=all',
  }));
}

function borrowingRows(data: BorrowOverview): ActivityRow[] {
  return data.loans.map((row) => ({
    id: `borrowing-${row.id}`,
    source: 'Borrowing',
    type: row.request_type === 'custom' ? row.rollover_from_loan_id ? 'Custom loan rollover' : 'Custom loan request' : row.request_type === 'regular' ? 'Regular interest-only loan' : 'Loan request',
    reference: row.loan_number,
    customer: row.borrower_name,
    amount: Number(row.principal_amount),
    status: row.status.replaceAll('_', ' '),
    createdAt: row.created_at,
    href: '/borrowing/loans?workspace=all',
  }));
}

export function AllActivityPanel() {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [search, setSearch] = useState('');
  const [source, setSource] = useState<'all' | ActivitySource>('all');
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setIsLoading(true);
    setError(null);
    try {
      const [investmentFirst, pendingFirst, approvedFirst, rejectedFirst, borrowing] = await Promise.all([
        listInvestmentRequests({ filter: 'all', search: '', page: 1, pageSize: SOURCE_PAGE_SIZE }),
        listWithdrawals({ filter: 'pending', search: '', page: 1, pageSize: SOURCE_PAGE_SIZE }),
        listWithdrawals({ filter: 'approved', search: '', page: 1, pageSize: SOURCE_PAGE_SIZE }),
        listWithdrawals({ filter: 'rejected', search: '', page: 1, pageSize: SOURCE_PAGE_SIZE }),
        getBorrowOverview(),
      ]);
      const [investments, pendingWithdrawals, approvedWithdrawals, rejectedWithdrawals] = await Promise.all([
        collectPages(investmentFirst, (page) => listInvestmentRequests({ filter: 'all', search: '', page, pageSize: SOURCE_PAGE_SIZE })),
        collectPages(pendingFirst, (page) => listWithdrawals({ filter: 'pending', search: '', page, pageSize: SOURCE_PAGE_SIZE })),
        collectPages(approvedFirst, (page) => listWithdrawals({ filter: 'approved', search: '', page, pageSize: SOURCE_PAGE_SIZE })),
        collectPages(rejectedFirst, (page) => listWithdrawals({ filter: 'rejected', search: '', page, pageSize: SOURCE_PAGE_SIZE })),
      ]);
      setRows([
        ...investmentRows(investments),
        ...withdrawalRows([...pendingWithdrawals, ...approvedWithdrawals, ...rejectedWithdrawals]),
        ...borrowingRows(borrowing),
      ].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load combined activity.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => (source === 'all' || row.source === source) &&
      (!query || `${row.type} ${row.reference} ${row.customer} ${row.status} ${row.source}`.toLowerCase().includes(query)));
  }, [rows, search, source]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <>
      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
      <section className="table-shell all-activity-shell">
        <div className="table-toolbar all-activity-toolbar">
          <div className="filter-tabs" role="group" aria-label="Filter activity by source">
            {(['all', 'Investment', 'Borrowing'] as const).map((item) => (
              <button key={item} type="button" className={`filter-tab${source === item ? ' active' : ''}`} onClick={() => { setSource(item); setPage(1); }}>
                {item === 'all' ? 'All sources' : item}
              </button>
            ))}
          </div>
          <label className="toolbar-search">
            <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search customer, reference, status…" aria-label="Search combined activity" />
          </label>
        </div>
        {isLoading ? <p className="state-box">Loading investment and borrowing activity…</p> : visible.length === 0 ? (
          <EmptyState title="No matching activity" message="No investment or borrowing records match the current filters." />
        ) : (
          <div className="table-scroll"><table className="all-activity-table"><thead><tr><th>Source</th><th>Type</th><th>Reference</th><th>Customer</th><th>Amount</th><th>Date</th><th>Status</th><th>Open</th></tr></thead>
            <tbody>{visible.map((row) => <tr key={row.id}>
              <td><span className={`activity-source ${row.source === 'Investment' ? 'investment' : 'borrowing'}`}>{row.source}</span></td>
              <td>{row.type}</td><td>{row.reference}</td><td>{row.customer}</td><td>{formatInr(row.amount)}</td><td>{formatDate(row.createdAt)}</td><td><span className="status-pill">{row.status}</span></td><td><Link className="text-action" to={row.href}>View</Link></td>
            </tr>)}</tbody>
          </table></div>
        )}
        {!isLoading && filtered.length > PAGE_SIZE ? <div className="table-pager"><span>{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}</span><div><button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</button><button type="button" disabled={page >= pageCount} onClick={() => setPage((current) => current + 1)}>Next</button></div></div> : null}
      </section>
    </>
  );
}

export function AllActivityPage() {
  const { onOpenMenu } = useOutletContext<AdminOutletContext>();
  return <><AppHeader title="All activity" subtitle="Investment and borrowing activity in one view." onOpenMenu={onOpenMenu} /><AllActivityPanel /></>;
}
