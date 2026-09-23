import { useEffect, useState } from 'react';
import { Calendar, Search } from 'lucide-react';
import { useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { CreateCustomerModal } from '../components/CreateCustomerModal';
import { ClientCustomerDetailsModal } from '../components/ClientCustomerDetailsModal';
import { EmptyState, ErrorBanner } from '../components/States';
import { TablePager } from '../components/TablePager';
import type { AdminOutletContext } from '../layouts/AdminLayout';
import { listClientCustomers } from '../services/clientCustomerService';
import type { CustomerListFilter, CustomerListItem } from '../types/platform';
import {
  displayCustomerId,
  formatDate,
  formatInr,
  formatMobile,
  maskPan,
} from '../utils/format';

const FILTERS: { id: CustomerListFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'inactive', label: 'Inactive' },
  { id: 'with_investments', label: 'With Investments' },
  { id: 'no_investment', label: 'No Investment' },
];

const PAGE_SIZE = 10;

function investmentLabel(row: CustomerListItem): string {
  const active = row.activeInvestments ?? 0;
  const pending = row.pendingInvestments ?? 0;
  const closed = row.closedInvestments ?? 0;
  if (active > 0) {
    return `${active} active`;
  }
  if (pending > 0) {
    return `${pending} pending`;
  }
  if (closed > 0) {
    return `${closed} closed`;
  }
  return '0 active';
}

export function ClientCustomersPage() {
  const { onOpenMenu } = useOutletContext<AdminOutletContext>();
  const navigate = useNavigate();
  const { userId } = useParams();
  const [searchParams] = useSearchParams();
  const [filter, setFilter] = useState<CustomerListFilter>('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'joined_desc' | 'joined_asc'>('joined_desc');
  const [joinFrom, setJoinFrom] = useState<string | null>(null);
  const [joinTo, setJoinTo] = useState<string | null>(null);
  const [dateOpen, setDateOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [customers, setCustomers] = useState<CustomerListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);

  useEffect(() => {
    const query = searchParams.get('q');
    if (query) {
      setSearchInput(query);
    }
  }, [searchParams]);

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
      const result = await listClientCustomers({
        q: search,
        filter,
        sort,
        joinFrom,
        joinTo,
        page,
        pageSize: PAGE_SIZE,
      });
      setCustomers(result.customers);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load customers.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [search, filter, sort, joinFrom, joinTo, page]);

  return (
    <>
      <AppHeader
        title="Customers"
        subtitle="Manage your Indian investor base"
        onOpenMenu={onOpenMenu}
        actions={
          <button type="button" className="primary-btn" onClick={() => setCreateOpen(true)}>
            + Create Customer
          </button>
        }
      />

      {notice ? <div className="notice-box success">{notice}</div> : null}
      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

      <section className="table-shell">
        <div className="table-toolbar">
          <div className="filter-tabs">
            {FILTERS.map((item) => (
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
              placeholder="Search Name, ID, Mobile, Email, PAN..."
            />
          </label>

          <div className="date-filter">
            <button type="button" className="ghost-btn" onClick={() => setDateOpen((open) => !open)}>
              <Calendar size={16} />
              Join Date
            </button>
            {dateOpen ? (
              <div className="date-popover">
                <label>
                  Sort
                  <select
                    value={sort}
                    onChange={(event) => {
                      setSort(event.target.value as 'joined_desc' | 'joined_asc');
                      setPage(1);
                    }}
                  >
                    <option value="joined_desc">Newest first</option>
                    <option value="joined_asc">Oldest first</option>
                  </select>
                </label>
                <label>
                  From
                  <input
                    type="date"
                    value={joinFrom ?? ''}
                    onChange={(event) => {
                      setJoinFrom(event.target.value || null);
                      setPage(1);
                    }}
                  />
                </label>
                <label>
                  To
                  <input
                    type="date"
                    value={joinTo ?? ''}
                    onChange={(event) => {
                      setJoinTo(event.target.value || null);
                      setPage(1);
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => {
                    setJoinFrom(null);
                    setJoinTo(null);
                    setDateOpen(false);
                    setPage(1);
                  }}
                >
                  Clear dates
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {isLoading ? (
          <div className="state-box">Loading customers…</div>
        ) : customers.length === 0 ? (
          <EmptyState
            title="No customers found"
            message="No matching investor profiles in the database for this filter."
          />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>CUSTOMER ID</th>
                  <th>FULL NAME</th>
                  <th>MOBILE</th>
                  <th>EMAIL</th>
                  <th>PAN</th>
                  <th>INVESTMENTS</th>
                  <th>TOTAL INVESTED</th>
                  <th>JOINED DATE</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((row) => (
                  <tr key={row.id} onClick={() => navigate(`/customers/${row.id}`)}>
                    <td>{displayCustomerId(row.customerCode)}</td>
                    <td>{row.fullName}</td>
                    <td>{formatMobile(row.mobileNumber)}</td>
                    <td>{row.emailAddress}</td>
                    <td>{maskPan(row.panNumber)}</td>
                    <td className="investment-count">
                      {(row.activeInvestments ?? 0) > 0 ? (
                        <>
                          {row.activeInvestments} <strong>active</strong>
                        </>
                      ) : (
                        <span className="muted">{investmentLabel(row)}</span>
                      )}
                    </td>
                    <td>{formatInr(row.totalInvested ?? 0)}</td>
                    <td>{formatDate(String(row.createdAt))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="table-footer">
          <span>{total === 0 ? '0 customers' : `Showing ${from}–${to} of ${total}`}</span>
          <TablePager page={page} pageCount={pageCount} total={total} onPageChange={setPage} />
        </div>
      </section>

      {userId ? (
        <ClientCustomerDetailsModal
          customerId={userId}
          neighbors={customers}
          onClose={() => navigate('/customers')}
          onNavigate={(id) => navigate(`/customers/${id}`)}
          onChanged={() => void load()}
        />
      ) : null}

      <CreateCustomerModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setNotice('Customer created successfully');
          setPage(1);
          void load();
        }}
      />
    </>
  );
}
