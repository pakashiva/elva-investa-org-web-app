export type ClientModule = 'invest' | 'borrow';
export type CustomerType = 'investor' | 'borrower' | 'both';

export type BorrowingSetupForm = {
  name: string;
  interestModel: '' | 'simple' | 'flat' | 'reducing_balance';
  interestRatePercent: string;
  interestRatePeriod: '' | 'daily' | 'weekly' | 'monthly' | 'annual';
  interestFrequency: '' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'at_maturity';
  repaymentModel: '' | 'interest_only' | 'principal_and_interest' | 'bullet';
  repaymentFrequency: '' | 'weekly' | 'monthly' | 'quarterly' | 'at_maturity';
  paymentAllocation: '' | 'interest_first' | 'principal_first';
  gracePeriodDays: string;
  overdueRule: '' | 'status_only' | 'percentage_charge' | 'fixed_charge';
  overdueCharge: string;
  partPaymentsAllowed: '' | 'yes' | 'no';
  advancePaymentTreatment: '' | 'reduce_principal' | 'cover_future_dues' | 'credit_balance';
  approvalWorkflow: '' | 'manual' | 'direct_activation';
  receiptRequired: '' | 'yes' | 'no';
  writeOffAllowed: '' | 'yes' | 'no';
  closureMode: '' | 'automatic' | 'manual';
  roundingScale: string;
  requiredDocuments: string[];
};

export type BorrowingSetupInput = {
  name: string;
  interestModel: Exclude<BorrowingSetupForm['interestModel'], ''>;
  interestRatePercent: number;
  interestRatePeriod: Exclude<BorrowingSetupForm['interestRatePeriod'], ''>;
  interestFrequency: Exclude<BorrowingSetupForm['interestFrequency'], ''>;
  repaymentModel: Exclude<BorrowingSetupForm['repaymentModel'], ''>;
  repaymentFrequency: Exclude<BorrowingSetupForm['repaymentFrequency'], ''>;
  paymentAllocation: Exclude<BorrowingSetupForm['paymentAllocation'], ''>;
  gracePeriodDays: number;
  overdueRule: Exclude<BorrowingSetupForm['overdueRule'], ''>;
  overdueCharge: number;
  partPaymentsAllowed: boolean;
  advancePaymentTreatment: Exclude<BorrowingSetupForm['advancePaymentTreatment'], ''>;
  approvalWorkflow: Exclude<BorrowingSetupForm['approvalWorkflow'], ''>;
  receiptRequired: boolean;
  writeOffAllowed: boolean;
  closureMode: Exclude<BorrowingSetupForm['closureMode'], ''>;
  roundingScale: number;
  requiredDocuments: string[];
};

export const EMPTY_BORROWING_SETUP: BorrowingSetupForm = {
  name: 'General Loan',
  interestModel: '',
  interestRatePercent: '',
  interestRatePeriod: '',
  interestFrequency: '',
  repaymentModel: '',
  repaymentFrequency: '',
  paymentAllocation: '',
  gracePeriodDays: '0',
  overdueRule: '',
  overdueCharge: '0',
  partPaymentsAllowed: '',
  advancePaymentTreatment: '',
  approvalWorkflow: '',
  receiptRequired: '',
  writeOffAllowed: '',
  closureMode: '',
  roundingScale: '2',
  requiredDocuments: ['aadhaar', 'pan'],
};

export function toBorrowingSetupInput(form: BorrowingSetupForm): BorrowingSetupInput {
  return {
    ...form,
    interestModel: form.interestModel as BorrowingSetupInput['interestModel'],
    interestRatePercent: Number(form.interestRatePercent),
    interestRatePeriod: form.interestRatePeriod as BorrowingSetupInput['interestRatePeriod'],
    interestFrequency: form.interestFrequency as BorrowingSetupInput['interestFrequency'],
    repaymentModel: form.repaymentModel as BorrowingSetupInput['repaymentModel'],
    repaymentFrequency: form.repaymentFrequency as BorrowingSetupInput['repaymentFrequency'],
    paymentAllocation: form.paymentAllocation as BorrowingSetupInput['paymentAllocation'],
    gracePeriodDays: Number(form.gracePeriodDays),
    overdueRule: form.overdueRule as BorrowingSetupInput['overdueRule'],
    overdueCharge: Number(form.overdueCharge),
    partPaymentsAllowed: form.partPaymentsAllowed === 'yes',
    advancePaymentTreatment: form.advancePaymentTreatment as BorrowingSetupInput['advancePaymentTreatment'],
    approvalWorkflow: form.approvalWorkflow as BorrowingSetupInput['approvalWorkflow'],
    receiptRequired: form.receiptRequired === 'yes',
    writeOffAllowed: form.writeOffAllowed === 'yes',
    closureMode: form.closureMode as BorrowingSetupInput['closureMode'],
    roundingScale: Number(form.roundingScale),
  };
}

export function validateBorrowingSetup(form: BorrowingSetupForm): string | null {
  if (!form.name.trim()) return 'Enter a name for the default loan product.';
  if (!form.interestModel || !form.interestRatePeriod || !form.interestFrequency) {
    return 'Choose the interest model, rate period, and interest frequency.';
  }
  const rate = Number(form.interestRatePercent);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    return 'Enter an interest rate between 0 and 100 percent.';
  }
  if (!form.repaymentModel || !form.repaymentFrequency || !form.paymentAllocation) {
    return 'Choose the repayment model, frequency, and payment allocation order.';
  }
  if (!Number.isInteger(Number(form.gracePeriodDays)) || Number(form.gracePeriodDays) < 0) {
    return 'Grace period must be a whole number of days, 0 or more.';
  }
  if (!form.overdueRule) return 'Choose how overdue loans are handled.';
  const overdueCharge = Number(form.overdueCharge);
  if (!Number.isFinite(overdueCharge) || overdueCharge < 0) {
    return 'Enter a valid overdue charge.';
  }
  if (form.overdueRule === 'status_only' && overdueCharge !== 0) {
    return 'Set overdue charge to 0 when overdue treatment is status only.';
  }
  if (form.partPaymentsAllowed === '') return 'Choose whether part payments are allowed.';
  if (!form.advancePaymentTreatment) return 'Choose how advance payments are treated.';
  if (!form.approvalWorkflow) return 'Choose the loan approval workflow.';
  if (form.receiptRequired === '' || form.writeOffAllowed === '') {
    return 'Choose receipt and write-off policies.';
  }
  if (!form.closureMode) return 'Choose the loan closure policy.';
  if (!Number.isInteger(Number(form.roundingScale)) || Number(form.roundingScale) < 0 || Number(form.roundingScale) > 4) {
    return 'Choose a rounding precision from 0 to 4 decimal places.';
  }
  if (form.requiredDocuments.length === 0) return 'Choose at least one required borrower document.';
  return null;
}
