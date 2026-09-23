import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Calendar } from 'lucide-react';
import {
  lookupPublicClient,
  registerPublicCustomer,
  type PublicClientSummary,
  type PublicCustomerRecord,
} from '../services/publicCustomerService';

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

type FormState = {
  clientCode: string;
  referredByCode: string;
  fullName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  panNumber: string;
  aadhaarNumber: string;
  city: string;
  state: string;
  pinCode: string;
  address: string;
  nomineeName: string;
  nomineeRelationship: string;
  nomineeAadhaar: string;
  nomineePan: string;
  nomineeMobile: string;
  accountHolderName: string;
  accountNumber: string;
  ifscCode: string;
  bankName: string;
  branchName: string;
  accountType: 'Savings' | 'Current' | '';
  password: string;
  confirmPassword: string;
  authorized: boolean;
};

type FieldErrors = Partial<Record<keyof FormState, string>>;

const EMPTY: FormState = {
  clientCode: '',
  referredByCode: '',
  fullName: '',
  email: '',
  phone: '',
  dateOfBirth: '',
  panNumber: '',
  aadhaarNumber: '',
  city: '',
  state: '',
  pinCode: '',
  address: '',
  nomineeName: '',
  nomineeRelationship: '',
  nomineeAadhaar: '',
  nomineePan: '',
  nomineeMobile: '',
  accountHolderName: '',
  accountNumber: '',
  ifscCode: '',
  bankName: '',
  branchName: '',
  accountType: '',
  password: '',
  confirmPassword: '',
  authorized: false,
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

function validatePan(pan: string, label = 'PAN'): string | null {
  const code = pan.replace(/\s/g, '').toUpperCase();
  if (!code) return `${label} is required.`;
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(code)) {
    return `${label} must be like ABCDE1234F.`;
  }
  return null;
}

function validateIfsc(ifsc: string): string | null {
  const code = ifsc.replace(/\s/g, '').toUpperCase();
  if (!code) return 'IFSC code is required.';
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(code)) {
    return 'IFSC must be like SBIN0001234.';
  }
  return null;
}

function validateDob(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Select a date of birth.';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return 'Enter a valid date of birth.';
  const today = new Date();
  const adult = new Date(today.getFullYear() - 18, today.getMonth(), today.getDate());
  if (date > adult) return 'You must be at least 18 years old.';
  if (date.getFullYear() < 1900) return 'Enter a valid date of birth.';
  return null;
}

function validateForm(form: FormState, client: PublicClientSummary | null): FieldErrors {
  const errors: FieldErrors = {};
  if (!/^[A-Z0-9]{3,20}$/.test(form.clientCode.trim().toUpperCase())) {
    errors.clientCode = 'Enter your trader’s client code.';
  } else if (!client) {
    errors.clientCode = 'Look up a valid client code first.';
  }
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
  if (!form.address.trim()) errors.address = 'Full address is required.';
  if (form.pinCode && !/^\d{6}$/.test(digitsOnly(form.pinCode))) {
    errors.pinCode = 'PIN code must be 6 digits.';
  }
  if (!form.nomineeName.trim()) errors.nomineeName = 'Nominee name is required.';
  if (!form.nomineeRelationship) errors.nomineeRelationship = 'Select a relationship.';
  if (digitsOnly(form.nomineeAadhaar).length !== 12) {
    errors.nomineeAadhaar = 'Nominee Aadhaar must be 12 digits.';
  }
  const nomineePanError = validatePan(form.nomineePan, 'Nominee PAN');
  if (nomineePanError) errors.nomineePan = nomineePanError;
  if (!/^[6-9]\d{9}$/.test(digitsOnly(form.nomineeMobile))) {
    errors.nomineeMobile = 'Enter a valid 10-digit nominee mobile.';
  }
  if (!form.accountHolderName.trim()) errors.accountHolderName = 'Account holder name is required.';
  if (!/^\d{9,18}$/.test(digitsOnly(form.accountNumber))) {
    errors.accountNumber = 'Account number must be 9 to 18 digits.';
  }
  const ifscError = validateIfsc(form.ifscCode);
  if (ifscError) errors.ifscCode = ifscError;
  if (!form.bankName.trim()) errors.bankName = 'Bank name is required.';
  if (!form.branchName.trim()) errors.branchName = 'Branch name is required.';
  if (!form.accountType) errors.accountType = 'Select account type.';
  if (form.password.length < 8) errors.password = 'Password must be at least 8 characters.';
  if (form.password !== form.confirmPassword) {
    errors.confirmPassword = 'Passwords do not match.';
  }
  if (form.referredByCode && !/^[A-Z0-9]{8}$/.test(form.referredByCode.trim().toUpperCase())) {
    errors.referredByCode = 'Referral code must be 8 letters or digits.';
  }
  if (!form.authorized) errors.authorized = 'Accept the terms to continue.';
  return errors;
}

export function RegisterCustomerPage() {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [client, setClient] = useState<PublicClientSummary | null>(null);
  const [clientStatus, setClientStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [clientMessage, setClientMessage] = useState<string | null>(null);
  const [created, setCreated] = useState<PublicCustomerRecord | null>(null);
  const dobInputRef = useRef<HTMLInputElement>(null);

  const maxDob = useMemo(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 18);
    return d.toISOString().slice(0, 10);
  }, []);

  useEffect(() => {
    const code = form.clientCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{3,20}$/.test(code)) {
      setClient(null);
      setClientStatus(code ? 'error' : 'idle');
      setClientMessage(code ? 'Enter a valid client code.' : null);
      return;
    }

    let cancelled = false;
    setClientStatus('loading');
    setClientMessage(null);
    const handle = window.setTimeout(() => {
      void lookupPublicClient(code)
        .then((row) => {
          if (cancelled) return;
          setClient(row);
          setClientStatus('ready');
          setClientMessage(`Joining ${row.name}`);
          setErrors((prev) => {
            if (!prev.clientCode) return prev;
            const next = { ...prev };
            delete next.clientCode;
            return next;
          });
        })
        .catch((err) => {
          if (cancelled) return;
          setClient(null);
          setClientStatus('error');
          setClientMessage(err instanceof Error ? err.message : 'That client code was not found.');
        });
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [form.clientCode]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function openDobPicker() {
    const input = dobInputRef.current;
    if (!input) return;
    try {
      input.showPicker();
    } catch {
      input.focus();
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitError(null);
    const nextErrors = validateForm(form, client);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || !client) {
      return;
    }

    setIsSubmitting(true);
    try {
      const customer = await registerPublicCustomer({
        clientCode: client.clientCode,
        referredByCode: form.referredByCode.trim().toUpperCase() || undefined,
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        mobile: digitsOnly(form.phone),
        dateOfBirth: form.dateOfBirth,
        address: form.address.trim(),
        city: form.city.trim() || undefined,
        state: form.state.trim() || undefined,
        pinCode: digitsOnly(form.pinCode) || undefined,
        aadhaarNumber: digitsOnly(form.aadhaarNumber),
        panNumber: form.panNumber.replace(/\s/g, '').toUpperCase(),
        accountHolderName: form.accountHolderName.trim(),
        accountNumber: digitsOnly(form.accountNumber),
        ifscCode: form.ifscCode.replace(/\s/g, '').toUpperCase(),
        bankName: form.branchName.trim()
          ? `${form.bankName.trim()}, ${form.branchName.trim()}`
          : form.bankName.trim(),
        accountType: form.accountType as 'Savings' | 'Current',
        nomineeName: form.nomineeName.trim(),
        nomineeRelationship: form.nomineeRelationship,
        nomineeAadhaar: digitsOnly(form.nomineeAadhaar),
        nomineePan: form.nomineePan.replace(/\s/g, '').toUpperCase(),
        nomineeMobile: digitsOnly(form.nomineeMobile),
        password: form.password,
      });
      setCreated(customer);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not create your account.');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (created) {
    return (
      <div className="auth-screen">
        <div className="auth-card register-success-card">
          <img src="/logo-mark.png" alt="" width={48} height={48} />
          <h1>You are boarded</h1>
          <p>
            Your investor profile is now with <strong>{created.clientName}</strong> (
            {created.clientCode}).
          </p>
          <dl className="register-success-meta">
            <div>
              <dt>Customer ID</dt>
              <dd>{created.customerCode}</dd>
            </div>
            <div>
              <dt>Referral code</dt>
              <dd>{created.referralCode}</dd>
            </div>
          </dl>
          <p>
            Sign in to the ELVA Investa mobile app with this mobile number or email and the
            password you just set.
          </p>
          <Link className="primary-btn" to="/login">
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-screen register-screen">
      <form className="auth-card register-card" onSubmit={(event) => void onSubmit(event)}>
        <header className="register-head">
          <img src="/logo-mark.png" alt="" width={40} height={40} />
          <div>
            <h1>Register as customer</h1>
            <p>
              Complete this form to join a trader on ELVA Investa. Use the client code they gave
              you, such as VTINVEST.
            </p>
          </div>
        </header>

        {submitError ? <div className="error-box">{submitError}</div> : null}

        <section className="create-section">
          <h3>Trader</h3>
          <div className="create-grid">
            <label className="create-field">
              <span>Client code *</span>
              <input
                value={form.clientCode}
                onChange={(event) =>
                  update('clientCode', event.target.value.toUpperCase().replace(/\s/g, ''))
                }
                placeholder="VTINVEST"
                autoComplete="off"
                maxLength={20}
              />
              {errors.clientCode ? <em>{errors.clientCode}</em> : null}
              {clientStatus === 'loading' ? (
                <small className="field-hint">Checking client code…</small>
              ) : null}
              {clientMessage && clientStatus === 'ready' ? (
                <small className="field-hint success">{clientMessage}</small>
              ) : null}
              {clientMessage && clientStatus === 'error' && !errors.clientCode ? (
                <em>{clientMessage}</em>
              ) : null}
            </label>
            <label className="create-field">
              <span>Customer referral code (optional)</span>
              <input
                value={form.referredByCode}
                onChange={(event) =>
                  update('referredByCode', event.target.value.toUpperCase().replace(/\s/g, ''))
                }
                placeholder="8-character code if referred"
                maxLength={8}
              />
              {errors.referredByCode ? <em>{errors.referredByCode}</em> : null}
            </label>
          </div>
        </section>

        <section className="create-section">
          <h3>Personal details</h3>
          <div className="create-grid">
            <label className="create-field">
              <span>Full name *</span>
              <input
                value={form.fullName}
                onChange={(event) => update('fullName', event.target.value)}
                placeholder="Enter full name"
                autoComplete="name"
              />
              {errors.fullName ? <em>{errors.fullName}</em> : null}
            </label>
            <label className="create-field">
              <span>Email address *</span>
              <input
                type="email"
                value={form.email}
                onChange={(event) => update('email', event.target.value)}
                placeholder="email@example.com"
                autoComplete="email"
              />
              {errors.email ? <em>{errors.email}</em> : null}
            </label>
            <label className="create-field">
              <span>Phone number *</span>
              <div className="phone-input">
                <span>+91</span>
                <input
                  inputMode="numeric"
                  value={form.phone}
                  onChange={(event) => update('phone', digitsOnly(event.target.value).slice(0, 10))}
                  placeholder="98765 43210"
                  autoComplete="tel"
                />
              </div>
              {errors.phone ? <em>{errors.phone}</em> : null}
            </label>
            <label className="create-field">
              <span>Date of birth *</span>
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
              <span>PAN number *</span>
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
              <span>Aadhaar number *</span>
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
          <h3>Address</h3>
          <label className="create-field">
            <span>Full address *</span>
            <textarea
              rows={3}
              value={form.address}
              onChange={(event) => update('address', event.target.value)}
              placeholder="House / street, area"
            />
            {errors.address ? <em>{errors.address}</em> : null}
          </label>
          <div className="create-grid" style={{ marginTop: 14 }}>
            <label className="create-field">
              <span>City</span>
              <input
                value={form.city}
                onChange={(event) => update('city', event.target.value)}
                placeholder="City"
              />
            </label>
            <label className="create-field">
              <span>State</span>
              <input
                value={form.state}
                onChange={(event) => update('state', event.target.value)}
                placeholder="State"
              />
            </label>
            <label className="create-field">
              <span>PIN code</span>
              <input
                inputMode="numeric"
                value={form.pinCode}
                onChange={(event) => update('pinCode', digitsOnly(event.target.value).slice(0, 6))}
                placeholder="560001"
              />
              {errors.pinCode ? <em>{errors.pinCode}</em> : null}
            </label>
          </div>
        </section>

        <section className="create-section">
          <h3>Nominee</h3>
          <div className="create-grid">
            <label className="create-field">
              <span>Nominee name *</span>
              <input
                value={form.nomineeName}
                onChange={(event) => update('nomineeName', event.target.value)}
                placeholder="Enter nominee name"
              />
              {errors.nomineeName ? <em>{errors.nomineeName}</em> : null}
            </label>
            <label className="create-field">
              <span>Relationship *</span>
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
              <span>Nominee phone *</span>
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
          <h3>Bank details</h3>
          <div className="create-grid">
            <label className="create-field">
              <span>Account holder name *</span>
              <input
                value={form.accountHolderName}
                onChange={(event) => update('accountHolderName', event.target.value)}
                placeholder="Name as on the account"
              />
              {errors.accountHolderName ? <em>{errors.accountHolderName}</em> : null}
            </label>
            <label className="create-field">
              <span>Account number *</span>
              <input
                inputMode="numeric"
                value={form.accountNumber}
                onChange={(event) =>
                  update('accountNumber', digitsOnly(event.target.value).slice(0, 18))
                }
                placeholder="9 to 18 digits"
              />
              {errors.accountNumber ? <em>{errors.accountNumber}</em> : null}
            </label>
            <label className="create-field">
              <span>IFSC code *</span>
              <input
                value={form.ifscCode}
                onChange={(event) =>
                  update(
                    'ifscCode',
                    event.target.value.toUpperCase().replace(/\s/g, '').slice(0, 11)
                  )
                }
                placeholder="SBIN0001234"
              />
              {errors.ifscCode ? <em>{errors.ifscCode}</em> : null}
            </label>
            <label className="create-field">
              <span>Bank name *</span>
              <input
                value={form.bankName}
                onChange={(event) => update('bankName', event.target.value)}
                placeholder="State Bank of India"
              />
              {errors.bankName ? <em>{errors.bankName}</em> : null}
            </label>
            <label className="create-field">
              <span>Branch name *</span>
              <input
                value={form.branchName}
                onChange={(event) => update('branchName', event.target.value)}
                placeholder="MG Road"
              />
              {errors.branchName ? <em>{errors.branchName}</em> : null}
            </label>
            <label className="create-field">
              <span>Account type *</span>
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

        <section className="create-section">
          <h3>Password</h3>
          <div className="create-grid">
            <label className="create-field">
              <span>Password *</span>
              <input
                type="password"
                value={form.password}
                onChange={(event) => update('password', event.target.value)}
                autoComplete="new-password"
                placeholder="At least 8 characters"
              />
              {errors.password ? <em>{errors.password}</em> : null}
            </label>
            <label className="create-field">
              <span>Confirm password *</span>
              <input
                type="password"
                value={form.confirmPassword}
                onChange={(event) => update('confirmPassword', event.target.value)}
                autoComplete="new-password"
              />
              {errors.confirmPassword ? <em>{errors.confirmPassword}</em> : null}
            </label>
          </div>
          <label className="register-consent">
            <input
              type="checkbox"
              checked={form.authorized}
              onChange={(event) => update('authorized', event.target.checked)}
            />
            <span>I confirm these details are mine and I want to join this trader on ELVA Investa.</span>
          </label>
          {errors.authorized ? <em className="register-consent-error">{errors.authorized}</em> : null}
        </section>

        <footer className="register-footer">
          <button type="submit" className="primary-btn" disabled={isSubmitting}>
            {isSubmitting ? 'Creating account…' : 'Create customer account'}
          </button>
          <p className="auth-switch">
            Already have an admin login? <Link to="/login">Sign in</Link>
            <br />
            Boarding a trader? <Link to="/register-client">Register as client</Link>
          </p>
        </footer>
      </form>
    </div>
  );
}
