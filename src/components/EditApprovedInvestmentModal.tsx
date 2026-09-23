import { useEffect, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import {
  getApprovedInvestmentEdit,
  updateApprovedInvestment,
} from '../services/investmentRequestService';
import { getClientSettings } from '../services/settingsService';
import type { ApprovedInvestmentEdit } from '../types/admin';
import { formatPercent } from '../utils/format';

const RELATIONSHIPS = [
  'Spouse',
  'Father',
  'Mother',
  'Son',
  'Daughter',
  'Brother',
  'Sister',
  'Other',
] as const;

const RATE_OPTIONS = [0.04, 0.05, 0.06, 0.07, 0.08];
const PAYOUT_DAYS = [1, 5, 10, 15, 20, 25];

type Props = {
  investmentId: string | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
};

type OfficeOption = { id: string; placeName: string };

type FormState = {
  fullName: string;
  email: string;
  mobile: string;
  dateOfBirth: string;
  address: string;
  panNumber: string;
  aadhaarNumber: string;
  nomineeName: string;
  nomineeRelationship: string;
  nomineeAadhaar: string;
  nomineePan: string;
  nomineeMobile: string;
  planName: string;
  fundAmount: string;
  interestRate: number;
  tdsPercent: number;
  payoutDay: number;
  bankName: string;
  accountNumber: string;
  ifscCode: string;
  accountType: 'Savings' | 'Current';
  accountHolderName: string;
  branchName: string;
  hasAgreement: boolean;
  officeId: string;
  chequeNo: string;
  chequeBankName: string;
  chequeBankAddress: string;
};

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

function toForm(detail: ApprovedInvestmentEdit, offices: OfficeOption[]): FormState {
  const accountType = detail.bank?.account_type === 'Current' ? 'Current' : 'Savings';
  const matched =
    offices.find((office) => office.id === detail.agreement?.officeId) ??
    offices.find(
      (office) =>
        office.placeName.trim().toLowerCase() ===
        String(detail.agreement?.placeName ?? '').trim().toLowerCase()
    );
  return {
    fullName: detail.customer.full_name,
    email: detail.customer.email,
    mobile: detail.customer.mobile,
    dateOfBirth: detail.customer.date_of_birth,
    address: detail.customer.address,
    panNumber: detail.customer.pan,
    aadhaarNumber: detail.customer.aadhaar,
    nomineeName: detail.nominee?.name ?? '',
    nomineeRelationship: detail.nominee?.relation || 'Other',
    nomineeAadhaar: detail.nominee?.aadhaar ?? '',
    nomineePan: detail.nominee?.pan ?? '',
    nomineeMobile: detail.nominee?.mobile ?? '',
    planName: detail.plan_name,
    fundAmount: String(detail.fund_amount || ''),
    interestRate: detail.interest_rate || 0.05,
    tdsPercent: detail.tds_percent > 0 ? 0.1 : 0,
    payoutDay: detail.payout_day || 10,
    bankName: detail.bank?.bank_name ?? '',
    accountNumber: detail.bank?.account_number ?? '',
    ifscCode: detail.bank?.ifsc_code ?? '',
    accountType,
    accountHolderName: detail.bank?.account_holder_name || detail.customer.full_name,
    branchName: detail.bank?.branch_name ?? '',
    hasAgreement: Boolean(detail.agreement),
    officeId: matched?.id ?? offices[0]?.id ?? '',
    chequeNo: detail.agreement?.cheque_no ?? '',
    chequeBankName: detail.agreement?.cheque_bank_name ?? '',
    chequeBankAddress: detail.agreement?.cheque_bank_address ?? '',
  };
}

export function EditApprovedInvestmentModal({
  investmentId,
  open,
  onClose,
  onSaved,
}: Props) {
  const [form, setForm] = useState<FormState | null>(null);
  const [offices, setOffices] = useState<OfficeOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ code: string | null; customerId: string | null }>({
    code: null,
    customerId: null,
  });

  useEffect(() => {
    if (!open || !investmentId) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setForm(null);
    void Promise.all([getApprovedInvestmentEdit(investmentId), getClientSettings()])
      .then(([detail, settings]) => {
        if (cancelled) return;
        const nextOffices = settings.agreementParty.offices
          .filter((office) => office.placeName.trim())
          .map((office) => ({ id: office.id, placeName: office.placeName }));
        setOffices(nextOffices);
        setMeta({ code: detail.code, customerId: detail.customer_id });
        setForm(toForm(detail, nextOffices));
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load investment');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, investmentId]);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!form || !investmentId) return;

    const amount = Number(form.fundAmount);
    if (!form.fullName.trim()) {
      setError('Full name is required.');
      return;
    }
    if (!form.dateOfBirth) {
      setError('Date of birth is required.');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Enter a valid fund amount.');
      return;
    }
    if (!/^\d{9,18}$/.test(digitsOnly(form.accountNumber))) {
      setError('Account number must be 9 to 18 digits.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await updateApprovedInvestment({
        id: investmentId,
        fullName: form.fullName,
        email: form.email,
        mobile: form.mobile,
        dateOfBirth: form.dateOfBirth,
        address: form.address,
        panNumber: form.panNumber,
        aadhaarNumber: form.aadhaarNumber,
        nomineeName: form.nomineeName,
        nomineeRelationship: form.nomineeRelationship,
        nomineeAadhaar: form.nomineeAadhaar,
        nomineePan: form.nomineePan,
        nomineeMobile: form.nomineeMobile,
        planName: form.planName,
        fundAmount: amount,
        interestRate: form.interestRate,
        tdsPercent: form.tdsPercent,
        payoutDay: form.payoutDay,
        bankName: form.bankName,
        accountNumber: digitsOnly(form.accountNumber),
        ifscCode: form.ifscCode,
        accountType: form.accountType,
        accountHolderName: form.accountHolderName,
        branchName: form.branchName,
        officeId: form.hasAgreement ? form.officeId : null,
        chequeNo: form.hasAgreement ? form.chequeNo : null,
        chequeBankName: form.hasAgreement ? form.chequeBankName : null,
        chequeBankAddress: form.hasAgreement ? form.chequeBankAddress : null,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save changes');
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <form
        className="create-customer-modal edit-approved-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-approved-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => void onSubmit(event)}
      >
        <header className="create-customer-head">
          <div>
            <h2 id="edit-approved-title">Edit Approved Investment</h2>
            <p>
              {meta.code || 'Plan'} · {meta.customerId || 'Customer'}
            </p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <div className="create-customer-body">
          {error ? <div className="error-box">{error}</div> : null}
          {loading || !form ? (
            <div className="state-box">Loading details…</div>
          ) : (
            <>
              <section className="create-section">
                <h3>Customer</h3>
                <div className="create-grid">
                  <label className="create-field">
                    <span>Full name</span>
                    <input
                      value={form.fullName}
                      onChange={(e) => setField('fullName', e.target.value)}
                    />
                  </label>
                  <label className="create-field">
                    <span>Email</span>
                    <input
                      value={form.email}
                      onChange={(e) => setField('email', e.target.value)}
                    />
                  </label>
                  <label className="create-field">
                    <span>Mobile</span>
                    <input
                      value={form.mobile}
                      onChange={(e) => setField('mobile', digitsOnly(e.target.value).slice(0, 10))}
                    />
                  </label>
                  <label className="create-field">
                    <span>Date of birth</span>
                    <input
                      type="date"
                      value={form.dateOfBirth}
                      onChange={(e) => setField('dateOfBirth', e.target.value)}
                    />
                  </label>
                  <label className="create-field create-field-span">
                    <span>Address</span>
                    <textarea
                      rows={2}
                      value={form.address}
                      onChange={(e) => setField('address', e.target.value)}
                    />
                  </label>
                  <label className="create-field">
                    <span>PAN</span>
                    <input
                      value={form.panNumber}
                      onChange={(e) =>
                        setField('panNumber', e.target.value.replace(/\s/g, '').toUpperCase().slice(0, 10))
                      }
                    />
                  </label>
                  <label className="create-field">
                    <span>Aadhaar</span>
                    <input
                      value={form.aadhaarNumber}
                      onChange={(e) =>
                        setField('aadhaarNumber', digitsOnly(e.target.value).slice(0, 12))
                      }
                    />
                  </label>
                </div>
              </section>

              <section className="create-section">
                <h3>Nominee</h3>
                <div className="create-grid">
                  <label className="create-field">
                    <span>Name</span>
                    <input
                      value={form.nomineeName}
                      onChange={(e) => setField('nomineeName', e.target.value)}
                    />
                  </label>
                  <label className="create-field">
                    <span>Relationship</span>
                    <select
                      value={form.nomineeRelationship}
                      onChange={(e) => setField('nomineeRelationship', e.target.value)}
                    >
                      {RELATIONSHIPS.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="create-field">
                    <span>Aadhaar</span>
                    <input
                      value={form.nomineeAadhaar}
                      onChange={(e) =>
                        setField('nomineeAadhaar', digitsOnly(e.target.value).slice(0, 12))
                      }
                    />
                  </label>
                  <label className="create-field">
                    <span>PAN</span>
                    <input
                      value={form.nomineePan}
                      onChange={(e) =>
                        setField('nomineePan', e.target.value.replace(/\s/g, '').toUpperCase().slice(0, 10))
                      }
                    />
                  </label>
                  <label className="create-field">
                    <span>Mobile</span>
                    <input
                      value={form.nomineeMobile}
                      onChange={(e) =>
                        setField('nomineeMobile', digitsOnly(e.target.value).slice(0, 10))
                      }
                    />
                  </label>
                </div>
              </section>

              <section className="create-section">
                <h3>Investment</h3>
                <div className="create-grid">
                  <label className="create-field">
                    <span>Fund title</span>
                    <input
                      value={form.planName}
                      onChange={(e) => setField('planName', e.target.value)}
                    />
                  </label>
                  <label className="create-field">
                    <span>Amount (₹)</span>
                    <input
                      inputMode="decimal"
                      value={form.fundAmount}
                      onChange={(e) =>
                        setField('fundAmount', e.target.value.replace(/[^\d.]/g, ''))
                      }
                    />
                  </label>
                  <label className="create-field">
                    <span>Interest (p.m.)</span>
                    <select
                      value={form.interestRate}
                      onChange={(e) => setField('interestRate', Number(e.target.value))}
                    >
                      {(RATE_OPTIONS.includes(form.interestRate)
                        ? RATE_OPTIONS
                        : [...RATE_OPTIONS, form.interestRate].sort((a, b) => a - b)
                      ).map((rate) => (
                        <option key={rate} value={rate}>
                          {formatPercent(rate)} p.m.
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="create-field">
                    <span>TDS</span>
                    <select
                      value={form.tdsPercent > 0 ? '10' : '0'}
                      onChange={(e) => setField('tdsPercent', e.target.value === '10' ? 0.1 : 0)}
                    >
                      <option value="10">File TDS (10%)</option>
                      <option value="0">Not File TDS</option>
                    </select>
                  </label>
                  <label className="create-field">
                    <span>Payout day</span>
                    <select
                      value={form.payoutDay}
                      onChange={(e) => setField('payoutDay', Number(e.target.value))}
                    >
                      {PAYOUT_DAYS.map((day) => (
                        <option key={day} value={day}>
                          {day === 1 ? '1st' : `${day}th`}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </section>

              <section className="create-section">
                <h3>Bank account</h3>
                <p className="muted" style={{ marginTop: 0 }}>
                  Changing bank details adds a new account for the customer and links this investment
                  to it.
                </p>
                <div className="create-grid">
                  <label className="create-field">
                    <span>Account holder</span>
                    <input
                      value={form.accountHolderName}
                      onChange={(e) => setField('accountHolderName', e.target.value)}
                    />
                  </label>
                  <label className="create-field">
                    <span>Bank name</span>
                    <input
                      value={form.bankName}
                      onChange={(e) => setField('bankName', e.target.value)}
                    />
                  </label>
                  <label className="create-field">
                    <span>Account number</span>
                    <input
                      value={form.accountNumber}
                      onChange={(e) =>
                        setField('accountNumber', digitsOnly(e.target.value).slice(0, 18))
                      }
                    />
                  </label>
                  <label className="create-field">
                    <span>IFSC</span>
                    <input
                      value={form.ifscCode}
                      onChange={(e) =>
                        setField('ifscCode', e.target.value.replace(/\s/g, '').toUpperCase().slice(0, 11))
                      }
                    />
                  </label>
                  <label className="create-field">
                    <span>Branch</span>
                    <input
                      value={form.branchName}
                      onChange={(e) => setField('branchName', e.target.value)}
                    />
                  </label>
                  <label className="create-field">
                    <span>Account type</span>
                    <select
                      value={form.accountType}
                      onChange={(e) =>
                        setField('accountType', e.target.value as 'Savings' | 'Current')
                      }
                    >
                      <option value="Savings">Savings</option>
                      <option value="Current">Current</option>
                    </select>
                  </label>
                </div>
              </section>

              {form.hasAgreement ? (
                <section className="create-section">
                  <h3>Agreement cheque details</h3>
                  <div className="create-grid">
                    {offices.length > 0 ? (
                      <label className="create-field">
                        <span>Office / place</span>
                        <select
                          value={form.officeId}
                          onChange={(e) => setField('officeId', e.target.value)}
                        >
                          {offices.map((office) => (
                            <option key={office.id} value={office.id}>
                              {office.placeName}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    <label className="create-field">
                      <span>Cheque no.</span>
                      <input
                        value={form.chequeNo}
                        onChange={(e) => setField('chequeNo', e.target.value)}
                      />
                    </label>
                    <label className="create-field">
                      <span>Cheque bank name</span>
                      <input
                        value={form.chequeBankName}
                        onChange={(e) => setField('chequeBankName', e.target.value)}
                      />
                    </label>
                    <label className="create-field create-field-span">
                      <span>Cheque bank address</span>
                      <textarea
                        rows={2}
                        value={form.chequeBankAddress}
                        onChange={(e) => setField('chequeBankAddress', e.target.value)}
                      />
                    </label>
                  </div>
                </section>
              ) : null}
            </>
          )}
        </div>

        <footer className="create-customer-footer">
          <button type="button" className="ghost-btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="submit"
            className="primary-btn"
            disabled={saving || loading || !form}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </footer>
      </form>
    </div>
  );
}
