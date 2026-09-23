import { useEffect, useState } from 'react';
import { Calendar, Search } from 'lucide-react';
import { useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { CreateCustomerModal } from '../components/CreateCustomerModal';
import { CustomerDetailsModal } from '../components/CustomerDetailsModal';
import { EmptyState, ErrorBanner } from '../components/States';
import { useCustomers } from '../hooks/useCustomers';
import type { AdminOutletContext } from '../layouts/AdminLayout';
import type { CustomerFilter, CustomerListRow } from '../types/admin';
import {
  displayCustomerId,
  formatDate,
  formatInr,
  formatMobile,
  maskPan,
} from '../utils/format';

const FILTERS: { id: CustomerFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'inactive', label: 'Inactive' },
  { id: 'with_investments', label: 'With Investments' },
  { id: 'no_investment', label: 'No Investment' },
];

function investmentLabel(row: CustomerListRow): string {
  if (row.active_investments > 0) {
    return `${row.active_investments} active`;
  }
  if (row.pending_investments > 0) {
    return `${row.pending_investments} pending`;
  }
  if (row.closed_investments > 0) {
    return `${row.closed_investments} closed`;
  }
  return '0 active';
}

export function CustomersPage() {
  const { onOpenMenu } = useOutletContext<AdminOutletContext>();
  const {
    filter,
    searchInput,
    setSearchInput,
    sort,
    joinFrom,
    joinTo,
    page,
    pageSize,
    pageCount,
    result,
    isLoading,
    error,
    changeFilter,
    changeSort,
    changeJoinRange,
    setPage,
    reload,
  } = useCustomers();
  const navigate = useNavigate();
  const { userId } = useParams();
  const [searchParams] = useSearchParams();
  const [dateOpen, setDateOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeTone, setNoticeTone] = useState<'info' | 'success'>('info');

  useEffect(() => {
    const query = searchParams.get('q');
    if (query) {
      setSearchInput(query);
    }
  }, [searchParams, setSearchInput]);

  const rows = result?.rows ?? [];
  const total = result?.total ?? 0;
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

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

      {notice ? (
        <div className={`notice-box${noticeTone === 'success' ? ' success' : ''}`}>{notice}</div>
      ) : null}
      {error ? <ErrorBanner message={error} onRetry={() => void reload()} /> : null}

      <section className="table-shell">
        <div className="table-toolbar">
          <div className="filter-tabs">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`filter-tab${filter === item.id ? ' active' : ''}`}
                onClick={() => changeFilter(item.id)}
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
                    onChange={(event) =>
                      changeSort(event.target.value as 'joined_desc' | 'joined_asc')
                    }
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
                    onChange={(event) => changeJoinRange(event.target.value || null, joinTo)}
                  />
                </label>
                <label>
                  To
                  <input
                    type="date"
                    value={joinTo ?? ''}
                    onChange={(event) => changeJoinRange(joinFrom, event.target.value || null)}
                  />
                </label>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => {
                    changeJoinRange(null, null);
                    setDateOpen(false);
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
        ) : rows.length === 0 ? (
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
                {rows.map((row) => (
                  <tr key={row.user_id} onClick={() => navigate(`/customers/${row.user_id}`)}>
                    <td>{displayCustomerId(row.customer_id)}</td>
                    <td>{row.full_name}</td>
                    <td>{formatMobile(row.mobile_number)}</td>
                    <td>{row.email_address}</td>
                    <td>{maskPan(row.pan_number)}</td>
                    <td className="investment-count">
                      {row.active_investments > 0 ? (
                        <>
                          {row.active_investments} <strong>active</strong>
                        </>
                      ) : (
                        <span className="muted">{investmentLabel(row)}</span>
                      )}
                    </td>
                    <td>{formatInr(row.total_invested)}</td>
                    <td>{formatDate(row.joined_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="table-footer">
          <span>{total === 0 ? '0 customers' : `Showing ${from}–${to} of ${total}`}</span>
          <div className="pager">
            <button
              type="button"
              className="ghost-btn"
              disabled={page <= 1}
              onClick={() => setPage(Math.max(1, page - 1))}
            >
              Previous
            </button>
            <button
              type="button"
              className="ghost-btn"
              disabled={page >= pageCount || total === 0}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </section>

      {userId ? (
        <CustomerDetailsModal
          userId={userId}
          neighbors={rows}
          onClose={() => navigate('/customers')}
          onNavigate={(nextId) => navigate(`/customers/${nextId}`)}
        />
      ) : null}

      <CreateCustomerModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setNoticeTone('success');
          setNotice('Customer created successfully');
          void reload();
        }}
      />
    </>
  );
}
