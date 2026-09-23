import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { EmptyState, ErrorBanner } from './States';
import { useCustomerDetails } from '../hooks/useCustomerDetails';
import type { CustomerDetailsTab, CustomerListRow } from '../types/admin';
import {
  displayCustomerId,
  formatAddress,
  formatDate,
  formatInr,
  formatLedgerType,
  formatMobile,
  formatSignedInr,
} from '../utils/format';

type Props = {
  userId: string;
  neighbors: CustomerListRow[];
  onClose: () => void;
  onNavigate: (userId: string) => void;
};

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-field">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function CustomerDetailsModal({ userId, neighbors, onClose, onNavigate }: Props) {
  const { data, isLoading, error, reload } = useCustomerDetails(userId);
  const [tab, setTab] = useState<CustomerDetailsTab>('profile');

  useEffect(() => {
    setTab('profile');
  }, [userId]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const index = neighbors.findIndex((row) => row.user_id === userId);
  const previous = index > 0 ? neighbors[index - 1] : undefined;
  const next =
    index >= 0 && index < neighbors.length - 1 ? neighbors[index + 1] : undefined;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="customer-modal"
        role="dialog"
        aria-labelledby="customer-details-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="customer-modal-head">
          <div>
            <h2 id="customer-details-title">Customer Details</h2>
            <p>
              Customer ID:{' '}
              {displayCustomerId(data?.profile.customer_id)}
            </p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <nav className="customer-tabs">
          {(['profile', 'banks', 'transactions'] as const).map((item) => (
            <button
              key={item}
              type="button"
              className={tab === item ? 'active' : ''}
              onClick={() => setTab(item)}
            >
              {item === 'profile' ? 'Profile' : item === 'banks' ? 'Banks' : 'Transactions'}
            </button>
          ))}
        </nav>

        {error ? <ErrorBanner message={error} onRetry={() => void reload()} /> : null}

        {isLoading || !data ? (
          <div className="state-box">{isLoading ? 'Loading customer…' : 'Customer not found'}</div>
        ) : (
          <>
            {tab === 'profile' ? (
              <div className="detail-stack">
                <article className="detail-card">
                  <div className="detail-grid">
                    <Field label="FULL NAME" value={data.profile.full_name || '—'} />
                    <Field label="EMAIL ADDRESS" value={data.profile.email_address || '—'} />
                    <Field label="PHONE NUMBER" value={formatMobile(data.profile.mobile_number)} />
                    <Field label="DATE OF BIRTH" value={formatDate(data.profile.date_of_birth)} />
                    <Field label="PAN NUMBER" value={data.profile.pan_number || '—'} />
                  </div>
                </article>

                <article className="detail-card">
                  <h3>Address</h3>
                  <p>
                    {formatAddress({
                      address: data.profile.address,
                      city: data.profile.city,
                      state: data.profile.state,
                      pin_code: data.profile.pin_code,
                    })}
                  </p>
                </article>

                <article className="summary-card">
                  <h3>Investment Summary</h3>
                  <div className="summary-grid">
                    <div>
                      <span>TOTAL INVESTED</span>
                      <strong>{formatInr(data.summary.total_invested)}</strong>
                    </div>
                    <div>
                      <span>ACTIVE PLANS</span>
                      <strong>{data.summary.active_plans}</strong>
                    </div>
                    <div>
                      <span>RETURNS EARNED</span>
                      <strong>{formatInr(data.summary.returns_earned)}</strong>
                    </div>
                  </div>
                </article>
              </div>
            ) : null}

            {tab === 'banks' ? (
              <div className="detail-stack">
                {data.banks.length === 0 ? (
                  <EmptyState
                    title="No bank accounts"
                    message="This customer has not added a bank account yet."
                  />
                ) : (
                  data.banks.map((bank) => (
                    <article key={bank.id} className="detail-card bank-card">
                      {bank.is_primary ? <span className="primary-badge">Primary</span> : null}
                      <div className="detail-grid">
                        <Field label="BANK NAME" value={bank.bank_name || '—'} />
                        <Field label="ACCOUNT NUMBER" value={bank.account_number || '—'} />
                        <Field label="IFSC CODE" value={bank.ifsc_code || '—'} />
                        <Field label="ACCOUNT TYPE" value={bank.account_type || '—'} />
                      </div>
                    </article>
                  ))
                )}
              </div>
            ) : null}

            {tab === 'transactions' ? (
              <article className="detail-card">
                <h3>Recent Transactions</h3>
                {data.transactions.length === 0 ? (
                  <EmptyState
                    title="No transactions"
                    message="No ledger entries exist for this customer yet."
                  />
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="ledger-table">
                      <thead>
                        <tr>
                          <th>DATE</th>
                          <th>TYPE</th>
                          <th>AMOUNT</th>
                          <th>STATUS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.transactions.map((row) => {
                          const amount = formatSignedInr(row.transaction_type, row.amount);
                          return (
                            <tr key={row.id}>
                              <td>{formatDate(row.occurred_on)}</td>
                              <td>{formatLedgerType(row.transaction_type)}</td>
                              <td className={amount.tone}>{amount.display}</td>
                              <td>
                                <span
                                  className={`status-pill ${row.status === 'Pending' ? 'pending' : 'verified'}`}
                                >
                                  {row.status}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </article>
            ) : null}
          </>
        )}

        <footer className="customer-modal-nav">
          <button
            type="button"
            className="nav-pill"
            disabled={!previous}
            onClick={() => previous && onNavigate(previous.user_id)}
            aria-label="Previous customer"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            className="nav-pill"
            disabled={!next}
            onClick={() => next && onNavigate(next.user_id)}
            aria-label="Next customer"
          >
            <ChevronRight size={16} />
          </button>
        </footer>
      </section>
    </div>
  );
}
