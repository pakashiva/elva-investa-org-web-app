import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  EMPTY_AGREEMENT_PARTY,
  partyPayload,
  validateAgreementPartyForm,
  type AgreementPartyErrors,
  type AgreementPartyForm,
} from '../agreementParty';
import { AgreementPartyFields } from '../components/AgreementPartyFields';
import { useAuth } from '../contexts/AuthContext';
import {
  lookupAdminUsernameAvailability,
  lookupClientCodeAvailability,
  registerPublicClient,
} from '../services/publicClientService';

const PAYOUT_DAYS = [1, 5, 10, 15, 20, 25];

type FormState = {
  name: string;
  clientCode: string;
  adminFullName: string;
  adminUsername: string;
  adminPassword: string;
  confirmPassword: string;
  supportEmail: string;
  supportPhone: string;
  minInvestmentAmount: string;
  maxInvestmentAmount: string;
  agreementCharges: string;
  interestRatePercent: string;
  tdsPercent: string;
  payoutDay: string;
  referralRatePercent: string;
  referralTdsPercent: string;
  authorized: boolean;
};

type FieldErrors = Partial<Record<keyof FormState, string>>;

const EMPTY: FormState = {
  name: '',
  clientCode: '',
  adminFullName: '',
  adminUsername: '',
  adminPassword: '',
  confirmPassword: '',
  supportEmail: '',
  supportPhone: '',
  minInvestmentAmount: '100000',
  maxInvestmentAmount: '10000000',
  agreementCharges: '1000',
  interestRatePercent: '5',
  tdsPercent: '10',
  payoutDay: '10',
  referralRatePercent: '1',
  referralTdsPercent: '2',
  authorized: false,
};

function numberOrZero(value: string) {
  const parsed = Number(value.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function validate(form: FormState): FieldErrors {
  const errors: FieldErrors = {};
  if (!form.name.trim()) errors.name = 'Client name is required.';
  if (!/^[A-Z0-9]{3,20}$/.test(form.clientCode.trim().toUpperCase())) {
    errors.clientCode = 'Use 3–20 letters or numbers, like VTINVEST.';
  }
  if (!form.adminFullName.trim()) errors.adminFullName = 'Admin name is required.';
  if (!/^[a-z0-9._-]{3,40}$/i.test(form.adminUsername.trim())) {
    errors.adminUsername = 'Use 3–40 characters: letters, numbers, . _ -';
  }
  if (form.adminPassword.length < 8) errors.adminPassword = 'Password must be at least 8 characters.';
  if (form.adminPassword !== form.confirmPassword) errors.confirmPassword = 'Passwords do not match.';
  if (form.supportEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.supportEmail.trim())) {
    errors.supportEmail = 'Enter a valid email.';
  }
  if (form.supportPhone.trim() && !/^[6-9]\d{9}$/.test(form.supportPhone.replace(/\D/g, ''))) {
    errors.supportPhone = 'Enter a 10-digit Indian mobile number.';
  }
  const min = numberOrZero(form.minInvestmentAmount);
  const max = numberOrZero(form.maxInvestmentAmount);
  if (!(min > 0)) errors.minInvestmentAmount = 'Enter a minimum greater than 0.';
  if (!(max >= min)) errors.maxInvestmentAmount = 'Maximum must be at least the minimum.';
  if (numberOrZero(form.agreementCharges) < 0) errors.agreementCharges = 'Enter a valid charge.';
  if (!form.authorized) errors.authorized = 'Confirm you are authorised to board this trader.';
  return errors;
}

export function RegisterClientPage() {
  const navigate = useNavigate();
  const { refresh, signIn } = useAuth();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [party, setParty] = useState<AgreementPartyForm>(EMPTY_AGREEMENT_PARTY);
  const [partyErrors, setPartyErrors] = useState<AgreementPartyErrors>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [codeStatus, setCodeStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [codeMessage, setCodeMessage] = useState<string | null>(null);
  const [userStatus, setUserStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [userMessage, setUserMessage] = useState<string | null>(null);
  const codeRequest = useRef(0);
  const userRequest = useRef(0);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function updateParty<K extends keyof AgreementPartyForm>(key: K, value: AgreementPartyForm[K]) {
    setParty((current) => ({ ...current, [key]: value }));
    setPartyErrors((current) => {
      const next = { ...current };
      if (key === 'offices') {
        delete next.offices;
        delete next.officeErrors;
        return next;
      }
      if (key in next) {
        delete next[key as keyof AgreementPartyErrors];
      }
      return next;
    });
  }

  const clientCode = form.clientCode.trim().toUpperCase();
  const adminUsername = form.adminUsername.trim().toLowerCase();

  useEffect(() => {
    if (!/^[A-Z0-9]{3,20}$/.test(clientCode)) {
      setCodeStatus('idle');
      setCodeMessage(null);
      return;
    }
    const requestId = ++codeRequest.current;
    setCodeStatus('loading');
    const timer = window.setTimeout(() => {
      void lookupClientCodeAvailability(clientCode)
        .then((result) => {
          if (requestId !== codeRequest.current) return;
          if (result.available) {
            setCodeStatus('ready');
            setCodeMessage(`${result.clientCode} is available.`);
            return;
          }
          setCodeStatus('error');
          setCodeMessage(`${result.clientCode} is already used by ${result.name}.`);
        })
        .catch((err) => {
          if (requestId !== codeRequest.current) return;
          setCodeStatus('error');
          setCodeMessage(err instanceof Error ? err.message : 'Could not check this code.');
        });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [clientCode]);

  useEffect(() => {
    if (!/^[a-z0-9._-]{3,40}$/.test(adminUsername)) {
      setUserStatus('idle');
      setUserMessage(null);
      return;
    }
    const requestId = ++userRequest.current;
    setUserStatus('loading');
    const timer = window.setTimeout(() => {
      void lookupAdminUsernameAvailability(adminUsername)
        .then((result) => {
          if (requestId !== userRequest.current) return;
          if (result.available) {
            setUserStatus('ready');
            setUserMessage(`${result.username} is available.`);
            return;
          }
          setUserStatus('error');
          setUserMessage('That username is already in use.');
        })
        .catch((err) => {
          if (requestId !== userRequest.current) return;
          setUserStatus('error');
          setUserMessage(err instanceof Error ? err.message : 'Could not check this username.');
        });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [adminUsername]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitError(null);
    const nextErrors = validate(form);
    const nextPartyErrors = validateAgreementPartyForm(party);
    if (codeStatus === 'error') nextErrors.clientCode = codeMessage ?? 'That client code is taken.';
    if (userStatus === 'error') nextErrors.adminUsername = userMessage ?? 'That username is taken.';
    setErrors(nextErrors);
    setPartyErrors(nextPartyErrors);
    if (Object.keys(nextErrors).length > 0 || Object.keys(nextPartyErrors).length > 0) return;

    setIsSubmitting(true);
    try {
      const boarded = await registerPublicClient({
        name: form.name.trim(),
        clientCode,
        adminFullName: form.adminFullName.trim(),
        adminUsername,
        adminPassword: form.adminPassword,
        supportEmail: form.supportEmail.trim() || undefined,
        supportPhone: form.supportPhone.replace(/\D/g, '') || undefined,
        minInvestmentAmount: numberOrZero(form.minInvestmentAmount),
        maxInvestmentAmount: numberOrZero(form.maxInvestmentAmount),
        agreementCharges: numberOrZero(form.agreementCharges),
        interestRatePercent: numberOrZero(form.interestRatePercent),
        tdsPercent: numberOrZero(form.tdsPercent),
        payoutDay: numberOrZero(form.payoutDay),
        referralRatePercent: numberOrZero(form.referralRatePercent),
        referralTdsPercent: numberOrZero(form.referralTdsPercent),
        agreementParty: partyPayload(party),
      });
      if (boarded.token) {
        await refresh();
      } else {
        await signIn(adminUsername, form.adminPassword);
      }
      navigate('/', { replace: true });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not board as client.');
      setIsSubmitting(false);
    }
  }

  return (
    <div className="auth-screen register-screen">
      <form className="auth-card register-card" onSubmit={(event) => void onSubmit(event)}>
        <header className="register-head">
          <img src="/logo-mark.png" alt="ELVA Investa" width={56} height={56} />
          <div>
            <h1>Register as client</h1>
            <p>
              Board a new trader on ELVA Investa, the same way Venkatesh Traders and Loreal Trades
              operate. You get one Client Admin login and a client code for customers.
            </p>
          </div>
        </header>

        {submitError ? <div className="error-box">{submitError}</div> : null}

        <section className="create-section">
          <h3>Trader</h3>
          <div className="create-grid">
            <label className="create-field">
              <span>Client name *</span>
              <input
                value={form.name}
                onChange={(event) => update('name', event.target.value)}
                placeholder="Venkatesh Traders"
                autoComplete="organization"
              />
              {errors.name ? <em>{errors.name}</em> : null}
            </label>
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
              {codeStatus === 'loading' ? (
                <small className="field-hint">Checking client code…</small>
              ) : null}
              {codeMessage && codeStatus === 'ready' ? (
                <small className="field-hint success">{codeMessage}</small>
              ) : null}
              {codeMessage && codeStatus === 'error' && !errors.clientCode ? <em>{codeMessage}</em> : null}
            </label>
            <label className="create-field">
              <span>Support email</span>
              <input
                type="email"
                value={form.supportEmail}
                onChange={(event) => update('supportEmail', event.target.value)}
                placeholder="optional"
                autoComplete="email"
              />
              {errors.supportEmail ? <em>{errors.supportEmail}</em> : null}
            </label>
            <label className="create-field">
              <span>Support phone</span>
              <input
                value={form.supportPhone}
                onChange={(event) => update('supportPhone', event.target.value.replace(/\D/g, '').slice(0, 10))}
                placeholder="optional 10-digit mobile"
                inputMode="numeric"
              />
              {errors.supportPhone ? <em>{errors.supportPhone}</em> : null}
            </label>
          </div>
        </section>

        <section className="create-section">
          <h3>Client Admin</h3>
          <p className="form-hint">One username and one password for this trader.</p>
          <div className="create-grid">
            <label className="create-field">
              <span>Admin name *</span>
              <input
                value={form.adminFullName}
                onChange={(event) => update('adminFullName', event.target.value)}
                placeholder="Full name"
                autoComplete="name"
              />
              {errors.adminFullName ? <em>{errors.adminFullName}</em> : null}
            </label>
            <label className="create-field">
              <span>Admin username *</span>
              <input
                value={form.adminUsername}
                onChange={(event) =>
                  update('adminUsername', event.target.value.toLowerCase().replace(/\s/g, ''))
                }
                placeholder="vtadmin"
                autoComplete="off"
                maxLength={40}
              />
              {errors.adminUsername ? <em>{errors.adminUsername}</em> : null}
              {userStatus === 'loading' ? (
                <small className="field-hint">Checking username…</small>
              ) : null}
              {userMessage && userStatus === 'ready' ? (
                <small className="field-hint success">{userMessage}</small>
              ) : null}
              {userMessage && userStatus === 'error' && !errors.adminUsername ? (
                <em>{userMessage}</em>
              ) : null}
            </label>
            <label className="create-field">
              <span>Admin password *</span>
              <input
                type="password"
                value={form.adminPassword}
                onChange={(event) => update('adminPassword', event.target.value)}
                autoComplete="new-password"
              />
              {errors.adminPassword ? <em>{errors.adminPassword}</em> : null}
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
        </section>

        <section className="create-section">
          <h3>Investment product</h3>
          <p className="form-hint">These limits belong to this client only.</p>
          <div className="create-grid">
            <label className="create-field">
              <span>Minimum investment (₹) *</span>
              <input
                inputMode="numeric"
                value={form.minInvestmentAmount}
                onChange={(event) => update('minInvestmentAmount', event.target.value)}
              />
              {errors.minInvestmentAmount ? <em>{errors.minInvestmentAmount}</em> : null}
            </label>
            <label className="create-field">
              <span>Maximum investment (₹) *</span>
              <input
                inputMode="numeric"
                value={form.maxInvestmentAmount}
                onChange={(event) => update('maxInvestmentAmount', event.target.value)}
              />
              {errors.maxInvestmentAmount ? <em>{errors.maxInvestmentAmount}</em> : null}
            </label>
            <label className="create-field">
              <span>Agreement charges (₹) *</span>
              <input
                inputMode="numeric"
                value={form.agreementCharges}
                onChange={(event) => update('agreementCharges', event.target.value)}
              />
              {errors.agreementCharges ? <em>{errors.agreementCharges}</em> : null}
            </label>
            <label className="create-field">
              <span>Payout day *</span>
              <select
                value={form.payoutDay}
                onChange={(event) => update('payoutDay', event.target.value)}
              >
                {PAYOUT_DAYS.map((day) => (
                  <option key={day} value={day}>
                    {day}
                  </option>
                ))}
              </select>
            </label>
            <label className="create-field">
              <span>Interest rate (% per month) *</span>
              <input
                inputMode="decimal"
                value={form.interestRatePercent}
                onChange={(event) => update('interestRatePercent', event.target.value)}
              />
            </label>
            <label className="create-field">
              <span>TDS (%) *</span>
              <input
                inputMode="decimal"
                value={form.tdsPercent}
                onChange={(event) => update('tdsPercent', event.target.value)}
              />
            </label>
            <label className="create-field">
              <span>Referral bonus (%) *</span>
              <input
                inputMode="decimal"
                value={form.referralRatePercent}
                onChange={(event) => update('referralRatePercent', event.target.value)}
              />
            </label>
            <label className="create-field">
              <span>Referral TDS (%) *</span>
              <input
                inputMode="decimal"
                value={form.referralTdsPercent}
                onChange={(event) => update('referralTdsPercent', event.target.value)}
              />
            </label>
          </div>
        </section>

        <section className="create-section">
          <h3>Loan agreement — Second Party</h3>
          <AgreementPartyFields values={party} errors={partyErrors} onChange={updateParty} />
        </section>

        <label className="register-consent">
          <input
            type="checkbox"
            checked={form.authorized}
            onChange={(event) => update('authorized', event.target.checked)}
          />
          <span>
            I am authorised to board this trader on ELVA Investa and will operate as Client Admin.
            {errors.authorized ? <em className="register-consent-error">{errors.authorized}</em> : null}
          </span>
        </label>

        <div className="register-footer">
          <button type="submit" className="primary-btn" disabled={isSubmitting}>
            {isSubmitting ? 'Boarding…' : 'Board as client'}
          </button>
          <p className="auth-switch">
            Already have an admin login? <Link to="/login">Sign in</Link>
          </p>
        </div>
      </form>
    </div>
  );
}
