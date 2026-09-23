import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { EmptyState, ErrorBanner } from './States';
import {
  addCustomerBank,
  getClientCustomer,
  setCustomerStatus,
  updateCustomerBank,
  updateCustomerProfile,
  updateInvestmentBank,
} from '../services/clientCustomerService';
import type {
  CustomerBank,
  CustomerDetailsPayload,
  CustomerListItem,
  CustomerNominee,
} from '../types/platform';
import {
  displayCustomerId,
  formatDate,
  formatInr,
  formatLedgerType,
  formatMobile,
  formatSignedInr,
} from '../utils/format';

type Neighbor = Pick<CustomerListItem, 'id'>;

type Props = {
  customerId: string;
  onClose: () => void;
  loadCustomer?: (id: string) => Promise<CustomerDetailsPayload>;
  onChanged?: () => void;
  neighbors?: Neighbor[];
  onNavigate?: (id: string) => void;
};

type ProfileForm = {
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
};

type BankForm = {
  bankName: string;
  accountNumber: string;
  ifscCode: string;
  accountType: 'Savings' | 'Current';
  accountHolderName: string;
  isPrimary: boolean;
};

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

const TABS = [
  { id: 'profile', label: 'Profile' },
  { id: 'banks', label: 'Banks' },
  { id: 'investments', label: 'Investments' },
  { id: 'transactions', label: 'Transactions' },
] as const;

const EMPTY_BANK: BankForm = {
  bankName: '',
  accountNumber: '',
  ifscCode: '',
  accountType: 'Savings',
  accountHolderName: '',
  isPrimary: false,
};

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

function toDobInput(value: string): string {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  return value;
}

function profileToForm(
  customer: CustomerListItem,
  nominee: CustomerNominee | undefined
): ProfileForm {
  return {
    fullName: customer.fullName || '',
    email: customer.emailAddress || '',
    mobile: digitsOnly(customer.mobileNumber || '').slice(-10),
    dateOfBirth: toDobInput(String(customer.dateOfBirth || '')),
    address: customer.address || '',
    panNumber: customer.panNumber || '',
    aadhaarNumber: digitsOnly(customer.aadhaarNumber || ''),
    nomineeName: nominee?.nomineeName || '',
    nomineeRelationship: nominee?.relationship || '',
    nomineeAadhaar: digitsOnly(nominee?.nomineeAadhaar || ''),
    nomineePan: nominee?.nomineePan || '',
    nomineeMobile: digitsOnly(nominee?.nomineeMobile || '').slice(-10),
  };
}

function bankToForm(bank: CustomerBank): BankForm {
  return {
    bankName: bank.bankName || '',
    accountNumber: bank.accountNumber || '',
    ifscCode: bank.ifscCode || '',
    accountType: bank.accountType === 'Current' ? 'Current' : 'Savings',
    accountHolderName: bank.accountHolderName || '',
    isPrimary: bank.isPrimary,
  };
}

function bankLabel(bank: CustomerBank): string {
  return `${bank.bankName || 'Bank'} · ${bank.accountNumber}${bank.isPrimary ? ' (Primary)' : ''}`;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-field">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EditField({
  label,
  value,
  onChange,
  type = 'text',
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <label className="detail-field edit-field">
      <span>{label}</span>
      <input type={type} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function BankEditFields({
  form,
  setForm,
  disabled,
}: {
  form: BankForm;
  setForm: (next: BankForm) => void;
  disabled?: boolean;
}) {
  return (
    <div className="detail-grid">
      <EditField
        label="ACCOUNT HOLDER"
        value={form.accountHolderName}
        onChange={(v) => setForm({ ...form, accountHolderName: v })}
        disabled={disabled}
      />
      <EditField
        label="BANK / BRANCH"
        value={form.bankName}
        onChange={(v) => setForm({ ...form, bankName: v })}
        disabled={disabled}
      />
      <EditField
        label="ACCOUNT NUMBER"
        value={form.accountNumber}
        onChange={(v) => setForm({ ...form, accountNumber: digitsOnly(v).slice(0, 18) })}
        disabled={disabled}
      />
      <EditField
        label="IFSC CODE"
        value={form.ifscCode}
        onChange={(v) => setForm({ ...form, ifscCode: v.toUpperCase().replace(/\s/g, '').slice(0, 11) })}
        disabled={disabled}
      />
      <label className="detail-field edit-field">
        <span>ACCOUNT TYPE</span>
        <select
          value={form.accountType}
          disabled={disabled}
          onChange={(e) =>
            setForm({ ...form, accountType: e.target.value === 'Current' ? 'Current' : 'Savings' })
          }
        >
          <option value="Savings">Savings</option>
          <option value="Current">Current</option>
        </select>
      </label>
      <label className="detail-field edit-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <input
          type="checkbox"
          checked={form.isPrimary}
          disabled={disabled}
          onChange={(e) => setForm({ ...form, isPrimary: e.target.checked })}
        />
        <span>Set as primary account</span>
      </label>
    </div>
  );
}

export function ClientCustomerDetailsModal({
  customerId,
  onClose,
  loadCustomer,
  onChanged,
  neighbors = [],
  onNavigate,
}: Props) {
  const canEdit = Boolean(onChanged);
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('profile');
  const [data, setData] = useState<CustomerDetailsPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState<ProfileForm | null>(null);
  const [editingBankId, setEditingBankId] = useState<string | null>(null);
  const [addingBank, setAddingBank] = useState(false);
  const [bankForm, setBankForm] = useState<BankForm>(EMPTY_BANK);
  const [investmentBanks, setInvestmentBanks] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const nominee = data?.nominees[0];

  async function load(options?: { silent?: boolean }) {
    if (!options?.silent) {
      setIsLoading(true);
    }
    setError(null);
    try {
      const next = await (loadCustomer ?? getClientCustomer)(customerId);
      setData(next);
      setProfileForm(profileToForm(next.customer, next.nominees[0]));
      const map: Record<string, string> = {};
      for (const inv of next.investments ?? []) {
        map[inv.id] = inv.bankAccountId ?? '';
      }
      setInvestmentBanks(map);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load customer.');
    } finally {
      if (!options?.silent) {
        setIsLoading(false);
      }
    }
  }

  useEffect(() => {
    setTab('profile');
    setEditingProfile(false);
    setEditingBankId(null);
    setAddingBank(false);
    setSaveError(null);
    setNotice(null);
    void load();
  }, [customerId]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const index = neighbors.findIndex((row) => row.id === customerId);
  const previous = index > 0 ? neighbors[index - 1] : undefined;
  const next = index >= 0 && index < neighbors.length - 1 ? neighbors[index + 1] : undefined;

  async function saveProfile() {
    if (!profileForm) return;
    setSaving(true);
    setSaveError(null);
    try {
      const next = await updateCustomerProfile(customerId, {
        fullName: profileForm.fullName.trim(),
        email: profileForm.email.trim(),
        mobile: digitsOnly(profileForm.mobile),
        dateOfBirth: profileForm.dateOfBirth,
        address: profileForm.address.trim(),
        panNumber: profileForm.panNumber.trim().toUpperCase(),
        aadhaarNumber: digitsOnly(profileForm.aadhaarNumber),
        nomineeName: profileForm.nomineeName.trim(),
        nomineeRelationship: profileForm.nomineeRelationship.trim(),
        nomineeAadhaar: digitsOnly(profileForm.nomineeAadhaar),
        nomineePan: profileForm.nomineePan.trim().toUpperCase(),
        nomineeMobile: digitsOnly(profileForm.nomineeMobile),
      });
      setData(next);
      setProfileForm(profileToForm(next.customer, next.nominees[0]));
      setEditingProfile(false);
      setNotice('Profile saved.');
      onChanged?.();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save profile.');
    } finally {
      setSaving(false);
    }
  }

  async function saveBank(bankId: string | null) {
    setSaving(true);
    setSaveError(null);
    try {
      const payload = {
        accountHolderName: bankForm.accountHolderName.trim(),
        bankName: bankForm.bankName.trim(),
        accountNumber: digitsOnly(bankForm.accountNumber),
        ifscCode: bankForm.ifscCode.replace(/\s/g, '').toUpperCase(),
        accountType: bankForm.accountType,
        isPrimary: bankForm.isPrimary,
      };
      const next = bankId
        ? await updateCustomerBank(customerId, bankId, payload)
        : await addCustomerBank(customerId, payload);
      setData(next);
      setEditingBankId(null);
      setAddingBank(false);
      setBankForm(EMPTY_BANK);
      setNotice(bankId ? 'Bank account updated.' : 'Bank account added.');
      onChanged?.();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save bank account.');
    } finally {
      setSaving(false);
    }
  }

  async function saveInvestmentPayout(investmentId: string, currentBankId: string | null | undefined) {
    const bankId = investmentBanks[investmentId];
    if (!bankId || bankId === currentBankId) {
      setSaveError('Select a different bank account to save.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const next = await updateInvestmentBank(customerId, investmentId, bankId);
      setData(next);
      setNotice('Payout bank updated.');
      onChanged?.();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not update investment bank.');
    } finally {
      setSaving(false);
    }
  }

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
            <p>Customer ID: {displayCustomerId(data?.customer.customerCode)}</p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <nav className="customer-tabs">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={tab === item.id ? 'active' : ''}
              onClick={() => {
                setTab(item.id);
                setSaveError(null);
                setNotice(null);
              }}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
        {saveError ? <div className="error-box" style={{ margin: '0 0 12px' }}>{saveError}</div> : null}
        {notice ? <div className="notice-box success" style={{ margin: '0 0 12px' }}>{notice}</div> : null}

        {isLoading || !data || !profileForm ? (
          <div className="state-box">{isLoading ? 'Loading customer…' : 'Customer not found'}</div>
        ) : (
          <>
            {tab === 'profile' ? (
              <div className="detail-stack">
                <article className="detail-card">
                  <div className="detail-card-toolbar">
                    <h3>Profile</h3>
                    {canEdit ? (
                      editingProfile ? (
                        <div className="detail-card-actions">
                          <button
                            type="button"
                            className="ghost-btn"
                            disabled={saving}
                            onClick={() => {
                              setEditingProfile(false);
                              setProfileForm(profileToForm(data.customer, nominee));
                              setSaveError(null);
                            }}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="primary-btn"
                            disabled={saving}
                            onClick={() => void saveProfile()}
                          >
                            {saving ? 'Saving…' : 'Save changes'}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="ghost-btn"
                          onClick={() => {
                            setEditingProfile(true);
                            setNotice(null);
                          }}
                        >
                          Edit
                        </button>
                      )
                    ) : null}
                  </div>

                  {editingProfile ? (
                    <div className="detail-grid">
                      <EditField
                        label="FULL NAME"
                        value={profileForm.fullName}
                        onChange={(v) => setProfileForm({ ...profileForm, fullName: v })}
                        disabled={saving}
                      />
                      <EditField
                        label="EMAIL ADDRESS"
                        value={profileForm.email}
                        onChange={(v) => setProfileForm({ ...profileForm, email: v })}
                        disabled={saving}
                      />
                      <EditField
                        label="PHONE NUMBER"
                        value={profileForm.mobile}
                        onChange={(v) =>
                          setProfileForm({ ...profileForm, mobile: digitsOnly(v).slice(0, 10) })
                        }
                        disabled={saving}
                      />
                      <EditField
                        label="DATE OF BIRTH"
                        type="date"
                        value={profileForm.dateOfBirth}
                        onChange={(v) => setProfileForm({ ...profileForm, dateOfBirth: v })}
                        disabled={saving}
                      />
                      <EditField
                        label="PAN NUMBER"
                        value={profileForm.panNumber}
                        onChange={(v) =>
                          setProfileForm({
                            ...profileForm,
                            panNumber: v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10),
                          })
                        }
                        disabled={saving}
                      />
                      <EditField
                        label="AADHAAR NUMBER"
                        value={profileForm.aadhaarNumber}
                        onChange={(v) =>
                          setProfileForm({ ...profileForm, aadhaarNumber: digitsOnly(v).slice(0, 12) })
                        }
                        disabled={saving}
                      />
                    </div>
                  ) : (
                    <div className="detail-grid">
                      <Field label="FULL NAME" value={data.customer.fullName} />
                      <Field label="EMAIL ADDRESS" value={data.customer.emailAddress} />
                      <Field label="PHONE NUMBER" value={formatMobile(data.customer.mobileNumber)} />
                      <Field label="DATE OF BIRTH" value={formatDate(String(data.customer.dateOfBirth))} />
                      <Field label="PAN NUMBER" value={data.customer.panNumber || '—'} />
                      <Field label="AADHAAR NUMBER" value={data.customer.aadhaarNumber || '—'} />
                      <Field label="REFERRAL CODE" value={data.customer.referralCode} />
                      <Field label="STATUS" value={data.customer.status} />
                    </div>
                  )}

                  {canEdit && !editingProfile ? (
                    <div className="profile-status-actions">
                      <button
                        type="button"
                        className="ghost-btn"
                        disabled={isUpdatingStatus}
                        onClick={() => {
                          void (async () => {
                            const nextStatus =
                              data.customer.status === 'active' ? 'inactive' : 'active';
                            setIsUpdatingStatus(true);
                            setError(null);
                            try {
                              await setCustomerStatus(customerId, nextStatus);
                              await load({ silent: true });
                              onChanged?.();
                            } catch (err) {
                              setError(
                                err instanceof Error
                                  ? err.message
                                  : 'Unable to update customer status.'
                              );
                            } finally {
                              setIsUpdatingStatus(false);
                            }
                          })();
                        }}
                      >
                        {data.customer.status === 'active' ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  ) : null}
                </article>

                <article className="detail-card">
                  <h3>Nominee</h3>
                  {editingProfile ? (
                    <div className="detail-grid">
                      <EditField
                        label="NOMINEE NAME"
                        value={profileForm.nomineeName}
                        onChange={(v) => setProfileForm({ ...profileForm, nomineeName: v })}
                        disabled={saving}
                      />
                      <label className="detail-field edit-field">
                        <span>RELATIONSHIP</span>
                        <select
                          value={profileForm.nomineeRelationship}
                          disabled={saving}
                          onChange={(e) =>
                            setProfileForm({ ...profileForm, nomineeRelationship: e.target.value })
                          }
                        >
                          <option value="">Select relationship</option>
                          {RELATIONSHIPS.map((item) => (
                            <option key={item} value={item}>
                              {item}
                            </option>
                          ))}
                        </select>
                      </label>
                      <EditField
                        label="NOMINEE AADHAAR"
                        value={profileForm.nomineeAadhaar}
                        onChange={(v) =>
                          setProfileForm({ ...profileForm, nomineeAadhaar: digitsOnly(v).slice(0, 12) })
                        }
                        disabled={saving}
                      />
                      <EditField
                        label="NOMINEE PAN"
                        value={profileForm.nomineePan}
                        onChange={(v) =>
                          setProfileForm({
                            ...profileForm,
                            nomineePan: v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10),
                          })
                        }
                        disabled={saving}
                      />
                      <EditField
                        label="NOMINEE PHONE"
                        value={profileForm.nomineeMobile}
                        onChange={(v) =>
                          setProfileForm({ ...profileForm, nomineeMobile: digitsOnly(v).slice(0, 10) })
                        }
                        disabled={saving}
                      />
                    </div>
                  ) : (
                    <div className="detail-grid">
                      <Field label="NOMINEE NAME" value={nominee?.nomineeName || '—'} />
                      <Field label="RELATIONSHIP" value={nominee?.relationship || '—'} />
                      <Field label="NOMINEE AADHAAR" value={nominee?.nomineeAadhaar || '—'} />
                      <Field label="NOMINEE PAN" value={nominee?.nomineePan || '—'} />
                      <Field
                        label="NOMINEE PHONE"
                        value={nominee?.nomineeMobile ? formatMobile(nominee.nomineeMobile) : '—'}
                      />
                    </div>
                  )}
                </article>

                <article className="detail-card">
                  <h3>Address</h3>
                  {editingProfile ? (
                    <div className="detail-grid">
                      <EditField
                        label="FULL ADDRESS"
                        value={profileForm.address}
                        onChange={(v) => setProfileForm({ ...profileForm, address: v })}
                        disabled={saving}
                      />
                    </div>
                  ) : (
                    <p>{data.customer.address || '—'}</p>
                  )}
                </article>

                <article className="summary-card">
                  <h3>Investment Summary</h3>
                  <div className="summary-grid">
                    <div>
                      <span>TOTAL INVESTED</span>
                      <strong>{formatInr(data.summary.totalInvested)}</strong>
                    </div>
                    <div>
                      <span>ACTIVE PLANS</span>
                      <strong>{data.summary.activePlans}</strong>
                    </div>
                    <div>
                      <span>RETURNS EARNED</span>
                      <strong>{formatInr(data.summary.returnsEarned)}</strong>
                    </div>
                  </div>
                </article>
              </div>
            ) : null}

            {tab === 'banks' ? (
              <div className="detail-stack">
                <div className="detail-card-toolbar" style={{ padding: '0 4px' }}>
                  <h3 style={{ margin: 0 }}>Bank accounts</h3>
                  {canEdit && !addingBank ? (
                    <button
                      type="button"
                      className="primary-btn"
                      onClick={() => {
                        setAddingBank(true);
                        setEditingBankId(null);
                        setBankForm({
                          ...EMPTY_BANK,
                          accountHolderName: data.customer.fullName,
                          isPrimary: data.banks.length === 0,
                        });
                        setNotice(null);
                      }}
                    >
                      + Add bank
                    </button>
                  ) : null}
                </div>

                {addingBank ? (
                  <article className="detail-card bank-card">
                    <div className="detail-card-toolbar">
                      <h3>New bank account</h3>
                      <div className="detail-card-actions">
                        <button
                          type="button"
                          className="ghost-btn"
                          disabled={saving}
                          onClick={() => {
                            setAddingBank(false);
                            setBankForm(EMPTY_BANK);
                          }}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="primary-btn"
                          disabled={saving}
                          onClick={() => void saveBank(null)}
                        >
                          {saving ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                    </div>
                    <BankEditFields form={bankForm} setForm={setBankForm} disabled={saving} />
                  </article>
                ) : null}

                {data.banks.length === 0 && !addingBank ? (
                  <EmptyState
                    title="No bank accounts"
                    message="Add a bank account so payouts can be linked to investments."
                  />
                ) : (
                  data.banks.map((bank) => {
                    const editing = editingBankId === bank.id;
                    return (
                      <article key={bank.id} className="detail-card bank-card">
                        <div className="detail-card-toolbar">
                          <div>
                            {bank.isPrimary ? <span className="primary-badge">Primary</span> : null}
                          </div>
                          {canEdit ? (
                            editing ? (
                              <div className="detail-card-actions">
                                <button
                                  type="button"
                                  className="ghost-btn"
                                  disabled={saving}
                                  onClick={() => {
                                    setEditingBankId(null);
                                    setBankForm(EMPTY_BANK);
                                  }}
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  className="primary-btn"
                                  disabled={saving}
                                  onClick={() => void saveBank(bank.id)}
                                >
                                  {saving ? 'Saving…' : 'Save changes'}
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                className="ghost-btn"
                                onClick={() => {
                                  setAddingBank(false);
                                  setEditingBankId(bank.id);
                                  setBankForm(bankToForm(bank));
                                  setNotice(null);
                                }}
                              >
                                Edit
                              </button>
                            )
                          ) : null}
                        </div>

                        {editing ? (
                          <BankEditFields form={bankForm} setForm={setBankForm} disabled={saving} />
                        ) : (
                          <div className="detail-grid">
                            <Field label="ACCOUNT HOLDER" value={bank.accountHolderName || '—'} />
                            <Field label="BANK / BRANCH" value={bank.bankName || '—'} />
                            <Field label="ACCOUNT NUMBER" value={bank.accountNumber} />
                            <Field label="IFSC CODE" value={bank.ifscCode} />
                            <Field label="ACCOUNT TYPE" value={bank.accountType} />
                          </div>
                        )}
                      </article>
                    );
                  })
                )}
              </div>
            ) : null}

            {tab === 'investments' ? (
              <div className="detail-stack">
                {(data.investments ?? []).length === 0 ? (
                  <EmptyState
                    title="No investments"
                    message="Pending or active plans will appear here so you can change the payout bank."
                  />
                ) : (
                  (data.investments ?? []).map((inv) => {
                    const selected = investmentBanks[inv.id] ?? inv.bankAccountId ?? '';
                    const dirty = selected && selected !== (inv.bankAccountId ?? '');
                    return (
                      <article key={inv.id} className="detail-card">
                        <div className="detail-card-toolbar">
                          <div>
                            <h3 style={{ margin: 0 }}>{inv.code || inv.name}</h3>
                            <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 13 }}>
                              {inv.name} · {formatInr(inv.fundAmount)} · {inv.status}
                            </p>
                          </div>
                          {canEdit ? (
                            <button
                              type="button"
                              className="primary-btn"
                              disabled={saving || !dirty || data.banks.length === 0}
                              onClick={() => void saveInvestmentPayout(inv.id, inv.bankAccountId)}
                            >
                              {saving ? 'Saving…' : 'Save bank'}
                            </button>
                          ) : null}
                        </div>
                        {canEdit ? (
                          <label className="detail-field edit-field">
                            <span>PAYOUT BANK ACCOUNT</span>
                            <select
                              value={selected}
                              disabled={saving || data.banks.length === 0}
                              onChange={(event) =>
                                setInvestmentBanks((prev) => ({
                                  ...prev,
                                  [inv.id]: event.target.value,
                                }))
                              }
                            >
                              <option value="">Select bank account</option>
                              {data.banks.map((bank) => (
                                <option key={bank.id} value={bank.id}>
                                  {bankLabel(bank)}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : (
                          <Field
                            label="PAYOUT BANK ACCOUNT"
                            value={
                              data.banks.find((bank) => bank.id === inv.bankAccountId)
                                ? bankLabel(data.banks.find((bank) => bank.id === inv.bankAccountId)!)
                                : '—'
                            }
                          />
                        )}
                      </article>
                    );
                  })
                )}
              </div>
            ) : null}

            {tab === 'transactions' ? (
              <div className="detail-stack">
                <article className="detail-card">
                  <h3>Recent Transactions</h3>
                  {(data.transactions ?? []).length === 0 ? (
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
                          </tr>
                        </thead>
                        <tbody>
                          {(data.transactions ?? []).map((row) => {
                            const amount = formatSignedInr(row.transactionType, row.amount);
                            return (
                              <tr key={row.id}>
                                <td>{formatDate(row.transactionDate)}</td>
                                <td>{formatLedgerType(row.transactionType)}</td>
                                <td className={amount.tone}>{amount.display}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </article>
                <article className="detail-card">
                  <h3>Payouts</h3>
                  {(data.withdrawals ?? []).length === 0 ? (
                    <p className="muted-line">No withdrawal requests.</p>
                  ) : (
                    <div className="table-scroll">
                      <table className="data-table activity-table">
                        <thead>
                          <tr>
                            <th>Fund</th>
                            <th>Amount</th>
                            <th>Status</th>
                            <th>Requested</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(data.withdrawals ?? []).map((item) => (
                            <tr key={item.id}>
                              <td>
                                {item.investmentCode}
                                <div className="muted-line">{item.strategy}</div>
                              </td>
                              <td>{formatInr(item.netPayout || item.withdrawalAmount)}</td>
                              <td>{item.status}</td>
                              <td>{formatDate(item.requestedOn)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </article>
              </div>
            ) : null}
          </>
        )}

        {onNavigate && neighbors.length > 1 ? (
          <footer className="customer-modal-nav">
            <button
              type="button"
              className="nav-pill"
              disabled={!previous}
              onClick={() => previous && onNavigate(previous.id)}
              aria-label="Previous customer"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              className="nav-pill"
              disabled={!next}
              onClick={() => next && onNavigate(next.id)}
              aria-label="Next customer"
            >
              <ChevronRight size={16} />
            </button>
          </footer>
        ) : null}
      </section>
    </div>
  );
}
