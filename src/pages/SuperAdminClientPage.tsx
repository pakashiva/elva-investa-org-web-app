import { useEffect, useMemo, useState } from 'react';
import { Link, useOutletContext, useParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { AppHeader } from '../components/AppHeader';
import { ClientCustomerDetailsModal } from '../components/ClientCustomerDetailsModal';
import { KpiCard, KpiSkeleton } from '../components/KpiCard';
import { EmptyState, ErrorBanner } from '../components/States';
import { TablePager } from '../components/TablePager';
import type { AdminOutletContext } from '../layouts/AdminLayout';
import {
  getClient,
  getPlatformCustomer,
  listPlatformCustomers,
  listPlatformInvestments,
  listPlatformReferrals,
  listPlatformWithdrawals,
  setClientStatus,
} from '../services/clientService';
import type {
  ClientDetailPayload,
  CustomerListItem,
  CustomerStatus,
  PlatformInvestmentRow,
  PlatformReferralRow,
  PlatformWithdrawalRow,
} from '../types/platform';
import {
  displayCustomerId,
  displayRequestId,
  formatCompactInr,
  formatDate,
  formatInr,
  formatMobile,
  formatPercent,
} from '../utils/format';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'customers', label: 'Customers' },
  { id: 'investments', label: 'Investments' },
  { id: 'withdrawals', label: 'Withdrawals' },
  { id: 'referrals', label: 'Referrals' },
] as const;

type TabId = (typeof TABS)[number]['id'];

const CUSTOMER_FILTERS: { id: 'all' | CustomerStatus; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'inactive', label: 'Inactive' },
];

const BOOK_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
] as const;

const INVESTMENT_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'under_review', label: 'Under Review' },
  { id: 'approved', label: 'Active / Closed' },
  { id: 'rejected', label: 'Rejected' },
] as const;

function investmentPill(status: string) {
  if (status === 'Active' || status === 'Closed') return 'approved';
  if (status === 'Rejected') return 'rejected';
  if (status === 'Under Review') return 'review';
  return 'pending';
}

function withdrawalPill(status: string) {
  if (status === 'Paid') return 'paid';
  if (status === 'Approved') return 'approved';
  if (status === 'Rejected') return 'rejected';
  if (status === 'On Hold') return 'hold';
  return 'pending';
}

function referralPill(status: string) {
  if (status === 'Paid') return 'paid';
  if (status === 'Rejected' || status === 'Hold') return 'hold';
  return 'pending';
}

export function SuperAdminClientPage() {
  const { clientId = '' } = useParams();
  const { onOpenMenu } = useOutletContext<AdminOutletContext>();
  const [tab, setTab] = useState<TabId>('overview');
  const [detail, setDetail] = useState<ClientDetailPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setIsLoading(true);
    setError(null);
    try {
      setDetail(await getClient(clientId));
    } catch (err) {
      setDetail(null);
      setError(err instanceof Error ? err.message : 'Unable to load client.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [clientId]);

  async function toggleStatus() {
    if (!detail) return;
    const next = detail.client.status === 'active' ? 'inactive' : 'active';
    setBusy(true);
    setError(null);
    try {
      const updated = await setClientStatus(detail.client.id, next);
      setDetail((current) => (current ? { ...current, client: { ...current.client, ...updated } } : current));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update client.');
    } finally {
      setBusy(false);
    }
  }

  const client = detail?.client;

  return (
    <>
      <AppHeader
        title={client?.name ?? 'Client'}
        subtitle={
          client
            ? `${client.clientCode} · read-only operations. Queue decisions stay with the Client Admin.`
            : 'Loading client workspace…'
        }
        onOpenMenu={onOpenMenu}
        actions={
          <>
            <Link className="ghost-btn" to="/clients">
              ← Clients
            </Link>
            {client ? (
              <button type="button" className="text-action" disabled={busy} onClick={() => void toggleStatus()}>
                {client.status === 'active' ? 'Deactivate' : 'Activate'}
              </button>
            ) : null}
          </>
        }
      />

      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

      <div className="filter-tabs client-detail-tabs">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`filter-tab${tab === item.id ? ' active' : ''}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'overview' ? (
        <OverviewTab detail={detail} isLoading={isLoading} />
      ) : null}
      {tab === 'customers' ? <CustomersTab clientId={clientId} /> : null}
      {tab === 'investments' ? <InvestmentsTab clientId={clientId} /> : null}
      {tab === 'withdrawals' ? <WithdrawalsTab clientId={clientId} /> : null}
      {tab === 'referrals' ? <ReferralsTab clientId={clientId} /> : null}
    </>
  );
}

function OverviewTab({
  detail,
  isLoading,
}: {
  detail: ClientDetailPayload | null;
  isLoading: boolean;
}) {
  const client = detail?.client;
  const kpis = detail?.kpis;

  return (
    <>
      <section className="kpi-grid">
        {isLoading || !kpis ? (
          Array.from({ length: 6 }).map((_, index) => <KpiSkeleton key={index} />)
        ) : (
          <>
            <KpiCard
              label="CUSTOMERS"
              value={kpis.totalCustomers.toLocaleString('en-IN')}
              subtext="Investors on this tenant"
            />
            <KpiCard
              label="ACTIVE INVESTMENTS"
              value={kpis.activeInvestments.toLocaleString('en-IN')}
              subtext="Live funds"
            />
            <KpiCard
              label="TOTAL INVESTED"
              value={formatCompactInr(kpis.totalInvested)}
              subtext="Active principal"
            />
            <KpiCard
              label="TOTAL WEALTH"
              value={formatCompactInr(kpis.totalWealth)}
              subtext="Principal plus earnings"
            />
            <KpiCard
              label="PENDING"
              value={`${kpis.pendingInvestments + kpis.pendingWithdrawals}`}
              subtext={`${kpis.pendingInvestments} funds · ${kpis.pendingWithdrawals} withdrawals`}
              highlight
            />
            <KpiCard
              label="PAID WITHDRAWALS"
              value={formatCompactInr(kpis.paidWithdrawals)}
              subtext="Settled payouts"
            />
          </>
        )}
      </section>

      <section className="card settings-card client-form">
        <h2>Product configuration</h2>
        {isLoading || !client ? (
          <p className="state-box">Loading settings…</p>
        ) : (
          <>
            <p className="form-hint">
              Super Admin sets these on onboarding. New funds snapshot the values. This view is
              read-only.
            </p>
            <div className="settings-row">
              <div className="settings-field">
                <span>Client Admin</span>
                <p className="settings-readonly">
                  {client.adminFullName}
                  <span className="muted-line">{client.adminUsername}</span>
                </p>
              </div>
              <div className="settings-field">
                <span>Status</span>
                <p className="settings-readonly">
                  <span className={`status-pill ${client.status}`}>{client.status}</span>
                </p>
              </div>
            </div>
            <div className="settings-row">
              <div className="settings-field">
                <span>Minimum investment</span>
                <p className="settings-readonly">{formatInr(client.minInvestmentAmount)}</p>
              </div>
              <div className="settings-field">
                <span>Maximum investment</span>
                <p className="settings-readonly">{formatInr(client.maxInvestmentAmount)}</p>
              </div>
            </div>
            <div className="settings-row">
              <div className="settings-field">
                <span>Agreement charges</span>
                <p className="settings-readonly">{formatInr(client.agreementCharges)}</p>
              </div>
              <div className="settings-field">
                <span>Interest / TDS</span>
                <p className="settings-readonly">
                  {formatPercent(client.defaultInterestRate)} per month ·{' '}
                  {formatPercent(client.defaultTdsPercent)} TDS
                </p>
              </div>
            </div>
            <div className="settings-row">
              <div className="settings-field">
                <span>Referral commission</span>
                <p className="settings-readonly">
                  {formatPercent(client.referralRate)} gross · {formatPercent(client.referralTdsRate)} TDS
                </p>
              </div>
              <div className="settings-field">
                <span>Payout day</span>
                <p className="settings-readonly">{client.defaultPayoutDay}</p>
              </div>
            </div>
            <div className="settings-row">
              <div className="settings-field">
                <span>Support</span>
                <p className="settings-readonly">
                  {client.supportEmail || '—'}
                  <span className="muted-line">{client.supportPhone || 'No phone on file'}</span>
                </p>
              </div>
              <div className="settings-field">
                <span>Created</span>
                <p className="settings-readonly">{formatDate(client.createdAt)}</p>
              </div>
            </div>
          </>
        )}
      </section>
    </>
  );
}

function CustomersTab({ clientId }: { clientId: string }) {
  const [status, setStatus] = useState<'all' | CustomerStatus>('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [customers, setCustomers] = useState<CustomerListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  async function load() {
    setIsLoading(true);
    setError(null);
    try {
      const result = await listPlatformCustomers(clientId, { q: search, status, page, pageSize: 20 });
      setCustomers(result.customers);
      setTotal(result.total);
      setPageSize(result.pageSize);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load customers.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [clientId, search, status, page]);

  const range = useMemo(() => {
    if (total === 0) return { from: 0, to: 0 };
    return { from: (page - 1) * pageSize + 1, to: Math.min(page * pageSize, total) };
  }, [page, pageSize, total]);

  return (
    <section className="table-shell">
      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
      <div className="table-toolbar">
        <div className="filter-tabs">
          {CUSTOMER_FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`filter-tab${status === item.id ? ' active' : ''}`}
              onClick={() => {
                setStatus(item.id);
                setPage(1);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <label className="toolbar-search">
          <Search size={16} />
          <input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search name, mobile, email, ID"
          />
        </label>
      </div>
      {isLoading ? (
        <p className="state-box">Loading customers…</p>
      ) : customers.length === 0 ? (
        <EmptyState title="No customers" message="This client has no matching investors." />
      ) : (
        <>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Mobile</th>
                  <th>Email</th>
                  <th>Referral</th>
                  <th>Status</th>
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <button type="button" className="text-action" onClick={() => setSelectedId(row.id)}>
                        {row.customerCode}
                      </button>
                    </td>
                    <td>
                      <button type="button" className="text-action" onClick={() => setSelectedId(row.id)}>
                        {row.fullName}
                      </button>
                    </td>
                    <td>{formatMobile(row.mobileNumber)}</td>
                    <td>{row.emailAddress}</td>
                    <td>{row.referralCode}</td>
                    <td>
                      <span className={`status-pill ${row.status}`}>{row.status}</span>
                    </td>
                    <td>{formatDate(String(row.createdAt))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager from={range.from} to={range.to} total={total} page={page} pageCount={pageCount} onPage={setPage} />
        </>
      )}
      {selectedId ? (
        <ClientCustomerDetailsModal
          customerId={selectedId}
          neighbors={customers}
          onClose={() => setSelectedId(null)}
          onNavigate={setSelectedId}
          loadCustomer={(id) => getPlatformCustomer(clientId, id)}
        />
      ) : null}
    </section>
  );
}

function InvestmentsTab({ clientId }: { clientId: string }) {
  const [filter, setFilter] = useState<(typeof INVESTMENT_FILTERS)[number]['id']>('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<PlatformInvestmentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  async function load() {
    setIsLoading(true);
    setError(null);
    try {
      const result = await listPlatformInvestments(clientId, { q: search, filter, page, pageSize: 20 });
      setRows(result.rows);
      setTotal(result.total);
      setPageSize(result.pageSize);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load investments.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [clientId, search, filter, page]);

  const range = useMemo(() => {
    if (total === 0) return { from: 0, to: 0 };
    return { from: (page - 1) * pageSize + 1, to: Math.min(page * pageSize, total) };
  }, [page, pageSize, total]);

  return (
    <section className="table-shell">
      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
      <div className="table-toolbar">
        <div className="filter-tabs">
          {INVESTMENT_FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`filter-tab${filter === item.id ? ' active' : ''}`}
              onClick={() => {
                setFilter(item.id);
                setPage(1);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <label className="toolbar-search">
          <Search size={16} />
          <input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search request, customer, fund"
          />
        </label>
      </div>
      {isLoading ? (
        <p className="state-box">Loading investments…</p>
      ) : rows.length === 0 ? (
        <EmptyState title="No investments" message="No funds match this filter." />
      ) : (
        <>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Request</th>
                  <th>Customer</th>
                  <th>Fund</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{displayRequestId(row.requestId ?? row.code)}</td>
                    <td>
                      <strong>{row.customerName}</strong>
                      <div className="muted-line">{displayCustomerId(row.customerCode)}</div>
                    </td>
                    <td>{row.planName}</td>
                    <td>{formatInr(row.fundAmount)}</td>
                    <td>
                      <span className={`status-pill ${investmentPill(row.status)}`}>{row.status}</span>
                    </td>
                    <td>{formatDate(row.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager from={range.from} to={range.to} total={total} page={page} pageCount={pageCount} onPage={setPage} />
        </>
      )}
    </section>
  );
}

function WithdrawalsTab({ clientId }: { clientId: string }) {
  const [filter, setFilter] = useState<(typeof BOOK_FILTERS)[number]['id']>('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<PlatformWithdrawalRow[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  async function load() {
    setIsLoading(true);
    setError(null);
    try {
      const result = await listPlatformWithdrawals(clientId, { q: search, filter, page, pageSize: 20 });
      setRows(result.rows);
      setTotal(result.total);
      setPageSize(result.pageSize);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load withdrawals.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [clientId, search, filter, page]);

  const range = useMemo(() => {
    if (total === 0) return { from: 0, to: 0 };
    return { from: (page - 1) * pageSize + 1, to: Math.min(page * pageSize, total) };
  }, [page, pageSize, total]);

  return (
    <section className="table-shell">
      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
      <div className="table-toolbar">
        <div className="filter-tabs">
          {BOOK_FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`filter-tab${filter === item.id ? ' active' : ''}`}
              onClick={() => {
                setFilter(item.id);
                setPage(1);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <label className="toolbar-search">
          <Search size={16} />
          <input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search customer or fund code"
          />
        </label>
      </div>
      {isLoading ? (
        <p className="state-box">Loading withdrawals…</p>
      ) : rows.length === 0 ? (
        <EmptyState title="No withdrawals" message="No payout requests match this filter." />
      ) : (
        <>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Fund</th>
                  <th>Type</th>
                  <th>Amount</th>
                  <th>Net payout</th>
                  <th>Status</th>
                  <th>Requested</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.customerName}</td>
                    <td>
                      {row.investmentCode}
                      <div className="muted-line">{row.planName}</div>
                    </td>
                    <td>{row.strategy}</td>
                    <td>{formatInr(row.withdrawalAmount)}</td>
                    <td>{formatInr(row.netPayout)}</td>
                    <td>
                      <span className={`status-pill ${withdrawalPill(row.status)}`}>{row.status}</span>
                    </td>
                    <td>{formatDate(row.requestedOn)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager from={range.from} to={range.to} total={total} page={page} pageCount={pageCount} onPage={setPage} />
        </>
      )}
    </section>
  );
}

function ReferralsTab({ clientId }: { clientId: string }) {
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<PlatformReferralRow[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [kpis, setKpis] = useState<{
    totalReferrals: number;
    grossCommission: number;
    tdsAmount: number;
    netCommission: number;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  async function load() {
    setIsLoading(true);
    setError(null);
    try {
      const result = await listPlatformReferrals(clientId, { page, pageSize: 20 });
      setRows(result.rows);
      setTotal(result.total);
      setPageSize(result.pageSize);
      setKpis(result.kpis);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load referrals.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [clientId, page]);

  const range = useMemo(() => {
    if (total === 0) return { from: 0, to: 0 };
    return { from: (page - 1) * pageSize + 1, to: Math.min(page * pageSize, total) };
  }, [page, pageSize, total]);

  return (
    <>
      <section className="kpi-grid">
        {isLoading || !kpis ? (
          Array.from({ length: 4 }).map((_, index) => <KpiSkeleton key={index} />)
        ) : (
          <>
            <KpiCard
              label="TOTAL REFERRALS"
              value={kpis.totalReferrals.toLocaleString('en-IN')}
              subtext="Commission rows"
            />
            <KpiCard label="GROSS" value={formatCompactInr(kpis.grossCommission)} subtext="Before TDS" />
            <KpiCard label="TDS" value={formatCompactInr(kpis.tdsAmount)} subtext="Deducted" />
            <KpiCard label="NET" value={formatCompactInr(kpis.netCommission)} subtext="Payable / paid" />
          </>
        )}
      </section>
      <section className="table-shell">
        {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
        {isLoading ? (
          <p className="state-box">Loading referrals…</p>
        ) : rows.length === 0 ? (
          <EmptyState title="No referrals" message="No referral commissions for this client yet." />
        ) : (
          <>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Referrer</th>
                    <th>Referred</th>
                    <th>Fund</th>
                    <th>Capital</th>
                    <th>Net bonus</th>
                    <th>Status</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.referrerName}</td>
                      <td>{row.referredName}</td>
                      <td>{row.investmentCode}</td>
                      <td>{formatInr(row.capitalAmount)}</td>
                      <td>{formatInr(row.netBonus)}</td>
                      <td>
                        <span className={`status-pill ${referralPill(row.status)}`}>{row.status}</span>
                      </td>
                      <td>{formatDate(row.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager from={range.from} to={range.to} total={total} page={page} pageCount={pageCount} onPage={setPage} />
          </>
        )}
      </section>
    </>
  );
}

function Pager({
  from,
  to,
  total,
  page,
  pageCount,
  onPage,
}: {
  from: number;
  to: number;
  total: number;
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
}) {
  return (
    <div className="table-footer">
      <span>
        {from}–{to} of {total}
      </span>
      <TablePager page={page} pageCount={pageCount} total={total} onPageChange={onPage} />
    </div>
  );
}
