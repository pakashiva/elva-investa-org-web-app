import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useOutletContext } from 'react-router-dom';
import {
  EMPTY_AGREEMENT_PARTY,
  partyPayload,
  validateAgreementPartyForm,
  type AgreementPartyErrors,
  type AgreementPartyForm,
} from '../agreementParty';
import { AppHeader } from '../components/AppHeader';
import { AgreementPartyFields } from '../components/AgreementPartyFields';
import type { AdminOutletContext } from '../layouts/AdminLayout';
import { createClient } from '../services/clientService';
import type { ClientStatus } from '../types/platform';

const PAYOUT_DAYS = [1, 5, 10, 15, 20, 25];

type FormState = {
  name: string;
  clientCode: string;
  status: ClientStatus;
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
};

const INITIAL: FormState = {
  name: '',
  clientCode: '',
  status: 'active',
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
};

function numberOrZero(value: string) {
  const parsed = Number(value.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function CreateClientPage() {
  const { onOpenMenu } = useOutletContext<AdminOutletContext>();
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(INITIAL);
  const [party, setParty] = useState<AgreementPartyForm>(EMPTY_AGREEMENT_PARTY);
  const [partyErrors, setPartyErrors] = useState<AgreementPartyErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
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

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (form.adminPassword !== form.confirmPassword) {
      setError('Admin passwords do not match.');
      return;
    }

    const nextPartyErrors = validateAgreementPartyForm(party);
    setPartyErrors(nextPartyErrors);
    if (Object.keys(nextPartyErrors).length > 0) {
      setError('Complete the Second Party agreement details.');
      return;
    }

    setIsSaving(true);
    try {
      await createClient({
        name: form.name,
        clientCode: form.clientCode,
        status: form.status,
        adminFullName: form.adminFullName,
        adminUsername: form.adminUsername,
        adminPassword: form.adminPassword,
        supportEmail: form.supportEmail,
        supportPhone: form.supportPhone,
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
      navigate('/clients', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create client.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <AppHeader
        title="Add Client"
        subtitle="Create a trader tenant, one admin login, and investment limits."
        onOpenMenu={onOpenMenu}
      />

      <form className="card settings-card client-form" onSubmit={(event) => void onSubmit(event)}>
        {error ? <div className="error-box">{error}</div> : null}

        <h2>Client</h2>
        <label className="settings-field">
          <span>Client name</span>
          <input
            className="settings-input"
            value={form.name}
            onChange={(event) => update('name', event.target.value)}
            placeholder="Venkatesh Traders"
            required
          />
        </label>

        <div className="settings-row">
          <label className="settings-field">
            <span>Client referral code</span>
            <input
              className="settings-input"
              value={form.clientCode}
              onChange={(event) => update('clientCode', event.target.value.toUpperCase())}
              placeholder="VTINVEST"
              required
            />
          </label>
          <label className="settings-field">
            <span>Status</span>
            <select
              className="settings-input"
              value={form.status}
              onChange={(event) => update('status', event.target.value as ClientStatus)}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
        </div>

        <div className="settings-row">
          <label className="settings-field">
            <span>Support email</span>
            <input
              className="settings-input"
              type="email"
              value={form.supportEmail}
              onChange={(event) => update('supportEmail', event.target.value)}
              placeholder="optional"
            />
          </label>
          <label className="settings-field">
            <span>Support phone</span>
            <input
              className="settings-input"
              value={form.supportPhone}
              onChange={(event) => update('supportPhone', event.target.value)}
              placeholder="optional"
            />
          </label>
        </div>

        <h2>Client Admin</h2>
        <p className="form-hint">One username and one password for this client.</p>
        <label className="settings-field">
          <span>Admin name</span>
          <input
            className="settings-input"
            value={form.adminFullName}
            onChange={(event) => update('adminFullName', event.target.value)}
            required
          />
        </label>
        <label className="settings-field">
          <span>Admin username</span>
          <input
            className="settings-input"
            autoComplete="off"
            value={form.adminUsername}
            onChange={(event) => update('adminUsername', event.target.value)}
            required
          />
        </label>
        <div className="settings-row">
          <label className="settings-field">
            <span>Admin password</span>
            <input
              className="settings-input"
              type="password"
              autoComplete="new-password"
              value={form.adminPassword}
              onChange={(event) => update('adminPassword', event.target.value)}
              required
            />
          </label>
          <label className="settings-field">
            <span>Confirm password</span>
            <input
              className="settings-input"
              type="password"
              autoComplete="new-password"
              value={form.confirmPassword}
              onChange={(event) => update('confirmPassword', event.target.value)}
              required
            />
          </label>
        </div>

        <h2>Investment product</h2>
        <p className="form-hint">These limits belong to this client only.</p>
        <div className="settings-row">
          <label className="settings-field">
            <span>Minimum investment (₹)</span>
            <input
              className="settings-input"
              inputMode="numeric"
              value={form.minInvestmentAmount}
              onChange={(event) => update('minInvestmentAmount', event.target.value)}
              required
            />
          </label>
          <label className="settings-field">
            <span>Maximum investment (₹)</span>
            <input
              className="settings-input"
              inputMode="numeric"
              value={form.maxInvestmentAmount}
              onChange={(event) => update('maxInvestmentAmount', event.target.value)}
              required
            />
          </label>
        </div>
        <div className="settings-row">
          <label className="settings-field">
            <span>Agreement charges (₹)</span>
            <input
              className="settings-input"
              inputMode="numeric"
              value={form.agreementCharges}
              onChange={(event) => update('agreementCharges', event.target.value)}
              required
            />
          </label>
          <label className="settings-field">
            <span>Payout day</span>
            <select
              className="settings-input"
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
        </div>
        <div className="settings-row">
          <label className="settings-field">
            <span>Interest rate (% per month)</span>
            <input
              className="settings-input"
              inputMode="decimal"
              value={form.interestRatePercent}
              onChange={(event) => update('interestRatePercent', event.target.value)}
              required
            />
          </label>
          <label className="settings-field">
            <span>TDS (%)</span>
            <input
              className="settings-input"
              inputMode="decimal"
              value={form.tdsPercent}
              onChange={(event) => update('tdsPercent', event.target.value)}
              required
            />
          </label>
        </div>
        <div className="settings-row">
          <label className="settings-field">
            <span>Referral bonus (%)</span>
            <input
              className="settings-input"
              inputMode="decimal"
              value={form.referralRatePercent}
              onChange={(event) => update('referralRatePercent', event.target.value)}
              required
            />
          </label>
          <label className="settings-field">
            <span>Referral TDS (%)</span>
            <input
              className="settings-input"
              inputMode="decimal"
              value={form.referralTdsPercent}
              onChange={(event) => update('referralTdsPercent', event.target.value)}
              required
            />
          </label>
        </div>

        <h2>Loan agreement — Second Party</h2>
        <AgreementPartyFields values={party} errors={partyErrors} onChange={updateParty} />

        <div className="settings-actions">
          <Link className="settings-reset" to="/clients">
            Cancel
          </Link>
          <button type="submit" className="primary-btn settings-save" disabled={isSaving}>
            {isSaving ? 'Creating…' : 'Create Client'}
          </button>
        </div>
      </form>
    </>
  );
}
