import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import {
  createInvestmentRequest,
  listCustomerBanks,
  listCustomerOptions,
  type CustomerBankOption,
  type CustomerOption,
} from '../services/investmentRequestService';

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (result: { customerId: string | null; amount: number }) => void;
};

type FormState = {
  userId: string;
  customerId: string;
  customerName: string;
  fundTitle: string;
  amount: string;
  bankAccountId: string;
  branchName: string;
};

const EMPTY: FormState = {
  userId: '',
  customerId: '',
  customerName: '',
  fundTitle: '',
  amount: '',
  bankAccountId: '',
  branchName: '',
};

function defaultFundTitle(investmentCount: number): string {
  return `Investment ${Math.max(0, investmentCount) + 1}`;
}

export function AddInvestmentModal({ open, onClose, onCreated }: Props) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [options, setOptions] = useState<CustomerOption[]>([]);
  const [banks, setBanks] = useState<CustomerBankOption[]>([]);
  const [search, setSearch] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [loadingBanks, setLoadingBanks] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setForm(EMPTY);
    setSearch('');
    setBanks([]);
    setMenuOpen(false);
    setError(null);
    setFieldErrors({});
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    const handle = window.setTimeout(() => {
      setLoadingOptions(true);
      void listCustomerOptions(search)
        .then((rows) => {
          if (!cancelled) {
            setOptions(rows);
          }
        })
        .catch((err) => {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : 'Failed to load customers');
          }
        })
        .finally(() => {
          if (!cancelled) {
            setLoadingOptions(false);
          }
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [open, search]);

  useEffect(() => {
    if (!open || !form.userId) {
      setBanks([]);
      return;
    }
    let cancelled = false;
    setLoadingBanks(true);
    void listCustomerBanks(form.userId)
      .then((rows) => {
        if (!cancelled) {
          setBanks(rows);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load bank accounts');
          setBanks([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingBanks(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, form.userId]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }
    function onPointer(event: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onPointer);
    };
  }, [open, onClose]);

  const filteredHint = useMemo(() => {
    if (loadingOptions) return 'Searching…';
    if (options.length === 0) return 'No customers found';
    return null;
  }, [loadingOptions, options.length]);

  if (!open) {
    return null;
  }

  function selectCustomer(row: CustomerOption) {
    setForm((prev) => ({
      ...prev,
      userId: row.user_id,
      customerId: row.customer_id ?? '',
      customerName: row.full_name,
      fundTitle: defaultFundTitle(row.investment_count),
      bankAccountId: '',
      branchName: '',
    }));
    setSearch(row.full_name);
    setMenuOpen(false);
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next.customerName;
      delete next.bankAccountId;
      delete next.fundTitle;
      return next;
    });
  }

  function onBankChange(bankId: string) {
    const bank = banks.find((row) => row.id === bankId);
    setForm((prev) => ({
      ...prev,
      bankAccountId: bankId,
      branchName: bank?.branch_name || bank?.bank_name || '',
    }));
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next.bankAccountId;
      return next;
    });
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const nextErrors: Partial<Record<keyof FormState, string>> = {};

    if (!form.userId) nextErrors.customerName = 'Select a customer.';
    if (!form.fundTitle.trim()) nextErrors.fundTitle = 'Fund title is required.';
    const amount = Number(form.amount.replace(/,/g, ''));
    if (!form.amount.trim() || !Number.isFinite(amount) || amount <= 0) {
      nextErrors.amount = 'Enter a valid amount.';
    }
    if (!form.bankAccountId) {
      nextErrors.bankAccountId = 'Select an account number.';
    }

    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await createInvestmentRequest({
        userId: form.userId,
        amount,
        bankAccountId: form.bankAccountId,
        fundTitle: form.fundTitle.trim(),
      });
      onCreated({
        customerId: result.customer_id,
        amount: result.fund_amount,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create investment request.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="create-customer-modal add-investment-modal"
        role="dialog"
        aria-labelledby="add-investment-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => void onSubmit(event)}
      >
        <header className="create-customer-head">
          <h2 id="add-investment-title">Add Investment</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <div className="create-customer-body">
          {error ? <div className="error-box">{error}</div> : null}

          <section className="create-section">
            <h3>Customer Details</h3>
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
                        setForm((prev) => ({
                          ...prev,
                          userId: '',
                          customerId: '',
                          customerName: '',
                          fundTitle: '',
                          bankAccountId: '',
                          branchName: '',
                        }));
                        setBanks([]);
                      }}
                    />
                    <ChevronDown size={16} />
                  </div>
                  {menuOpen ? (
                    <ul className="customer-combobox-menu">
                      {filteredHint ? <li className="customer-combobox-empty">{filteredHint}</li> : null}
                      {options.map((row) => (
                        <li key={row.user_id}>
                          <button type="button" onClick={() => selectCustomer(row)}>
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
                {fieldErrors.customerName ? <em>{fieldErrors.customerName}</em> : null}
              </label>

              <label className="create-field">
                <span>Customer ID</span>
                <input value={form.customerId} placeholder="Auto-populated" readOnly />
              </label>
            </div>

            <div className="create-grid" style={{ marginTop: 14 }}>
              <label className="create-field">
                <span>Fund Title</span>
                <input
                  value={form.fundTitle}
                  disabled={!form.userId}
                  onChange={(event) => {
                    setForm((prev) => ({ ...prev, fundTitle: event.target.value }));
                    setFieldErrors((prev) => {
                      const next = { ...prev };
                      delete next.fundTitle;
                      return next;
                    });
                  }}
                  placeholder={form.userId ? 'e.g. Investment 1' : 'Select a customer first'}
                />
                {fieldErrors.fundTitle ? <em>{fieldErrors.fundTitle}</em> : null}
              </label>

              <label className="create-field">
                <span>Amount (₹)</span>
                <input
                  inputMode="decimal"
                  value={form.amount}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      amount: event.target.value.replace(/[^\d.]/g, ''),
                    }))
                  }
                  placeholder="Enter amount"
                />
                {fieldErrors.amount ? <em>{fieldErrors.amount}</em> : null}
              </label>
            </div>
          </section>

          <section className="create-section">
            <h3>Bank & Reference Details</h3>
            <div className="create-grid">
              <label className="create-field">
                <span>Account Number</span>
                <select
                  value={form.bankAccountId}
                  disabled={!form.userId || loadingBanks}
                  onChange={(event) => onBankChange(event.target.value)}
                >
                  <option value="">
                    {!form.userId
                      ? 'Select a customer first'
                      : loadingBanks
                        ? 'Loading accounts…'
                        : banks.length === 0
                          ? 'No bank accounts found'
                          : 'Select account number'}
                  </option>
                  {banks.map((bank) => (
                    <option key={bank.id} value={bank.id}>
                      {bank.account_number}
                      {bank.is_primary ? ' (Primary)' : ''}
                    </option>
                  ))}
                </select>
                {fieldErrors.bankAccountId ? <em>{fieldErrors.bankAccountId}</em> : null}
              </label>

              <label className="create-field">
                <span>Branch Name</span>
                <input value={form.branchName} placeholder="Auto-populated" readOnly />
              </label>
            </div>
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
