import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import {
  listCustomerBanks,
  listCustomerOptions,
  type CustomerBankOption,
  type CustomerOption,
} from '../services/investmentRequestService';
import {
  createWithdrawalRequest,
  listActiveFunds,
  type ActiveFundOption,
} from '../services/withdrawalService';
import { formatInr } from '../utils/format';

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (result: { amount: number; strategy: 'full' | 'partial' }) => void;
};

type FormState = {
  userId: string;
  customerName: string;
  investmentId: string;
  strategy: 'full' | 'partial';
  amount: string;
  bankAccountId: string;
};

const EMPTY: FormState = {
  userId: '',
  customerName: '',
  investmentId: '',
  strategy: 'full',
  amount: '',
  bankAccountId: '',
};

export function AddWithdrawalModal({ open, onClose, onCreated }: Props) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [options, setOptions] = useState<CustomerOption[]>([]);
  const [funds, setFunds] = useState<ActiveFundOption[]>([]);
  const [banks, setBanks] = useState<CustomerBankOption[]>([]);
  const [search, setSearch] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const selectedFund = funds.find((fund) => fund.id === form.investmentId) ?? null;

  useEffect(() => {
    if (!open) return;
    setForm(EMPTY);
    setSearch('');
    setFunds([]);
    setBanks([]);
    setMenuOpen(false);
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const handle = window.setTimeout(() => {
      setLoadingOptions(true);
      void listCustomerOptions(search)
        .then((rows) => {
          if (!cancelled) setOptions(rows);
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load customers');
        })
        .finally(() => {
          if (!cancelled) setLoadingOptions(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [open, search]);

  useEffect(() => {
    if (!open || !form.userId) {
      setFunds([]);
      setBanks([]);
      return;
    }
    let cancelled = false;
    void Promise.all([listActiveFunds(form.userId), listCustomerBanks(form.userId)])
      .then(([nextFunds, nextBanks]) => {
        if (cancelled) return;
        setFunds(nextFunds);
        setBanks(nextBanks);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load accounts');
      });
    return () => {
      cancelled = true;
    };
  }, [open, form.userId]);

  useEffect(() => {
    if (!selectedFund || form.strategy !== 'full') return;
    setForm((prev) => ({ ...prev, amount: String(selectedFund.current_value) }));
  }, [selectedFund, form.strategy]);

  const hint = useMemo(() => {
    if (loadingOptions) return 'Searching…';
    if (options.length === 0) return 'No customers found';
    return null;
  }, [loadingOptions, options.length]);

  if (!open) return null;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!form.userId) {
      setError('Select a customer.');
      return;
    }
    if (!form.investmentId) {
      setError('Select an active investment.');
      return;
    }
    if (!form.bankAccountId) {
      setError('Select a bank account.');
      return;
    }
    const amount = Number(form.amount.replace(/,/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Enter a valid amount.');
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await createWithdrawalRequest({
        userId: form.userId,
        investmentId: form.investmentId,
        bankAccountId: form.bankAccountId,
        strategy: form.strategy,
        amount,
      });
      onCreated({ amount: result.withdrawal_amount, strategy: form.strategy });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create withdrawal request.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="create-customer-modal add-investment-modal"
        role="dialog"
        aria-labelledby="add-withdrawal-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => void onSubmit(event)}
      >
        <header className="create-customer-head">
          <h2 id="add-withdrawal-title">Add Withdrawal</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <div className="create-customer-body">
          {error ? <div className="error-box">{error}</div> : null}

          <section className="create-section">
            <h3>Customer & Fund</h3>
            <div className="create-grid">
              <label className="create-field">
                <span>Customer Name</span>
                <div className="customer-combobox" ref={wrapRef}>
                  <div className="customer-combobox-input">
                    <Search size={16} />
                    <input
                      value={search}
                      placeholder="Select customer"
                      onFocus={() => setMenuOpen(true)}
                      onChange={(event) => {
                        setSearch(event.target.value);
                        setMenuOpen(true);
                        setForm(EMPTY);
                      }}
                    />
                    <ChevronDown size={16} />
                  </div>
                  {menuOpen ? (
                    <ul className="customer-combobox-menu">
                      {hint ? <li className="customer-combobox-empty">{hint}</li> : null}
                      {options.map((row) => (
                        <li key={row.user_id}>
                          <button
                            type="button"
                            onClick={() => {
                              setForm({
                                ...EMPTY,
                                userId: row.user_id,
                                customerName: row.full_name,
                              });
                              setSearch(row.full_name);
                              setMenuOpen(false);
                            }}
                          >
                            <strong>{row.full_name}</strong>
                            <small>
                              {row.customer_id ?? '—'} · {row.mobile_number}
                            </small>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </label>

              <label className="create-field">
                <span>Active investment</span>
                <select
                  value={form.investmentId}
                  disabled={!form.userId}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, investmentId: event.target.value }))
                  }
                >
                  <option value="">
                    {!form.userId
                      ? 'Select a customer first'
                      : funds.length === 0
                        ? 'No active investments'
                        : 'Select investment'}
                  </option>
                  {funds.map((fund) => (
                    <option key={fund.id} value={fund.id}>
                      {fund.code} · {fund.name} · {formatInr(fund.current_value)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="create-grid" style={{ marginTop: 14 }}>
              <label className="create-field">
                <span>Strategy</span>
                <select
                  value={form.strategy}
                  disabled={!form.investmentId}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      strategy: event.target.value === 'partial' ? 'partial' : 'full',
                    }))
                  }
                >
                  <option value="full">Full withdrawal</option>
                  <option value="partial">Partial withdrawal</option>
                </select>
              </label>

              <label className="create-field">
                <span>Amount (₹)</span>
                <input
                  inputMode="decimal"
                  value={form.amount}
                  disabled={!form.investmentId || form.strategy === 'full'}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      amount: event.target.value.replace(/[^\d.]/g, ''),
                    }))
                  }
                  placeholder={form.strategy === 'full' ? 'Current value' : 'Enter amount'}
                />
              </label>
            </div>
          </section>

          <section className="create-section">
            <h3>Payout bank</h3>
            <label className="create-field">
              <span>Account Number</span>
              <select
                value={form.bankAccountId}
                disabled={!form.userId}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, bankAccountId: event.target.value }))
                }
              >
                <option value="">{form.userId ? 'Select account number' : 'Select a customer first'}</option>
                {banks.map((bank) => (
                  <option key={bank.id} value={bank.id}>
                    {bank.account_number}
                    {bank.is_primary ? ' (Primary)' : ''}
                  </option>
                ))}
              </select>
            </label>
          </section>
        </div>

        <footer className="create-customer-footer">
          <button type="button" className="ghost-btn" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </button>
          <button type="submit" className="gold-btn create-submit-btn" disabled={isSubmitting}>
            {isSubmitting ? 'Submitting…' : 'Submit Request'}
          </button>
        </footer>
      </form>
    </div>
  );
}
