import {
  AGREEMENT_NOMINEE_RELATIONS,
  MAX_AGREEMENT_OFFICES,
  emptyOffice,
  type AgreementOfficeForm,
  type AgreementPartyErrors,
  type AgreementPartyForm,
} from '../agreementParty';

type Props = {
  values: AgreementPartyForm;
  errors: AgreementPartyErrors;
  fieldClassName?: string;
  inputClassName?: string;
  onChange: <K extends keyof AgreementPartyForm>(key: K, value: AgreementPartyForm[K]) => void;
};

export function AgreementPartyFields({
  values,
  errors,
  fieldClassName = 'create-field',
  inputClassName,
  onChange,
}: Props) {
  const inputClass = inputClassName ? { className: inputClassName } : {};

  function updateOffice<K extends keyof AgreementOfficeForm>(
    index: number,
    key: K,
    value: AgreementOfficeForm[K]
  ) {
    onChange(
      'offices',
      values.offices.map((office, officeIndex) =>
        officeIndex === index ? { ...office, [key]: value } : office
      )
    );
  }

  function addOffice() {
    if (values.offices.length >= MAX_AGREEMENT_OFFICES) return;
    onChange('offices', [...values.offices, emptyOffice()]);
  }

  function removeOffice(index: number) {
    if (values.offices.length <= 1) return;
    onChange(
      'offices',
      values.offices.filter((_, officeIndex) => officeIndex !== index)
    );
  }

  return (
    <>
      <p className="form-hint">
        These details print as the Second Party on the loan agreement. Add every office this trader
        operates from. The selected office’s city is where the agreement is executed, and that
        office’s notice period is used for withdrawals.
      </p>
      <div className="create-grid">
        <label className={fieldClassName}>
          <span>Second party legal name *</span>
          <input
            {...inputClass}
            value={values.name}
            onChange={(event) => onChange('name', event.target.value)}
            placeholder="Mr. VENKATESH C"
          />
          {errors.name ? <em>{errors.name}</em> : null}
        </label>
      </div>

      {errors.offices ? <em className="create-field-error">{errors.offices}</em> : null}

      {values.offices.map((office, index) => {
        const officeErrors = errors.officeErrors?.[index] ?? {};
        return (
          <div className="agreement-office-card" key={office.id}>
            <div className="agreement-office-card-head">
              <h4 className="agreement-party-subhead">
                Office {index + 1}
                {office.placeName.trim() ? ` — ${office.placeName.trim()}` : ''}
              </h4>
              {values.offices.length > 1 ? (
                <button type="button" className="ghost-btn" onClick={() => removeOffice(index)}>
                  Remove
                </button>
              ) : null}
            </div>
            <div className="create-grid">
              <label className={fieldClassName}>
                <span>City / place *</span>
                <input
                  {...inputClass}
                  value={office.placeName}
                  onChange={(event) => updateOffice(index, 'placeName', event.target.value)}
                  placeholder="Ballari"
                />
                {officeErrors.placeName ? <em>{officeErrors.placeName}</em> : null}
              </label>
              <label className={fieldClassName}>
                <span>Withdrawal notice (days) *</span>
                <input
                  {...inputClass}
                  value={office.noticeDays}
                  onChange={(event) =>
                    updateOffice(index, 'noticeDays', event.target.value.replace(/\D/g, '').slice(0, 3))
                  }
                  placeholder="30"
                  inputMode="numeric"
                />
                {officeErrors.noticeDays ? <em>{officeErrors.noticeDays}</em> : null}
              </label>
              <label className={`${fieldClassName} create-field-wide`}>
                <span>Address *</span>
                <textarea
                  {...inputClass}
                  rows={3}
                  value={office.address}
                  onChange={(event) => updateOffice(index, 'address', event.target.value)}
                  placeholder="Office address as it should appear on the agreement"
                />
                {officeErrors.address ? <em>{officeErrors.address}</em> : null}
              </label>
              <label className={fieldClassName}>
                <span>Phone *</span>
                <input
                  {...inputClass}
                  value={office.phone}
                  onChange={(event) =>
                    updateOffice(index, 'phone', event.target.value.replace(/\D/g, '').slice(0, 10))
                  }
                  placeholder="10-digit mobile"
                  inputMode="numeric"
                />
                {officeErrors.phone ? <em>{officeErrors.phone}</em> : null}
              </label>
              <label className={fieldClassName}>
                <span>Email *</span>
                <input
                  {...inputClass}
                  type="email"
                  value={office.email}
                  onChange={(event) => updateOffice(index, 'email', event.target.value)}
                  placeholder="office@example.com"
                />
                {officeErrors.email ? <em>{officeErrors.email}</em> : null}
              </label>
            </div>
          </div>
        );
      })}

      {values.offices.length < MAX_AGREEMENT_OFFICES ? (
        <button type="button" className="ghost-btn agreement-add-office" onClick={addOffice}>
          Add another office
        </button>
      ) : null}

      <h4 className="agreement-party-subhead">Second party nominee</h4>
      <div className="create-grid">
        <label className={fieldClassName}>
          <span>Nominee name *</span>
          <input
            {...inputClass}
            value={values.nomineeName}
            onChange={(event) => onChange('nomineeName', event.target.value)}
            placeholder="Full name"
          />
          {errors.nomineeName ? <em>{errors.nomineeName}</em> : null}
        </label>
        <label className={fieldClassName}>
          <span>Relationship *</span>
          <select
            {...inputClass}
            value={values.nomineeRelation}
            onChange={(event) => onChange('nomineeRelation', event.target.value)}
          >
            <option value="">Select relationship</option>
            {AGREEMENT_NOMINEE_RELATIONS.map((relation) => (
              <option key={relation} value={relation}>
                {relation}
              </option>
            ))}
          </select>
          {errors.nomineeRelation ? <em>{errors.nomineeRelation}</em> : null}
        </label>
        <label className={fieldClassName}>
          <span>Aadhaar *</span>
          <input
            {...inputClass}
            value={values.nomineeAadhaar}
            onChange={(event) =>
              onChange('nomineeAadhaar', event.target.value.replace(/\D/g, '').slice(0, 12))
            }
            placeholder="12 digits"
            inputMode="numeric"
          />
          {errors.nomineeAadhaar ? <em>{errors.nomineeAadhaar}</em> : null}
        </label>
        <label className={fieldClassName}>
          <span>PAN *</span>
          <input
            {...inputClass}
            value={values.nomineePan}
            onChange={(event) =>
              onChange(
                'nomineePan',
                event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10)
              )
            }
            placeholder="ABCDE1234F"
            maxLength={10}
          />
          {errors.nomineePan ? <em>{errors.nomineePan}</em> : null}
        </label>
        <label className={fieldClassName}>
          <span>Phone *</span>
          <input
            {...inputClass}
            value={values.nomineePhone}
            onChange={(event) =>
              onChange('nomineePhone', event.target.value.replace(/\D/g, '').slice(0, 10))
            }
            placeholder="10-digit mobile"
            inputMode="numeric"
          />
          {errors.nomineePhone ? <em>{errors.nomineePhone}</em> : null}
        </label>
      </div>
    </>
  );
}
