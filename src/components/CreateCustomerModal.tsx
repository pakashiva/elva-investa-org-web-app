import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Calendar, X } from 'lucide-react';
import { createCustomer, type CreateCustomerInput } from '../services/clientCustomerService';

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

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
};

type FormState = {
  fullName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  panNumber: string;
  aadhaarNumber: string;
  nomineeName: string;
  nomineeRelationship: string;
  nomineeAadhaar: string;
  nomineePan: string;
  nomineeMobile: string;
  address: string;
  referredByCode: string;
  accountHolderName: string;
  accountNumber: string;
  ifscCode: string;
  branchName: string;
  accountType: 'Savings' | 'Current' | '';
};

type FieldErrors = Partial<Record<keyof FormState, string>>;

const EMPTY: FormState = {
  fullName: '',
  email: '',
  phone: '',
  dateOfBirth: '',
  panNumber: '',
  aadhaarNumber: '',
  nomineeName: '',
  nomineeRelationship: '',
  nomineeAadhaar: '',
  nomineePan: '',
  nomineeMobile: '',
  address: '',
  referredByCode: '',
  accountHolderName: '',
  accountNumber: '',
  ifscCode: '',
  branchName: '',
  accountType: '',
};

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

function validateIndianEmail(email: string): string | null {
  const trimmed = email.trim();
  if (!trimmed) return 'Email is required.';
  if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(trimmed)) {
    return 'Enter a valid email address.';
  }
  return null;
}

function validateIndianMobile(phone: string): string | null {
  const digits = digitsOnly(phone);
  if (!digits) return 'Phone number is required.';
  if (digits.length !== 10) return 'Enter a 10-digit mobile number.';
  if (!/^[6-9]\d{9}$/.test(digits)) {
    return 'Indian mobiles must start with 6, 7, 8, or 9.';
  }
  return null;
}

function validateAccountNumber(account: string): string | null {
  const digits = digitsOnly(account);
  if (!digits) return 'Account number is required.';
  if (!/^\d{9,18}$/.test(digits)) {
    return 'Account number must be 9 to 18 digits.';
  }
  return null;
}

function validatePan(pan: string): string | null {
  const code = pan.replace(/\s/g, '').toUpperCase();
  if (!code) return 'PAN number is required.';
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(code)) {
    return 'PAN must be like ABCDE1234F.';
  }
  return null;
}

function validateIfsc(ifsc: string): string | null {
  const code = ifsc.replace(/\s/g, '').toUpperCase();
  if (!code) return 'IFSC code is required.';
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(code)) {
    return 'IFSC must be like SBIN0001234 (4 letters, 0, 6 alphanumeric).';
  }
  return null;
}

function parseDobToIso(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const match = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, dd, mm, yyyy] = match;
  return `${yyyy}-${mm}-${dd}`;
}

function validateDob(value: string): string | null {
  const iso = parseDobToIso(value);
  if (!iso) return 'Select a date of birth.';
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return 'Enter a valid date of birth.';
  const today = new Date();
  const adult = new Date(today.getFullYear() - 18, today.getMonth(), today.getDate());
  if (date > adult) return 'Customer must be at least 18 years old.';
  if (date.getFullYear() < 1900) return 'Enter a valid date of birth.';
  return null;
}

function validateForm(form: FormState): FieldErrors {
  const errors: FieldErrors = {};

  if (!form.fullName.trim()) errors.fullName = 'Full name is required.';
  const emailError = validateIndianEmail(form.email);
  if (emailError) errors.email = emailError;
  const phoneError = validateIndianMobile(form.phone);
  if (phoneError) errors.phone = phoneError;
  const dobError = validateDob(form.dateOfBirth);
  if (dobError) errors.dateOfBirth = dobError;
  const panError = validatePan(form.panNumber);
  if (panError) errors.panNumber = panError;
  if (digitsOnly(form.aadhaarNumber).length !== 12) {
    errors.aadhaarNumber = 'Aadhaar must be 12 digits.';
  }
  if (!form.nomineeName.trim()) errors.nomineeName = 'Nominee name is required.';
  if (!form.nomineeRelationship) errors.nomineeRelationship = 'Select a relationship.';
  if (digitsOnly(form.nomineeAadhaar).length !== 12) {
    errors.nomineeAadhaar = 'Nominee Aadhaar must be 12 digits.';
  }
  const nomineePanError = validatePan(form.nomineePan);
  if (nomineePanError) {
    errors.nomineePan = nomineePanError.replace('PAN', 'Nominee PAN');
  }
  if (!/^[6-9]\d{9}$/.test(digitsOnly(form.nomineeMobile))) {
    errors.nomineeMobile = 'Enter a valid 10-digit nominee mobile.';
  }
  if (!form.address.trim()) errors.address = 'Full address is required.';
  if (!form.accountHolderName.trim()) errors.accountHolderName = 'Account holder name is required.';
  const accountError = validateAccountNumber(form.accountNumber);
  if (accountError) errors.accountNumber = accountError;
  const ifscError = validateIfsc(form.ifscCode);
  if (ifscError) errors.ifscCode = ifscError;
  if (!form.branchName.trim()) errors.branchName = 'Branch name is required.';
  if (!form.accountType) errors.accountType = 'Select account type.';

  return errors;
}

export function CreateCustomerModal({ open, onClose, onCreated }: Props) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const dobInputRef = useRef<HTMLInputElement>(null);

  const maxDob = (() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 18);
    return d.toISOString().slice(0, 10);
  })();

  function openDobPicker() {
    const input = dobInputRef.current;
    if (!input) {
      return;
    }
    try {
      input.showPicker();
    } catch {
      input.focus();
      input.click();
    }
  }

  useEffect(() => {
    if (!open) {
      return;
    }
    setForm(EMPTY);
    setErrors({});
    setSubmitError(null);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitError(null);
    const nextErrors = validateForm(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    const dobIso = parseDobToIso(form.dateOfBirth);
    if (!dobIso) {
      setErrors((prev) => ({ ...prev, dateOfBirth: 'Select a date of birth.' }));
      return;
    }

    const payload: CreateCustomerInput = {
      fullName: form.fullName.trim(),
      email: form.email.trim(),
      mobile: digitsOnly(form.phone),
      dateOfBirth: dobIso,
      panNumber: form.panNumber.replace(/\s/g, '').toUpperCase(),
      aadhaarNumber: digitsOnly(form.aadhaarNumber),
      nomineeName: form.nomineeName.trim(),
      nomineeRelationship: form.nomineeRelationship,
      nomineeAadhaar: digitsOnly(form.nomineeAadhaar),
      nomineePan: form.nomineePan.replace(/\s/g, '').toUpperCase(),
      nomineeMobile: digitsOnly(form.nomineeMobile),
      address: form.address.trim(),
      referredByCode: form.referredByCode.trim().toUpperCase(),
      accountHolderName: form.accountHolderName.trim(),
      accountNumber: digitsOnly(form.accountNumber),
      ifscCode: form.ifscCode.replace(/\s/g, '').toUpperCase(),
      branchName: form.branchName.trim(),
      accountType: form.accountType as 'Savings' | 'Current',
    };

    setIsSubmitting(true);
    try {
      await createCustomer(payload);
      onCreated();
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not create customer.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="create-customer-modal"
        role="dialog"
        aria-labelledby="create-customer-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => void onSubmit(event)}
      >
        <header className="create-customer-head">
          <h2 id="create-customer-title">Create New Customer</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <div className="create-customer-body">
          {submitError ? <div className="error-box">{submitError}</div> : null}

          <section className="create-section">
            <h3>Personal Details</h3>
            <div className="create-grid">
              <label className="create-field">
                <span>Full Name *</span>
                <input
                  value={form.fullName}
                  onChange={(event) => update('fullName', event.target.value)}
                  placeholder="Enter full name"
                />
                {errors.fullName ? <em>{errors.fullName}</em> : null}
              </label>

              <label className="create-field">
                <span>Email Address *</span>
                <input
                  type="email"
                  value={form.email}
                  onChange={(event) => update('email', event.target.value)}
                  placeholder="email@example.com"
                />
                {errors.email ? <em>{errors.email}</em> : null}
              </label>

              <label className="create-field">
                <span>Phone Number *</span>
                <div className="phone-input">
                  <span>+91</span>
                  <input
                    inputMode="numeric"
                    value={form.phone}
                    onChange={(event) =>
                      update('phone', digitsOnly(event.target.value).slice(0, 10))
                    }
                    placeholder="98765 43210"
                  />
                </div>
                {errors.phone ? <em>{errors.phone}</em> : null}
              </label>

              <label className="create-field">
                <span>Date of Birth *</span>
                <div className="dob-input">
                  <input
                    ref={dobInputRef}
                    type="date"
                    max={maxDob}
                    min="1900-01-01"
                    value={form.dateOfBirth}
                    onChange={(event) => update('dateOfBirth', event.target.value)}
                    onClick={openDobPicker}
                  />
                  <span className="dob-calendar-btn" aria-hidden>
                    <Calendar size={16} />
                  </span>
                </div>
                {errors.dateOfBirth ? <em>{errors.dateOfBirth}</em> : null}
              </label>

              <label className="create-field">
                <span>PAN Number *</span>
                <input
                  value={form.panNumber}
                  onChange={(event) =>
                    update(
                      'panNumber',
                      event.target.value.toUpperCase().replace(/\s/g, '').slice(0, 10)
                    )
                  }
                  placeholder="ABCDE1234F"
                />
                {errors.panNumber ? <em>{errors.panNumber}</em> : null}
              </label>

              <label className="create-field">
                <span>Aadhaar Number *</span>
                <input
                  inputMode="numeric"
                  value={form.aadhaarNumber}
                  onChange={(event) =>
                    update('aadhaarNumber', digitsOnly(event.target.value).slice(0, 12))
                  }
                  placeholder="12-digit Aadhaar"
                />
                {errors.aadhaarNumber ? <em>{errors.aadhaarNumber}</em> : null}
              </label>
            </div>
          </section>

          <section className="create-section">
            <h3>Nominee Details</h3>
            <div className="create-grid">
              <label className="create-field">
                <span>Nominee Name *</span>
                <input
                  value={form.nomineeName}
                  onChange={(event) => update('nomineeName', event.target.value)}
                  placeholder="Enter nominee name"
                />
                {errors.nomineeName ? <em>{errors.nomineeName}</em> : null}
              </label>

              <label className="create-field">
                <span>Nominee Relationship *</span>
                <select
                  value={form.nomineeRelationship}
                  onChange={(event) => update('nomineeRelationship', event.target.value)}
                >
                  <option value="">Select relationship</option>
                  {RELATIONSHIPS.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
                {errors.nomineeRelationship ? <em>{errors.nomineeRelationship}</em> : null}
              </label>

              <label className="create-field">
                <span>Nominee Aadhaar *</span>
                <input
                  inputMode="numeric"
                  value={form.nomineeAadhaar}
                  onChange={(event) =>
                    update('nomineeAadhaar', digitsOnly(event.target.value).slice(0, 12))
                  }
                  placeholder="12-digit Aadhaar"
                />
                {errors.nomineeAadhaar ? <em>{errors.nomineeAadhaar}</em> : null}
              </label>

              <label className="create-field">
                <span>Nominee PAN *</span>
                <input
                  value={form.nomineePan}
                  onChange={(event) =>
                    update(
                      'nomineePan',
                      event.target.value.toUpperCase().replace(/\s/g, '').slice(0, 10)
                    )
                  }
                  placeholder="ABCDE1234F"
                />
                {errors.nomineePan ? <em>{errors.nomineePan}</em> : null}
              </label>

              <label className="create-field">
                <span>Nominee Phone *</span>
                <div className="phone-input">
                  <span>+91</span>
                  <input
                    inputMode="numeric"
                    value={form.nomineeMobile}
                    onChange={(event) =>
                      update('nomineeMobile', digitsOnly(event.target.value).slice(0, 10))
                    }
                    placeholder="98765 43210"
                  />
                </div>
                {errors.nomineeMobile ? <em>{errors.nomineeMobile}</em> : null}
              </label>
            </div>
          </section>

          <section className="create-section">
            <h3>Address</h3>
            <label className="create-field">
              <span>Full Address *</span>
              <textarea
                rows={3}
                value={form.address}
                onChange={(event) => update('address', event.target.value)}
                placeholder="Enter full address"
              />
              {errors.address ? <em>{errors.address}</em> : null}
            </label>
            <label className="create-field" style={{ marginTop: 14 }}>
              <span>Referred by (customer referral code, optional)</span>
              <input
                value={form.referredByCode}
                onChange={(event) => update('referredByCode', event.target.value.toUpperCase())}
                placeholder="8-character code if referred"
                maxLength={8}
              />
            </label>
          </section>

          <section className="create-section">
            <h3>Bank Details</h3>
            <div className="create-grid">
              <label className="create-field">
                <span>Account Holder Name *</span>
                <input
                  value={form.accountHolderName}
                  onChange={(event) => update('accountHolderName', event.target.value)}
                  placeholder="Enter account holder name"
                />
                {errors.accountHolderName ? <em>{errors.accountHolderName}</em> : null}
              </label>

              <label className="create-field">
                <span>Account Number *</span>
                <input
                  inputMode="numeric"
                  value={form.accountNumber}
                  onChange={(event) =>
                    update('accountNumber', digitsOnly(event.target.value).slice(0, 18))
                  }
                  placeholder="Enter account number"
                />
                {errors.accountNumber ? <em>{errors.accountNumber}</em> : null}
              </label>

              <label className="create-field">
                <span>IFSC Code *</span>
                <input
                  value={form.ifscCode}
                  onChange={(event) =>
                    update('ifscCode', event.target.value.toUpperCase().replace(/\s/g, '').slice(0, 11))
                  }
                  placeholder="Enter IFSC code"
                />
                {errors.ifscCode ? <em>{errors.ifscCode}</em> : null}
              </label>

              <label className="create-field">
                <span>Branch Name *</span>
                <input
                  value={form.branchName}
                  onChange={(event) => update('branchName', event.target.value)}
                  placeholder="Enter branch name"
                />
                {errors.branchName ? <em>{errors.branchName}</em> : null}
              </label>

              <label className="create-field">
                <span>Account Type *</span>
                <select
                  value={form.accountType}
                  onChange={(event) =>
                    update('accountType', event.target.value as FormState['accountType'])
                  }
                >
                  <option value="">Select account type</option>
                  <option value="Savings">Savings</option>
                  <option value="Current">Current</option>
                </select>
                {errors.accountType ? <em>{errors.accountType}</em> : null}
              </label>
            </div>
          </section>
        </div>

        <footer className="create-customer-footer">
          <button type="button" className="ghost-btn" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </button>
          <button type="submit" className="gold-btn create-submit-btn" disabled={isSubmitting}>
            {isSubmitting ? 'Creating…' : 'Create & Submit'}
          </button>
        </footer>
      </form>
    </div>
  );
}
