export type AdminRole = 'super_admin' | 'operator';

export type AdminMe = {
  user_id: string;
  role: AdminRole;
  full_name: string;
  email: string | null;
};

export type DashboardKpis = {
  totalWealthManaged: number;
  totalInvested: number;
  activeInvestments: number;
  activeInvestmentsThisWeek: number;
  interestPaidYtd: number;
  tdsDeductedYtd: number;
  totalWithdrawals: number;
  totalCustomers: number;
  newRegistrationsThisWeek: number;
  pendingRequests: number;
  pendingInvestments: number;
  pendingWithdrawals: number;
};

export type WealthPoint = {
  month: string;
  label: string;
  wealth: number;
};

export type FlowPoint = {
  month: string;
  label: string;
  inflow: number;
  outflow: number;
};

export type DashboardData = {
  kpis: DashboardKpis;
  wealthSeries: WealthPoint[];
  flowSeries: FlowPoint[];
};

export type ChartRangeMonths = 3 | 6 | 12;

export type CustomerFilter =
  | 'all'
  | 'active'
  | 'inactive'
  | 'with_investments'
  | 'no_investment';

export type CustomerSort = 'joined_desc' | 'joined_asc';

export type CustomerListRow = {
  user_id: string;
  customer_id: string | null;
  full_name: string;
  mobile_number: string;
  email_address: string;
  pan_number: string | null;
  active_investments: number;
  pending_investments: number;
  closed_investments: number;
  total_investments: number;
  total_invested: number;
  joined_at: string;
};

export type CustomerListResult = {
  rows: CustomerListRow[];
  total: number;
  limit: number;
  offset: number;
};

export type CustomerListParams = {
  filter: CustomerFilter;
  search: string;
  joinFrom: string | null;
  joinTo: string | null;
  sort: CustomerSort;
  page: number;
  pageSize: number;
};

export type CustomerProfile = {
  user_id: string;
  customer_id: string | null;
  full_name: string;
  mobile_number: string;
  email_address: string;
  date_of_birth: string;
  address: string;
  city: string;
  state: string;
  pin_code: string;
  pan_number: string | null;
};

export type CustomerBankAccount = {
  id: string;
  bank_name: string;
  account_number: string;
  ifsc_code: string;
  account_type: string;
  is_primary: boolean;
};

export type CustomerLedgerStatus = 'Completed' | 'Pending';
export type CustomerLedgerType = 'instant_credit' | 'withdrawal' | 'referral_bonus';

export type CustomerLedgerRow = {
  id: string;
  occurred_on: string;
  transaction_type: CustomerLedgerType;
  amount: number;
  status: CustomerLedgerStatus;
};

export type CustomerDetails = {
  profile: CustomerProfile;
  account_active: boolean;
  summary: {
    total_invested: number;
    active_plans: number;
    returns_earned: number;
  };
  banks: CustomerBankAccount[];
  transactions: CustomerLedgerRow[];
};

export type CustomerDetailsTab = 'profile' | 'banks' | 'transactions';

export type InvestmentRequestFilter =
  | 'all'
  | 'pending'
  | 'under_review'
  | 'approved'
  | 'rejected';

export type InvestmentRequestStatus =
  | 'Pending'
  | 'Under Review'
  | 'Active'
  | 'Closed'
  | 'Approved'
  | 'Rejected';

export type InvestmentQueueKind = 'investment' | 'renewal';

export type AgreementRenewalMode = 'same_amount' | 'increase';

export type InvestmentRequestListRow = {
  id: string;
  kind?: InvestmentQueueKind;
  code?: string | null;
  request_id: string | null;
  customer_name: string;
  customer_id: string | null;
  plan_name: string;
  fund_amount: number;
  status: InvestmentRequestStatus;
  created_at: string;
  mode?: AgreementRenewalMode | null;
  increment_amount?: number | null;
  agreement_id?: string | null;
};

export type InvestmentRequestListResult = {
  rows: InvestmentRequestListRow[];
  total: number;
  limit: number;
  offset: number;
};

export type InvestmentRequestDetail = {
  id: string;
  code?: string | null;
  request_id: string | null;
  status: InvestmentRequestStatus;
  plan_name: string;
  fund_amount: number;
  interest_rate: number;
  tds_percent: number;
  payout_day: number;
  referral_rate?: number;
  referral_tds_rate?: number;
  referral_code?: string | null;
  referrer_user_id?: string | null;
  referrer_name?: string | null;
  created_at: string;
  user_id: string;
  customer_name: string;
  customer_id: string | null;
  active_portfolio: number;
  active_plans: number;
  bank: {
    bank_name: string;
    account_number: string;
    ifsc_code: string;
  } | null;
};

export type AgreementRenewalDetail = {
  id: string;
  kind: 'renewal';
  status: 'Pending' | 'Approved' | 'Rejected';
  mode: AgreementRenewalMode;
  agreement_id: string;
  customer_id: string | null;
  customer_name: string;
  current_amount: number;
  increment_amount: number | null;
  new_principal: number;
  created_at: string;
  user_id: string;
  investment_id: string;
  plan_no: string | null;
  plan_name: string;
  investment_status: string;
  fund_amount: number;
  interest_rate: number;
  tds_percent: number;
  payout_day: number;
  invested_date: string | null;
  bank: {
    bank_name: string;
    account_number: string;
    ifsc_code: string;
  } | null;
};

export type InvestmentDecision = 'approve' | 'hold' | 'reject';
export type RenewalDecision = 'approve' | 'reject';

export type ApprovedInvestmentEdit = {
  id: string;
  code: string | null;
  request_id: string | null;
  status: InvestmentRequestStatus;
  user_id: string;
  customer_id: string | null;
  plan_name: string;
  fund_amount: number;
  interest_rate: number;
  tds_percent: number;
  payout_day: number;
  customer: {
    full_name: string;
    email: string;
    mobile: string;
    date_of_birth: string;
    address: string;
    pan: string;
    aadhaar: string;
  };
  bank: {
    id: string;
    bank_name: string;
    account_number: string;
    ifsc_code: string;
    account_type: string;
    account_holder_name: string;
    branch_name: string;
  } | null;
  nominee: {
    name: string;
    relation: string;
    aadhaar: string;
    pan: string;
    mobile: string;
  } | null;
  agreement: {
    officeId: string | null;
    placeName: string;
    cheque_no: string;
    cheque_bank_name: string;
    cheque_bank_address: string;
  } | null;
};

export type UpdateApprovedInvestmentInput = {
  id: string;
  fullName: string;
  email: string;
  mobile: string;
  dateOfBirth: string;
  address: string;
  panNumber: string;
  aadhaarNumber: string;
  nomineeName: string;
  nomineeRelationship: string;
  nomineeAadhaar: string;
  nomineePan: string;
  nomineeMobile: string;
  planName: string;
  fundAmount: number;
  interestRate: number;
  tdsPercent: number;
  payoutDay: number;
  bankName: string;
  accountNumber: string;
  ifscCode: string;
  accountType: 'Savings' | 'Current';
  accountHolderName: string;
  branchName: string;
  officeId?: string | null;
  chequeNo?: string | null;
  chequeBankName?: string | null;
  chequeBankAddress?: string | null;
};

export type ChequeFieldPresets = {
  cheque_nos: string[];
  bank_names: string[];
  bank_addresses: string[];
};

export type AgreementInputs = {
  officeId: string;
  chequeNo: string;
  chequeBankName: string;
  chequeBankAddress: string;
};

export type AgreementPayload = {
  agreement: {
    id: string;
    branch: string;
    noticeDays: number;
    agreement_date: string;
    period_from: string;
    period_to: string;
    cheque_no: string;
    cheque_bank_name: string;
    cheque_bank_address: string;
    renewal_id: string | null;
  };
  investment: {
    id: string;
    code: string | null;
    plan_name: string;
    fund_amount: number;
    interest_rate: number;
    tds_percent: number;
  };
  customer: {
    customer_id: string | null;
    full_name: string;
    address: string;
    email: string;
    mobile: string;
    pan: string;
    aadhaar: string;
  };
  bank: {
    holder: string;
    account_number: string;
    ifsc_code: string;
    bank_name: string;
    branch_name: string;
  } | null;
  nominee: {
    name: string;
    relation: string;
    aadhaar: string;
    pan: string;
    mobile: string;
  } | null;
  processingFee: number;
  secondParty: {
    name: string;
    address: string;
    phone: string;
    email: string;
    placeName: string;
    noticeDays: number;
    nomineeName: string;
    nomineeAadhaar: string;
    nomineePan: string;
    nomineeRelation: string;
    nomineePhone: string;
  };
};

export type WithdrawalFilter = 'pending' | 'approved' | 'rejected';

export type WithdrawalStatus =
  | 'Processing'
  | 'On Hold'
  | 'Approved'
  | 'Paid'
  | 'Rejected';

export type WithdrawalListRow = {
  id: string;
  status: WithdrawalStatus;
  strategy: 'full' | 'partial';
  customer_name: string;
  investment_code: string;
  plan_name: string;
  available_principal: number;
  withdrawal_amount: number;
  tds_amount: number;
  tds_percent: number;
  net_payout: number;
  bank_name: string | null;
  account_number: string | null;
  requested_on: string;
  updated_at: string;
  agreement_ok: boolean;
};

export type WithdrawalListResult = {
  rows: WithdrawalListRow[];
  total: number;
  limit: number;
  offset: number;
};

export type WithdrawalDecision = InvestmentDecision;

export type TdsFilingRow = {
  investment_id: string;
  customer_name: string;
  investment_code: string;
  principal: number;
  gross_interest: number;
  tds_percent: number;
  tds_amount: number;
  quarter: number;
  period: string;
};

export type TdsQuarterSlice = {
  quarter: number;
  label: string;
  amount: number;
  isCurrent: boolean;
};

export type TdsDashboardData = {
  kpis: {
    totalTds: number;
    currentMonthTds: number;
    currentFyTds: number;
    fyLabel: string;
    fyShort: string;
  };
  rows: TdsFilingRow[];
  quarters: TdsQuarterSlice[];
};

export type ReferralPayoutStatus = 'Pending' | 'Paid';

export type ReferralListRow = {
  id: string;
  status: ReferralPayoutStatus;
  referrer_user_id: string;
  referred_user_id: string;
  referrer_name: string;
  referred_name: string;
  investment_id: string;
  investment_code: string | null;
  referral_code: string;
  capital_amount: number;
  referral_rate: number;
  gross_bonus: number;
  tds_rate: number;
  tds_amount: number;
  net_bonus: number;
  lifetime_paid_net: number;
  created_at: string;
};

export type ReferralsPageData = {
  settings: {
    referral_rate: number;
    tds_rate: number;
  };
  kpis: {
    totalReferrals: number;
    grossCommission: number;
    tdsAmount: number;
    netCommission: number;
  };
  rows: ReferralListRow[];
  total: number;
  limit: number;
  offset: number;
};

export type ReportKind =
  | 'investment'
  | 'interest'
  | 'withdrawal'
  | 'tds'
  | 'referral'
  | 'wealth'
  | 'upcoming_payout'
  | 'payout_range'
  | 'bulk';

export type ReportFormat = 'xlsx' | 'csv' | 'pdf';

export type ReportDatePreset = 'last_7' | 'last_30' | 'last_90' | 'this_fy' | 'inception';

export type ReportSheet = {
  name: string;
  rows: Record<string, unknown>[];
};

export type BuiltReport = {
  name: string;
  type: string;
  sheets: ReportSheet[];
};

export type GeneratedReportRow = {
  id: string;
  report_name: string;
  report_type: string;
  date_range_label: string;
  generated_by: string;
  generated_date: string;
  format: ReportFormat;
  created_at: string;
};

export type NotificationKind = 'investment' | 'withdrawal' | 'customer';

export type NotificationFilter = 'all' | 'unread' | NotificationKind;

export type AdminNotification = {
  key: string;
  kind: NotificationKind;
  customer_name: string;
  amount: number | null;
  plan_name: string | null;
  occurred_at: string;
  href: string;
  unread: boolean;
};

export type PortalSettings = {
  platform_name: string;
  support_email: string;
  support_phone: string;
  default_currency: string;
  min_investment_amount: number;
  max_investment_amount: number;
  gateway_provider: string;
  merchant_id: string;
  api_key: string;
  api_secret: string;
  max_single_transaction: number;
  daily_transfer_limit: number;
  updated_at: string | null;
};


