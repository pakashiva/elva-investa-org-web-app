import type { BorrowingSetupForm } from '../types/borrowing';

const DOCUMENT_OPTIONS = [
  ['aadhaar', 'Aadhaar'],
  ['pan', 'PAN'],
] as const;

type Props = {
  value: BorrowingSetupForm;
  onChange: (next: BorrowingSetupForm) => void;
};

export function BorrowingSetupFields({ value, onChange }: Props) {
  function set<K extends keyof BorrowingSetupForm>(key: K, next: BorrowingSetupForm[K]) {
    onChange({ ...value, [key]: next });
  }

  function selectField<K extends keyof BorrowingSetupForm>(
    label: string,
    key: K,
    options: Array<[string, string]>
  ) {
    return (
      <label className="create-field" key={String(key)}>
        <span>{label} *</span>
        <select
          value={String(value[key])}
          onChange={(event) => set(key, event.target.value as BorrowingSetupForm[K])}
          required
        >
          <option value="">Select…</option>
          {options.map(([id, option]) => (
            <option value={id} key={id}>{option}</option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <section className="create-section">
      <h3>Borrow product and rules</h3>
      <p className="form-hint">
        These settings apply to this client&apos;s default loan product. They are stored with each loan
        so later changes do not rewrite existing loan terms.
      </p>
      <div className="create-grid">
        <label className="create-field">
          <span>Default loan product name *</span>
          <input value={value.name} onChange={(event) => set('name', event.target.value)} required />
        </label>
        {selectField('Interest calculation model', 'interestModel', [
          ['simple', 'Simple interest'],
          ['flat', 'Flat rate'],
          ['reducing_balance', 'Reducing balance'],
        ])}
        <label className="create-field">
          <span>Interest rate (%) *</span>
          <input
            type="number"
            min="0"
            max="100"
            step="0.0001"
            inputMode="decimal"
            value={value.interestRatePercent}
            onChange={(event) => set('interestRatePercent', event.target.value)}
            required
          />
        </label>
        {selectField('Rate applies per', 'interestRatePeriod', [
          ['daily', 'Day'], ['weekly', 'Week'], ['monthly', 'Month'], ['annual', 'Year'],
        ])}
        {selectField('Interest frequency', 'interestFrequency', [
          ['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly'],
          ['quarterly', 'Quarterly'], ['at_maturity', 'At maturity'],
        ])}
        {selectField('Repayment model', 'repaymentModel', [
          ['interest_only', 'Interest only'],
          ['principal_and_interest', 'Principal and interest'],
          ['bullet', 'Single payment at maturity'],
        ])}
        {selectField('Repayment frequency', 'repaymentFrequency', [
          ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['quarterly', 'Quarterly'],
          ['at_maturity', 'At maturity'],
        ])}
        {selectField('Payment allocation order', 'paymentAllocation', [
          ['interest_first', 'Interest first'], ['principal_first', 'Principal first'],
        ])}
        <label className="create-field">
          <span>Grace period (days) *</span>
          <input
            type="number"
            min="0"
            step="1"
            value={value.gracePeriodDays}
            onChange={(event) => set('gracePeriodDays', event.target.value)}
            required
          />
        </label>
        {selectField('Overdue treatment', 'overdueRule', [
          ['status_only', 'Mark overdue only'],
          ['percentage_charge', 'Percentage charge'],
          ['fixed_charge', 'Fixed charge'],
        ])}
        <label className="create-field">
          <span>Overdue charge (0 if none) *</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={value.overdueCharge}
            onChange={(event) => set('overdueCharge', event.target.value)}
            required
          />
          <small className="field-hint">Percentage for percentage charge; currency amount for fixed charge.</small>
        </label>
        {selectField('Part payments', 'partPaymentsAllowed', [['yes', 'Allowed'], ['no', 'Not allowed']])}
        {selectField('Advance payment treatment', 'advancePaymentTreatment', [
          ['reduce_principal', 'Reduce principal'],
          ['cover_future_dues', 'Cover future dues'],
          ['credit_balance', 'Keep as a credit balance'],
        ])}
        {selectField('Loan approval', 'approvalWorkflow', [
          ['manual', 'Manual approval'], ['direct_activation', 'Direct activation'],
        ])}
        <label className="create-field">
          <span>Disbursement *</span>
          <input value="Manual record by Client Admin" readOnly required />
          <small className="field-hint">The app records disbursement; it does not move money.</small>
        </label>
        {selectField('Payment receipt', 'receiptRequired', [['yes', 'Required'], ['no', 'Not required']])}
        {selectField('Write-offs', 'writeOffAllowed', [['yes', 'Allowed'], ['no', 'Not allowed']])}
        {selectField('Loan closure', 'closureMode', [
          ['automatic', 'Automatic when paid in full'], ['manual', 'Client Admin closes manually'],
        ])}
        <label className="create-field">
          <span>Rounding decimal places *</span>
          <select
            value={value.roundingScale}
            onChange={(event) => set('roundingScale', event.target.value)}
            required
          >
            {[0, 1, 2, 3, 4].map((scale) => <option key={scale} value={scale}>{scale}</option>)}
          </select>
        </label>
      </div>
      <fieldset className="create-field borrower-documents-fieldset">
        <legend style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Required borrower documents *</legend>
        <div className="borrower-document-options">
          {DOCUMENT_OPTIONS.map(([id, label]) => (
            <label key={id} className="borrower-document-option">
              <input
                type="checkbox"
                checked={value.requiredDocuments.includes(id)}
                onChange={(event) => {
                  const next = event.target.checked
                    ? [...value.requiredDocuments, id]
                    : value.requiredDocuments.filter((item) => item !== id);
                  set('requiredDocuments', next);
                }}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
        {value.requiredDocuments.length === 0 ? <em>Select at least one document.</em> : null}
      </fieldset>
    </section>
  );
}
