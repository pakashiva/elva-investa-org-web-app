import { useEffect, useState, type FormEvent } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  EMPTY_AGREEMENT_PARTY,
  partyPayload,
  validateAgreementPartyForm,
  type AgreementPartyErrors,
  type AgreementPartyForm,
} from '../agreementParty';
import { AppHeader } from '../components/AppHeader';
import { AgreementPartyFields } from '../components/AgreementPartyFields';
import { ErrorBanner } from '../components/States';
import type { AdminOutletContext } from '../layouts/AdminLayout';
import {
  addChequePreset,
  deleteChequePreset,
  listChequePresets,
} from '../services/agreementService';
import {
  getClientSettings,
  saveClientAgreementParty,
  saveClientSupport,
  type ClientSettingsView,
} from '../services/settingsService';
import type { ChequeFieldPresets } from '../types/admin';
import { formatInr, formatPercent } from '../utils/format';

const EMPTY_PRESETS: ChequeFieldPresets = {
  cheque_nos: [],
  bank_names: [],
  bank_addresses: [],
};

export function SettingsPage() {
  const { onOpenMenu } = useOutletContext<AdminOutletContext>();
  const [settings, setSettings] = useState<ClientSettingsView | null>(null);
  const [supportEmail, setSupportEmail] = useState('');
  const [supportPhone, setSupportPhone] = useState('');
  const [party, setParty] = useState<AgreementPartyForm>(EMPTY_AGREEMENT_PARTY);
  const [partyErrors, setPartyErrors] = useState<AgreementPartyErrors>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingParty, setIsSavingParty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [presets, setPresets] = useState<ChequeFieldPresets>(EMPTY_PRESETS);
  const [newChequeNo, setNewChequeNo] = useState('');
  const [newBankName, setNewBankName] = useState('');
  const [newBankAddress, setNewBankAddress] = useState('');
  const [presetBusy, setPresetBusy] = useState(false);

  async function load() {
    setIsLoading(true);
    setError(null);
    try {
      const [next, nextPresets] = await Promise.all([getClientSettings(), listChequePresets()]);
      setSettings(next);
      setSupportEmail(next.supportEmail);
      setSupportPhone(next.supportPhone);
      setParty(next.agreementParty);
      setPartyErrors({});
      setPresets(nextPresets);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function onSave(event: FormEvent) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await saveClientSupport({ supportEmail, supportPhone });
      setSettings(saved);
      setNotice('Support contacts saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setIsSaving(false);
    }
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

  async function onSaveParty(event: FormEvent) {
    event.preventDefault();
    const nextPartyErrors = validateAgreementPartyForm(party);
    setPartyErrors(nextPartyErrors);
    if (Object.keys(nextPartyErrors).length > 0) {
      setError('Complete the Second Party agreement details.');
      return;
    }
    setIsSavingParty(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await saveClientAgreementParty(partyPayload(party));
      setSettings(saved);
      setParty(saved.agreementParty);
      setNotice('Agreement Second Party details saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save agreement details');
    } finally {
      setIsSavingParty(false);
    }
  }

  async function savePreset(
    fieldKind: 'cheque_no' | 'bank_name' | 'bank_address',
    value: string,
    reset: (next: string) => void
  ) {
    if (!value.trim()) return;
    setPresetBusy(true);
    setError(null);
    try {
      await addChequePreset(fieldKind, value.trim());
      setPresets(await listChequePresets());
      reset('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save cheque field');
    } finally {
      setPresetBusy(false);
    }
  }

  async function removePreset(
    fieldKind: 'cheque_no' | 'bank_name' | 'bank_address',
    value: string
  ) {
    setPresetBusy(true);
    setError(null);
    try {
      await deleteChequePreset(fieldKind, value);
      setPresets(await listChequePresets());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove cheque field');
    } finally {
      setPresetBusy(false);
    }
  }

  return (
    <>
      <AppHeader
        title="Settings"
        subtitle="Product limits are set by ELVA. Update support contacts and the Second Party printed on loan agreements."
        onOpenMenu={onOpenMenu}
      />

      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
      {notice ? <div className="notice-box">{notice}</div> : null}

      <section className="card settings-card client-form">
        <h2>Product configuration</h2>
        {isLoading || !settings ? (
          <p className="state-box">Loading settings…</p>
        ) : (
          <>
            <p className="form-hint">
              These values were set when ELVA onboarded {settings.clientName}. New funds snapshot
              them; changing them later requires Super Admin.
            </p>
            <div className="settings-row">
              <div className="settings-field">
                <span>Client</span>
                <p className="settings-readonly">
                  {settings.clientName} ({settings.clientCode})
                </p>
              </div>
              <div className="settings-field">
                <span>Payout day</span>
                <p className="settings-readonly">{settings.defaultPayoutDay}</p>
              </div>
            </div>
            <div className="settings-row">
              <div className="settings-field">
                <span>Minimum investment</span>
                <p className="settings-readonly">{formatInr(settings.minInvestmentAmount)}</p>
              </div>
              <div className="settings-field">
                <span>Maximum investment</span>
                <p className="settings-readonly">{formatInr(settings.maxInvestmentAmount)}</p>
              </div>
            </div>
            <div className="settings-row">
              <div className="settings-field">
                <span>Agreement charges</span>
                <p className="settings-readonly">{formatInr(settings.agreementCharges)}</p>
              </div>
              <div className="settings-field">
                <span>Interest / TDS</span>
                <p className="settings-readonly">
                  {formatPercent(settings.defaultInterestRate)} per month ·{' '}
                  {formatPercent(settings.defaultTdsPercent)} TDS
                </p>
              </div>
            </div>
            <div className="settings-row">
              <div className="settings-field">
                <span>Referral commission</span>
                <p className="settings-readonly">
                  {formatPercent(settings.referralRate)} gross ·{' '}
                  {formatPercent(settings.referralTdsRate)} TDS
                </p>
              </div>
              <div className="settings-field">
                <span>Currency</span>
                <p className="settings-readonly">{settings.defaultCurrency}</p>
              </div>
            </div>
          </>
        )}
      </section>

      <form className="card settings-card" onSubmit={(event) => void onSave(event)}>
        <h2>Support contacts</h2>
        <label className="settings-field">
          <span>Support Email</span>
          <input
            className="settings-input"
            type="email"
            value={supportEmail}
            onChange={(event) => setSupportEmail(event.target.value)}
            placeholder="support@example.com"
          />
        </label>
        <label className="settings-field">
          <span>Support Phone</span>
          <input
            className="settings-input"
            type="tel"
            value={supportPhone}
            onChange={(event) => setSupportPhone(event.target.value)}
            placeholder="+91 98765 43210"
          />
        </label>
        <div className="settings-actions">
          <button type="submit" className="primary-btn settings-save" disabled={isSaving || isLoading}>
            {isSaving ? 'Saving…' : 'Save Contacts'}
          </button>
        </div>
      </form>

      <form className="card settings-card" onSubmit={(event) => void onSaveParty(event)}>
        <h2>Loan agreement — Second Party</h2>
        {isLoading || !settings ? (
          <p className="state-box">Loading agreement details…</p>
        ) : (
          <>
            <AgreementPartyFields values={party} errors={partyErrors} onChange={updateParty} />
            <div className="settings-actions">
              <button
                type="submit"
                className="primary-btn settings-save"
                disabled={isSavingParty || isLoading}
              >
                {isSavingParty ? 'Saving…' : 'Save agreement details'}
              </button>
            </div>
          </>
        )}
      </form>

      <section className="card settings-card">
        <h2>Surety cheque presets</h2>
        <p className="form-hint">
          These values fill the agreement approval dropdowns. Approving a fund or renewal also
          remembers new cheque fields automatically.
        </p>
        <div className="settings-preset-grid">
          <ChequePresetColumn
            title="Cheque numbers"
            values={presets.cheque_nos}
            draft={newChequeNo}
            onDraft={setNewChequeNo}
            busy={presetBusy}
            onAdd={() => void savePreset('cheque_no', newChequeNo, setNewChequeNo)}
            onRemove={(value) => void removePreset('cheque_no', value)}
          />
          <ChequePresetColumn
            title="Bank names"
            values={presets.bank_names}
            draft={newBankName}
            onDraft={setNewBankName}
            busy={presetBusy}
            onAdd={() => void savePreset('bank_name', newBankName, setNewBankName)}
            onRemove={(value) => void removePreset('bank_name', value)}
          />
          <ChequePresetColumn
            title="Bank addresses"
            values={presets.bank_addresses}
            draft={newBankAddress}
            onDraft={setNewBankAddress}
            busy={presetBusy}
            onAdd={() => void savePreset('bank_address', newBankAddress, setNewBankAddress)}
            onRemove={(value) => void removePreset('bank_address', value)}
          />
        </div>
      </section>
    </>
  );
}

function ChequePresetColumn({
  title,
  values,
  draft,
  onDraft,
  busy,
  onAdd,
  onRemove,
}: {
  title: string;
  values: string[];
  draft: string;
  onDraft: (value: string) => void;
  busy: boolean;
  onAdd: () => void;
  onRemove: (value: string) => void;
}) {
  return (
    <div className="settings-preset-col">
      <h3>{title}</h3>
      <ul className="settings-preset-list">
        {values.length === 0 ? <li className="muted">None saved yet</li> : null}
        {values.map((value) => (
          <li key={value}>
            <span>{value}</span>
            <button type="button" className="ghost-btn" disabled={busy} onClick={() => onRemove(value)}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="settings-preset-add">
        <input
          className="settings-input"
          value={draft}
          onChange={(event) => onDraft(event.target.value)}
          placeholder={`Add ${title.toLowerCase()}`}
        />
        <button type="button" className="primary-btn" disabled={busy || !draft.trim()} onClick={onAdd}>
          Add
        </button>
      </div>
    </div>
  );
}
