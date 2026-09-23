import { FileText, X } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { EMPTY_AGREEMENT_PARTY, type AgreementOfficeForm } from '../agreementParty';
import { listChequePresets } from '../services/agreementService';
import { getClientSettings } from '../services/settingsService';
import type { AgreementInputs, ChequeFieldPresets } from '../types/admin';

const NEW_VALUE = '__new__';

const EMPTY_PRESETS: ChequeFieldPresets = {
  cheque_nos: [],
  bank_names: [],
  bank_addresses: [],
};

type Props = {
  open: boolean;
  title: string;
  confirmLabel: string;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: (inputs: AgreementInputs) => void;
};

type SavedFieldProps = {
  label: string;
  savedLabel: string;
  addLabel: string;
  placeholder: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
};

function SavedValueField({
  label,
  savedLabel,
  addLabel,
  placeholder,
  options,
  value,
  onChange,
}: SavedFieldProps) {
  const matched = options.find((item) => item === value);
  const selectValue = matched ?? NEW_VALUE;

  return (
    <>
      <label className="create-field">
        <span>{savedLabel}</span>
        <select
          value={selectValue}
          onChange={(event) => {
            const next = event.target.value;
            onChange(next === NEW_VALUE ? '' : next);
          }}
        >
          {options.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
          <option value={NEW_VALUE}>{addLabel}</option>
        </select>
      </label>

      <label className="create-field">
        <span>{label}</span>
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
        />
      </label>
    </>
  );
}

export function AgreementDetailsModal({
  open,
  title,
  confirmLabel,
  busy = false,
  error: externalError = null,
  onClose,
  onConfirm,
}: Props) {
  const [offices, setOffices] = useState<AgreementOfficeForm[]>(EMPTY_AGREEMENT_PARTY.offices);
  const [officeId, setOfficeId] = useState('');
  const [presets, setPresets] = useState<ChequeFieldPresets>(EMPTY_PRESETS);
  const [chequeNo, setChequeNo] = useState('');
  const [bankName, setBankName] = useState('');
  const [bankAddress, setBankAddress] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setLocalError(null);
    void Promise.all([getClientSettings(), listChequePresets()])
      .then(([settings, rows]) => {
        const nextOffices = settings.agreementParty.offices.filter((office) => office.placeName.trim());
        setOffices(nextOffices);
        setOfficeId((current) => {
          if (current && nextOffices.some((office) => office.id === current)) return current;
          return nextOffices[0]?.id ?? '';
        });
        setPresets(rows);
        setChequeNo(rows.cheque_nos[0] ?? '');
        setBankName(rows.bank_names[0] ?? '');
        setBankAddress(rows.bank_addresses[0] ?? '');
      })
      .catch(() => {
        setOffices([]);
        setOfficeId('');
        setPresets(EMPTY_PRESETS);
        setChequeNo('');
        setBankName('');
        setBankAddress('');
      });
  }, [open]);

  const selectedOffice = useMemo(
    () => offices.find((office) => office.id === officeId) ?? null,
    [offices, officeId]
  );

  if (!open) {
    return null;
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!officeId || !selectedOffice) {
      setLocalError('Select the office where this agreement is executed.');
      return;
    }
    if (!chequeNo.trim()) {
      setLocalError('Enter the cheque number.');
      return;
    }
    if (!bankName.trim()) {
      setLocalError('Enter the cheque bank name.');
      return;
    }
    if (!bankAddress.trim()) {
      setLocalError('Enter the cheque bank address / branch.');
      return;
    }
    setLocalError(null);
    onConfirm({
      officeId,
      chequeNo: chequeNo.trim(),
      chequeBankName: bankName.trim(),
      chequeBankAddress: bankAddress.trim(),
    });
  }

  const error = localError || externalError;

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <form
        className="create-customer-modal agreement-modal"
        role="dialog"
        aria-labelledby="agreement-modal-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={submit}
      >
        <header className="create-customer-head">
          <h2 id="agreement-modal-title">
            <FileText size={18} /> {title}
          </h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
            disabled={busy}
          >
            <X size={18} />
          </button>
        </header>

        <div className="create-customer-body">
          {error ? <div className="error-box">{error}</div> : null}

          <section className="create-section">
            <h3>Agreement office</h3>
            {offices.length === 0 ? (
              <p className="form-hint">
                Add at least one office under Settings → Loan agreement before generating.
              </p>
            ) : (
              <div className="create-grid">
                <label className="create-field">
                  <span>Office</span>
                  <select value={officeId} onChange={(event) => setOfficeId(event.target.value)}>
                    {offices.map((office) => (
                      <option key={office.id} value={office.id}>
                        {office.placeName}
                      </option>
                    ))}
                  </select>
                  {selectedOffice ? (
                    <em className="field-hint">
                      Executed at {selectedOffice.placeName} · {selectedOffice.noticeDays} day
                      {selectedOffice.noticeDays === '1' ? '' : 's'} withdrawal notice
                    </em>
                  ) : null}
                </label>
              </div>
            )}
          </section>

          <section className="create-section">
            <h3>Surety Cheque</h3>
            <div className="create-grid">
              <SavedValueField
                savedLabel="Saved Cheque Numbers"
                label="Cheque Number"
                addLabel="+ Add new cheque number"
                placeholder="e.g. 143538"
                options={presets.cheque_nos}
                value={chequeNo}
                onChange={setChequeNo}
              />

              <SavedValueField
                savedLabel="Saved Bank Names"
                label="Bank Name"
                addLabel="+ Add new bank name"
                placeholder="e.g. SBI Bank"
                options={presets.bank_names}
                value={bankName}
                onChange={setBankName}
              />

              <SavedValueField
                savedLabel="Saved Bank Addresses"
                label="Bank Address / Branch"
                addLabel="+ Add new bank address"
                placeholder="e.g. Gunj Circle, Raichur Branch"
                options={presets.bank_addresses}
                value={bankAddress}
                onChange={setBankAddress}
              />
            </div>
            <p className="field-hint">
              New values are saved automatically and appear in the matching dropdown next time.
            </p>
          </section>
        </div>

        <footer className="create-customer-footer">
          <button type="button" className="ghost-btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="submit"
            className="gold-btn create-submit-btn"
            disabled={busy || offices.length === 0}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </footer>
      </form>
    </div>
  );
}
