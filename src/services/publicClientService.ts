import { api, setAdminToken } from '../lib/api';
import type { AgreementPartyForm } from '../agreementParty';

export type PublicClientOnboardRecord = {
  name: string;
  clientCode: string;
  adminFullName: string;
  adminUsername: string;
};

export type ClientCodeAvailability = {
  available: boolean;
  clientCode: string;
  name?: string;
};

export async function lookupClientCodeAvailability(code: string) {
  const trimmed = code.trim().toUpperCase();
  return api<ClientCodeAvailability>(`/api/auth/client-code/${encodeURIComponent(trimmed)}`);
}

export async function lookupAdminUsernameAvailability(username: string) {
  const trimmed = username.trim().toLowerCase();
  return api<{ available: boolean; username: string }>(
    `/api/auth/admin-username/${encodeURIComponent(trimmed)}`
  );
}

export type PublicClientRegisterInput = {
  name: string;
  clientCode: string;
  adminFullName: string;
  adminUsername: string;
  adminPassword: string;
  supportEmail?: string;
  supportPhone?: string;
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

export async function registerPublicClient(input: PublicClientRegisterInput) {
  const data = await api<{
    client: PublicClientOnboardRecord;
    token?: string;
  }>('/api/auth/register-client', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (data.token) {
    setAdminToken(data.token);
  }
  return data;
}
