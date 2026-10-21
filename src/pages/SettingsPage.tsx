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
import { ErrorBanner, FlashMessage } from '../components/States';
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
  saveLoanDefaults,
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

  async function onSaveLoanDefaults(event: FormEvent) { event.preventDefault(); if(!settings?.loanDefaults)return; setIsSaving(true);setError(null);setNotice(null);try{const saved=await saveLoanDefaults(settings.loanDefaults);setSettings(saved);setNotice('Default loan terms saved.');}catch(err){setError(err instanceof Error?err.message:'Failed to save loan defaults');}finally{setIsSaving(false);} }
  function updateLoanDefault(key:string,value:string|boolean){setSettings(current=>current?.loanDefaults?{...current,loanDefaults:{...current.loanDefaults,[key]:['interest_rate_percent','overdue_charge','grace_period_days','rounding_scale'].includes(key)?Number(value):value}}:current);}

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
      {notice ? <FlashMessage>{notice}</FlashMessage> : null}

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
                <span>Client name</span>
                <p className="settings-readonly">{settings.clientName}</p>
              </div>
              <div className="settings-field">
                <span>Client code</span>
                <p className="settings-readonly">{settings.clientCode}</p>
              </div>
            </div>
            <div className="settings-row">
              <div className="settings-field">
                <span>Payout day</span>
                <p className="settings-readonly">{settings.defaultPayoutDay}</p>
              </div>
              <div className="settings-field">
                <span>Minimum investment</span>
                <p className="settings-readonly">{formatInr(settings.minInvestmentAmount)}</p>
              </div>
            </div>
            <div className="settings-row">
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
            </div>
            <div className="settings-row">
              <div className="settings-field">
                <span>Interest / TDS</span>
                <p className="settings-readonly">
                  {formatPercent(settings.defaultInterestRate)} per month ·{' '}
                  {formatPercent(settings.defaultTdsPercent)} TDS
                </p>
              </div>
              <div className="settings-field">
                <span>Referral commission</span>
                <p className="settings-readonly">
                  {formatPercent(settings.referralRate)} gross ·{' '}
                  {formatPercent(settings.referralTdsRate)} TDS
                </p>
              </div>
            </div>
            <div className="settings-row">
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

      <form className="card settings-card" onSubmit={(event)=>void onSaveLoanDefaults(event)}>
        <h2>Default loan approval terms</h2><p className="form-hint">Saved during client registration. “Use defaults” on loan approval uses these values.</p>
        {!settings?.loanDefaults?<p className="state-box">No active borrowing product is configured for this client.</p>:<>
          <div className="settings-row"><label className="settings-field"><span>Interest rate (%)</span><input className="settings-input" type="number" min="0" max="100" step="0.01" value={String(settings.loanDefaults.interest_rate_percent??'')} onChange={e=>updateLoanDefault('interest_rate_percent',e.target.value)}/></label><label className="settings-field"><span>Interest type</span><select className="settings-input" value={String(settings.loanDefaults.interest_model)} onChange={e=>updateLoanDefault('interest_model',e.target.value)}><option value="simple">Simple</option><option value="flat">Flat</option><option value="reducing_balance">Reducing balance</option></select></label><label className="settings-field"><span>Rate period</span><select className="settings-input" value={String(settings.loanDefaults.interest_rate_period)} onChange={e=>updateLoanDefault('interest_rate_period',e.target.value)}>{['daily','weekly','monthly','annual'].map(x=><option key={x} value={x}>{x}</option>)}</select></label></div>
          <div className="settings-row"><label className="settings-field"><span>Interest frequency</span><select className="settings-input" value={String(settings.loanDefaults.interest_frequency)} onChange={e=>updateLoanDefault('interest_frequency',e.target.value)}>{['daily','weekly','monthly','quarterly','at_maturity'].map(x=><option key={x} value={x}>{x.replaceAll('_',' ')}</option>)}</select></label><label className="settings-field"><span>Repayment model</span><select className="settings-input" value={String(settings.loanDefaults.repayment_model)} onChange={e=>updateLoanDefault('repayment_model',e.target.value)}>{['interest_only','principal_and_interest','bullet'].map(x=><option key={x} value={x}>{x.replaceAll('_',' ')}</option>)}</select></label><label className="settings-field"><span>Repayment frequency</span><select className="settings-input" value={String(settings.loanDefaults.repayment_frequency)} onChange={e=>updateLoanDefault('repayment_frequency',e.target.value)}>{['weekly','monthly','quarterly','at_maturity'].map(x=><option key={x} value={x}>{x.replaceAll('_',' ')}</option>)}</select></label></div>
          <div className="settings-row"><label className="settings-field"><span>Payment allocation</span><select className="settings-input" value={String(settings.loanDefaults.payment_allocation)} onChange={e=>updateLoanDefault('payment_allocation',e.target.value)}><option value="interest_first">Interest first</option><option value="principal_first">Principal first</option></select></label><label className="settings-field"><span>Grace period (days)</span><input className="settings-input" type="number" min="0" step="1" value={String(settings.loanDefaults.grace_period_days)} onChange={e=>updateLoanDefault('grace_period_days',e.target.value)}/></label><label className="settings-field"><span>Overdue treatment</span><select className="settings-input" value={String(settings.loanDefaults.overdue_rule)} onChange={e=>updateLoanDefault('overdue_rule',e.target.value)}>{['status_only','percentage_charge','fixed_charge'].map(x=><option key={x} value={x}>{x.replaceAll('_',' ')}</option>)}</select></label><label className="settings-field"><span>Overdue charge</span><input className="settings-input" type="number" min="0" step="0.01" value={String(settings.loanDefaults.overdue_charge)} onChange={e=>updateLoanDefault('overdue_charge',e.target.value)}/></label></div>
          <div className="settings-row"><label className="settings-field"><span>Advance payment treatment</span><select className="settings-input" value={String(settings.loanDefaults.advance_payment_treatment)} onChange={e=>updateLoanDefault('advance_payment_treatment',e.target.value)}>{['reduce_principal','cover_future_dues','credit_balance'].map(x=><option key={x} value={x}>{x.replaceAll('_',' ')}</option>)}</select></label><label className="settings-field"><span>Approval workflow</span><select className="settings-input" value={String(settings.loanDefaults.approval_workflow)} onChange={e=>updateLoanDefault('approval_workflow',e.target.value)}><option value="manual">Manual approval</option><option value="direct_activation">Direct activation</option></select></label><label className="settings-field"><span>Closure mode</span><select className="settings-input" value={String(settings.loanDefaults.closure_mode)} onChange={e=>updateLoanDefault('closure_mode',e.target.value)}><option value="automatic">Automatic</option><option value="manual">Manual</option></select></label><label className="settings-field"><span>Rounding scale</span><select className="settings-input" value={String(settings.loanDefaults.rounding_scale)} onChange={e=>updateLoanDefault('rounding_scale',e.target.value)}>{[0,1,2,3,4].map(x=><option key={x} value={x}>{x} decimal places</option>)}</select></label></div>
          <div className="settings-row">{([['part_payments_allowed','Allow part payments'],['receipt_required','Receipt required'],['write_off_allowed','Allow write-off']] as const).map(([key,label])=><label className="borrower-document-option" key={key}><input type="checkbox" checked={Boolean(settings.loanDefaults?.[key])} onChange={e=>updateLoanDefault(key,e.target.checked)}/>{label}</label>)}</div>
          <div className="settings-actions"><button type="submit" className="primary-btn settings-save" disabled={isSaving}>{isSaving?'Saving…':'Save loan defaults'}</button></div>
        </>}
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
            numericOnly
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
  numericOnly = false,
  values,
  draft,
  onDraft,
  busy,
  onAdd,
  onRemove,
}: {
  title: string;
  numericOnly?: boolean;
  values: string[];
  draft: string;
  onDraft: (value: string) => void;
  busy: boolean;
  onAdd: () => void;
  onRemove: (value: string) => void;
}) {
  return (
    <div className="settings-preset-col">
      <h3>{title} *</h3>
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
          inputMode={numericOnly ? 'numeric' : undefined}
          required
          onChange={(event) =>
            onDraft(
              numericOnly
                ? event.target.value.replace(/\D/g, '')
                : event.target.value
            )
          }
          placeholder={`Add ${title.toLowerCase()}`}
        />
        <button type="button" className="primary-btn" disabled={busy || !draft.trim()} onClick={onAdd}>
          Add
        </button>
      </div>
    </div>
  );
}
