import type { AgreementPartyForm } from '../agreementParty';

export type AdminRole = 'super_admin' | 'client_admin';

export type AdminMe = {
  id: string;
  user_id: string;
  username: string;
  role: AdminRole;
  fullName: string;
  full_name: string;
  email: string | null;
  clientId: string | null;
  clientName: string | null;
  clientCode: string | null;
};

export type ClientStatus = 'active' | 'inactive';

export type ClientRecord = {
  id: string;
  name: string;
  clientCode: string;
  status: ClientStatus;
  supportEmail: string | null;
  supportPhone: string | null;
  adminFullName: string;
  adminUsername: string;
  minInvestmentAmount: number;
  maxInvestmentAmount: number;
  agreementCharges: number;
  defaultInterestRate: number;
  defaultTdsPercent: number;
  defaultPayoutDay: number;
  referralRate: number;
  referralTdsRate: number;
  createdAt: string;
  customerCount?: number;
  activeInvestments?: number;
  totalInvested?: number;
  pendingInvestments?: number;
  pendingWithdrawals?: number;
};

export type CreateClientInput = {
  name: string;
  clientCode: string;
  status: ClientStatus;
  adminFullName: string;
  adminUsername: string;
  adminPassword: string;
  supportEmail: string;
  supportPhone: string;
  minInvestmentAmount: number;
  maxInvestmentAmount: number;
  agreementCharges: number;
  interestRatePercent: number;
  tdsPercent: number;
  payoutDay: number;
  referralRatePercent: number;
  referralTdsPercent: number;
  agreementParty: AgreementPartyForm;
};

export type PlatformKpis = {
  totalClients: number;
  activeClients: number;
  inactiveClients: number;
  totalCustomers: number;
  totalActiveInvestments: number;
  totalInvestedAmount: number;
  totalWealthManaged: number;
  totalWithdrawals: number;
  interestPaidYtd: number;
  tdsDeductedYtd: number;
  pendingRequests: number;
  pendingInvestments: number;
  pendingWithdrawals: number;
};

export type RecentClient = {
  id: string;
  name: string;
  clientCode: string;
  status: ClientStatus;
  createdAt: string;
  minInvestmentAmount: number;
  maxInvestmentAmount: number;
  adminUsername: string;
  customerCount: number;
  totalInvested: number;
};

export type PlatformDashboard = {
  kpis: PlatformKpis;
  recentClients: RecentClient[];
  wealthSeries: { month: string; label: string; wealth: number }[];
  flowSeries: { month: string; label: string; inflow: number; outflow: number }[];
};

export type ClientDetailKpis = {
  totalCustomers: number;
  activeInvestments: number;
  totalInvested: number;
  totalWealth: number;
  pendingInvestments: number;
  pendingWithdrawals: number;
  paidWithdrawals: number;
};

export type ClientDetailPayload = {
  client: ClientRecord;
  kpis: ClientDetailKpis;
};

export type PlatformInvestmentRow = {
  id: string;
  requestId: string | null;
  code: string;
  customerName: string;
  customerCode: string;
  planName: string;
  fundAmount: number;
  status: string;
  investedDate: string | null;
  createdAt: string;
};

export type PlatformWithdrawalRow = {
  id: string;
  status: string;
  strategy: string;
  customerName: string;
  investmentCode: string;
  planName: string;
  withdrawalAmount: number;
  netPayout: number;
  requestedOn: string;
};

export type PlatformReferralRow = {
  id: string;
  status: string;
  referrerName: string;
  referredName: string;
  investmentCode: string;
  capitalAmount: number;
  netBonus: number;
  createdAt: string;
};

export type ClientPortalDashboard = {
  client: {
    id: string;
    name: string;
    clientCode: string;
    status: ClientStatus;
    supportEmail: string | null;
    supportPhone: string | null;
  };
  settings: {
    minInvestmentAmount: number;
    maxInvestmentAmount: number;
    agreementCharges: number;
    defaultInterestRate: number;
    defaultTdsPercent: number;
    defaultPayoutDay: number;
    referralRate: number;
    referralTdsRate: number;
  };
  kpis: {
    totalCustomers: number;
    activeInvestments: number;
    totalInvested: number;
    pendingRequests: number;
  };
};

export type CustomerStatus = 'active' | 'inactive';

export type CustomerListFilter =
  | 'all'
  | 'active'
  | 'inactive'
  | 'with_investments'
  | 'no_investment';

export type CustomerListItem = {
  id: string;
  customerCode: string;
  fullName: string;
  mobileNumber: string;
  emailAddress: string;
  dateOfBirth: string;
  address: string;
  status: CustomerStatus;
  referralCode: string;
  createdAt: string;
  panNumber?: string | null;
  aadhaarNumber?: string | null;
  activeInvestments?: number;
  pendingInvestments?: number;
  closedInvestments?: number;
  totalInvested?: number;
};

export type CustomerBank = {
  id: string;
  accountHolderName: string;
  accountNumber: string;
  ifscCode: string;
  bankName: string;
  accountType: string;
  isPrimary: boolean;
};

export type CustomerNominee = {
  id: string;
  nomineeName: string;
  relationship: string;
  nomineeAadhaar: string | null;
  nomineePan?: string | null;
  nomineeMobile?: string | null;
};

export type CustomerDetailsPayload = {
  customer: CustomerListItem;
  banks: CustomerBank[];
  nominees: CustomerNominee[];
  summary: {
    totalInvested: number;
    activePlans: number;
    returnsEarned: number;
  };
  investments?: {
    id: string;
    code: string;
    requestId: string | null;
    name: string;
    fundAmount: number;
    status: string;
    investedDate: string | null;
    createdAt: string;
    totalEarnings: number;
    bankAccountId?: string | null;
  }[];
  withdrawals?: {
    id: string;
    status: string;
    strategy: string;
    withdrawalAmount: number;
    netPayout: number;
    investmentCode: string;
    requestedOn: string;
  }[];
  transactions?: {
    id: string;
    transactionCode: string;
    transactionType: string;
    amount: number;
    transactionDate: string;
    investmentPlanId: string;
  }[];
};

export type CreateCustomerInput = {
  fullName: string;
  email: string;
  mobile: string;
  dateOfBirth: string;
  panNumber: string;
  aadhaarNumber: string;
  nomineeName: string;
  nomineeRelationship: string;
  nomineeAadhaar: string;
  nomineePan: string;
  nomineeMobile: string;
  address: string;
  referredByCode?: string;
  accountHolderName: string;
  accountNumber: string;
  ifscCode: string;
  branchName: string;
  accountType: 'Savings' | 'Current';
};
