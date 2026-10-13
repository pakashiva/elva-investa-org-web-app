import { api } from '../lib/api';
import type { ClientModule, CustomerType } from '../types/borrowing';

export type PublicClientSummary = {
  name: string;
  clientCode: string;
  enabledModules: ClientModule[];
  requiredBorrowerDocuments: string[];
};

export type PublicCustomerRecord = {
  id: string;
  fullName: string;
  mobileNumber: string;
  emailAddress: string;
  customerCode: string;
  referralCode: string;
  clientId: string;
  clientName: string;
  clientCode: string;
};

export async function lookupPublicClient(code: string) {
  const trimmed = code.trim().toUpperCase();
  const data = await api<{ client: PublicClientSummary }>(
    `/api/mobile/auth/client/${encodeURIComponent(trimmed)}`
  );
  return data.client;
}

export type PublicCustomerRegisterInput = {
  clientCode: string;
  customerType: CustomerType;
  referredByCode?: string;
  fullName: string;
  email: string;
  mobile: string;
  dateOfBirth: string;
  address: string;
  city?: string;
  state?: string;
  pinCode?: string;
  aadhaarNumber: string;
  panNumber: string;
  accountHolderName: string;
  accountNumber: string;
  ifscCode: string;
  bankName: string;
  accountType: 'Savings' | 'Current';
  nomineeName: string;
  nomineeRelationship: string;
  nomineeAadhaar: string;
  nomineePan: string;
  nomineeMobile: string;
  password: string;
};

export async function registerPublicCustomer(input: PublicCustomerRegisterInput) {
  const data = await api<{ customer: PublicCustomerRecord }>(
    '/api/mobile/auth/register',
    {
      method: 'POST',
      body: JSON.stringify({
        ...input,
        authorized: true,
      }),
    }
  );
  return data.customer;
}
