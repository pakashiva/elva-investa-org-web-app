import { api } from '../lib/api';
import { asAgreementPartyForm, type AgreementPartyForm } from '../agreementParty';

export type ClientSettingsView = {
  clientName: string;
  clientCode: string;
  supportEmail: string;
  supportPhone: string;
  defaultCurrency: string;
  minInvestmentAmount: number;
  maxInvestmentAmount: number;
  agreementCharges: number;
  defaultInterestRate: number;
  defaultTdsPercent: number;
  defaultPayoutDay: number;
  referralRate: number;
  referralTdsRate: number;
  updatedAt: string | null;
  agreementParty: AgreementPartyForm;
};

function mapSettings(raw: Record<string, unknown>): ClientSettingsView {
  return {
    clientName: String(raw.clientName ?? ''),
    clientCode: String(raw.clientCode ?? ''),
    supportEmail: String(raw.supportEmail ?? ''),
    supportPhone: String(raw.supportPhone ?? ''),
    defaultCurrency: String(raw.defaultCurrency ?? 'INR'),
    minInvestmentAmount: Number(raw.minInvestmentAmount ?? 0),
    maxInvestmentAmount: Number(raw.maxInvestmentAmount ?? 0),
    agreementCharges: Number(raw.agreementCharges ?? 0),
    defaultInterestRate: Number(raw.defaultInterestRate ?? 0),
    defaultTdsPercent: Number(raw.defaultTdsPercent ?? 0),
    defaultPayoutDay: Number(raw.defaultPayoutDay ?? 10),
    referralRate: Number(raw.referralRate ?? 0),
    referralTdsRate: Number(raw.referralTdsRate ?? 0),
    updatedAt: raw.updatedAt ? String(raw.updatedAt) : null,
    agreementParty: asAgreementPartyForm(raw.agreementParty),
  };
}

export async function getClientSettings() {
  const data = await api<{ settings: Record<string, unknown> }>('/api/client-portal/settings');
  return mapSettings(data.settings ?? {});
}

export async function saveClientSupport(input: { supportEmail: string; supportPhone: string }) {
  const data = await api<{ settings: Record<string, unknown> }>('/api/client-portal/settings', {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return mapSettings(data.settings ?? {});
}

export async function saveClientAgreementParty(agreementParty: AgreementPartyForm) {
  const data = await api<{ settings: Record<string, unknown> }>('/api/client-portal/settings', {
    method: 'PATCH',
    body: JSON.stringify({ agreementParty }),
  });
  return mapSettings(data.settings ?? {});
}
