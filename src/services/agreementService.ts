import { api } from '../lib/api';
import type { AgreementPayload, ChequeFieldPresets } from '../types/admin';
import { amountToIndianWords } from '../utils/amountWords';
import { buildDocx, downloadBlob, escapeDocxText, type DocxPart } from '../utils/docx';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

let cachedTemplate: DocxPart[] | null = null;

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asText(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => asText(item).trim())
    .filter((item) => item.length > 0);
}

function mapPayload(raw: Record<string, unknown>): AgreementPayload {
  const agreement = (raw.agreement ?? {}) as Record<string, unknown>;
  const investment = (raw.investment ?? {}) as Record<string, unknown>;
  const customer = (raw.customer ?? {}) as Record<string, unknown>;
  const bank = raw.bank as Record<string, unknown> | null;
  const nominee = raw.nominee as Record<string, unknown> | null;
  const secondParty = (raw.secondParty ?? raw.second_party ?? {}) as Record<string, unknown>;

  return {
    agreement: {
      id: asText(agreement.id),
      branch: asText(agreement.branch || secondParty.placeName || secondParty.place_name),
      noticeDays: asNumber(agreement.noticeDays ?? agreement.notice_days ?? secondParty.noticeDays ?? secondParty.notice_days),
      agreement_date: asText(agreement.agreement_date),
      period_from: asText(agreement.period_from),
      period_to: asText(agreement.period_to),
      cheque_no: asText(agreement.cheque_no),
      cheque_bank_name: asText(agreement.cheque_bank_name),
      cheque_bank_address: asText(agreement.cheque_bank_address),
      renewal_id: agreement.renewal_id ? asText(agreement.renewal_id) : null,
    },
    investment: {
      id: asText(investment.id),
      code: investment.code ? asText(investment.code) : null,
      plan_name: asText(investment.plan_name),
      fund_amount: asNumber(investment.fund_amount),
      interest_rate: asNumber(investment.interest_rate),
      tds_percent: asNumber(investment.tds_percent),
    },
    customer: {
      customer_id: customer.customer_id ? asText(customer.customer_id) : null,
      full_name: asText(customer.full_name),
      address: asText(customer.address),
      email: asText(customer.email),
      mobile: asText(customer.mobile),
      pan: asText(customer.pan),
      aadhaar: asText(customer.aadhaar),
    },
    bank: bank
      ? {
          holder: asText(bank.holder),
          account_number: asText(bank.account_number),
          ifsc_code: asText(bank.ifsc_code),
          bank_name: asText(bank.bank_name),
          branch_name: asText(bank.branch_name),
        }
      : null,
    nominee: nominee
      ? {
          name: asText(nominee.name),
          relation: asText(nominee.relation),
          aadhaar: asText(nominee.aadhaar),
          pan: asText(nominee.pan),
          mobile: asText(nominee.mobile),
        }
      : null,
    processingFee: asNumber(raw.processingFee ?? raw.processing_fee),
    secondParty: {
      name: asText(secondParty.name),
      address: asText(secondParty.address),
      phone: asText(secondParty.phone),
      email: asText(secondParty.email),
      placeName: asText(secondParty.placeName ?? secondParty.place_name ?? agreement.branch),
      noticeDays: asNumber(secondParty.noticeDays ?? secondParty.notice_days ?? agreement.noticeDays ?? agreement.notice_days),
      nomineeName: asText(secondParty.nomineeName ?? secondParty.nominee_name),
      nomineeAadhaar: asText(secondParty.nomineeAadhaar ?? secondParty.nominee_aadhaar),
      nomineePan: asText(secondParty.nomineePan ?? secondParty.nominee_pan),
      nomineeRelation: asText(secondParty.nomineeRelation ?? secondParty.nominee_relation),
      nomineePhone: asText(secondParty.nomineePhone ?? secondParty.nominee_phone),
    },
  };
}

export async function listChequePresets(): Promise<ChequeFieldPresets> {
  const row = await api<Record<string, unknown>>('/api/client-portal/agreements/cheque-presets');
  return {
    cheque_nos: asStringList(row.cheque_nos),
    bank_names: asStringList(row.bank_names),
    bank_addresses: asStringList(row.bank_addresses),
  };
}

export async function addChequePreset(fieldKind: string, fieldValue: string): Promise<void> {
  await api('/api/client-portal/agreements/cheque-presets', {
    method: 'POST',
    body: JSON.stringify({ fieldKind, fieldValue }),
  });
}

export async function deleteChequePreset(fieldKind: string, fieldValue: string): Promise<void> {
  await api('/api/client-portal/agreements/cheque-presets', {
    method: 'DELETE',
    body: JSON.stringify({ fieldKind, fieldValue }),
  });
}

export async function saveInvestmentAgreement(input: {
  investmentId: string;
  officeId: string;
  chequeNo: string;
  chequeBankName: string;
  chequeBankAddress: string;
  renewalId?: string | null;
}): Promise<AgreementPayload> {
  const data = await api<{ agreement: Record<string, unknown> }>('/api/client-portal/agreements', {
    method: 'POST',
    body: JSON.stringify({
      investmentId: input.investmentId,
      officeId: input.officeId,
      chequeNo: input.chequeNo.trim(),
      chequeBankName: input.chequeBankName.trim(),
      chequeBankAddress: input.chequeBankAddress.trim(),
      renewalId: input.renewalId ?? null,
    }),
  });
  return mapPayload(data.agreement ?? data);
}

export async function getInvestmentAgreement(
  investmentId: string,
  renewalId: string | null = null
): Promise<AgreementPayload | null> {
  const query = new URLSearchParams({ investmentId });
  if (renewalId) query.set('renewalId', renewalId);
  const data = await api<{ agreement: Record<string, unknown> | null }>(
    `/api/client-portal/agreements?${query.toString()}`
  );
  if (!data.agreement) {
    return null;
  }
  return mapPayload(data.agreement);
}

async function loadTemplate(): Promise<DocxPart[]> {
  if (cachedTemplate) {
    return cachedTemplate;
  }

  const response = await fetch('/templates/agreement.json', {
    cache: 'force-cache',
  });
  if (!response.ok) {
    throw new Error(
      `Agreement template could not be loaded (${response.status}). Redeploy the app so /templates/agreement.json is available.`
    );
  }

  const payload = (await response.json()) as { parts?: DocxPart[] };
  if (!Array.isArray(payload.parts) || payload.parts.length === 0) {
    throw new Error('Agreement template file is empty or invalid.');
  }

  cachedTemplate = payload.parts;
  return payload.parts;
}

function parseDate(value: string): Date {
  const raw = String(value ?? '').trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  }
  const dotted = raw.match(/^(\d{2})[./-](\d{2})[./-](\d{4})$/);
  if (dotted) {
    return new Date(Number(dotted[3]), Number(dotted[2]) - 1, Number(dotted[1]));
  }
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  }
  const today = new Date();
  return new Date(today.getFullYear(), today.getMonth(), today.getDate());
}

function ordinalSuffix(day: number): string {
  if (day % 100 >= 11 && day % 100 <= 13) return 'th';
  if (day % 10 === 1) return 'st';
  if (day % 10 === 2) return 'nd';
  if (day % 10 === 3) return 'rd';
  return 'th';
}

function dottedDate(value: string): string {
  const date = parseDate(value);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}.${month}.${date.getFullYear()}`;
}

function dashedDate(value: string): string {
  return dottedDate(value).replace(/\./g, '-');
}

function ratePercent(rate: number): string {
  const percent = Math.round(rate * 1000000) / 10000;
  return `${percent}%`;
}

function groupAadhaar(value: string): string {
  const raw = String(value ?? '');
  const digits = raw.replace(/\D/g, '');
  if (digits.length !== 12) {
    return raw.trim();
  }
  return `${digits.slice(0, 4)} ${digits.slice(4, 8)} ${digits.slice(8)}`;
}

function localMobile(value: string): string {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function buildTokens(payload: AgreementPayload): Record<string, string> {
  const date = parseDate(payload.agreement.agreement_date);
  const day = date.getDate();
  const amount = Math.round(payload.investment.fund_amount);

  return {
    DATE_DAY: String(day).padStart(2, '0'),
    DATE_DAY_SUFFIX: ordinalSuffix(day),
    DATE_MONTH: MONTHS[date.getMonth()] ?? 'January',
    DATE_YEAR: String(date.getFullYear()),
    DATE_DMY: dashedDate(payload.agreement.agreement_date),
    CUSTOMER_NAME: payload.customer.full_name,
    CUSTOMER_ADDRESS: String(payload.customer.address ?? '').trim().replace(/[.,\s]+$/, ''),
    CUSTOMER_AADHAAR: groupAadhaar(payload.customer.aadhaar),
    CUSTOMER_PAN: payload.customer.pan,
    CUSTOMER_EMAIL: payload.customer.email,
    CUSTOMER_PHONE: localMobile(payload.customer.mobile),
    AMOUNT: amount.toLocaleString('en-IN'),
    AMOUNT_WORDS: amountToIndianWords(amount),
    INTEREST_RATE: ratePercent(payload.investment.interest_rate),
    TDS_RATE: ratePercent(payload.investment.tds_percent),
    PERIOD_FROM: dottedDate(payload.agreement.period_from),
    PERIOD_TO: dottedDate(payload.agreement.period_to),
    CHEQUE_NO: payload.agreement.cheque_no,
    CHEQUE_BANK_NAME: payload.agreement.cheque_bank_name,
    CHEQUE_BANK_ADDRESS: String(payload.agreement.cheque_bank_address ?? '')
      .trim()
      .replace(/[.,\s]+$/, ''),
    BANK_HOLDER: payload.bank?.holder || payload.customer.full_name,
    BANK_ACCOUNT: payload.bank?.account_number ?? '',
    BANK_IFSC: payload.bank?.ifsc_code ?? '',
    BANK_NAME: payload.bank?.bank_name ?? '',
    BANK_BRANCH: payload.bank?.branch_name ?? '',
    NOMINEE_NAME: payload.nominee?.name ?? '',
    NOMINEE_AADHAAR: groupAadhaar(payload.nominee?.aadhaar ?? ''),
    NOMINEE_PAN: payload.nominee?.pan ?? '',
    NOMINEE_RELATION: payload.nominee?.relation ?? '',
    NOMINEE_PHONE: localMobile(payload.nominee?.mobile ?? ''),
    SECOND_PARTY_NAME: payload.secondParty.name,
    SECOND_PARTY_ADDRESS: String(payload.secondParty.address ?? '').trim().replace(/[.,\s]+$/, ''),
    SECOND_PARTY_PHONE: localMobile(payload.secondParty.phone),
    SECOND_PARTY_EMAIL: payload.secondParty.email,
    SECOND_PARTY_NOMINEE_NAME: payload.secondParty.nomineeName,
    SECOND_PARTY_NOMINEE_AADHAAR: groupAadhaar(payload.secondParty.nomineeAadhaar),
    SECOND_PARTY_NOMINEE_PAN: payload.secondParty.nomineePan,
    SECOND_PARTY_NOMINEE_RELATION: payload.secondParty.nomineeRelation,
    SECOND_PARTY_NOMINEE_PHONE: localMobile(payload.secondParty.nomineePhone),
    EXECUTION_PLACE: payload.secondParty.placeName || payload.agreement.branch,
    NOTICE_DAYS: String(payload.agreement.noticeDays || payload.secondParty.noticeDays || ''),
    PROCESSING_FEE: Math.round(payload.processingFee).toLocaleString('en-IN'),
  };
}

export function agreementFileName(payload: AgreementPayload): string {
  const name = String(payload.customer.full_name ?? '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const plan = payload.investment.code ?? 'INV';
  const suffix = payload.agreement.renewal_id ? 'Renewal' : 'Agreement';
  return `Loan-${suffix}-${plan}-${name || 'Customer'}.docx`;
}

export async function downloadAgreementDocx(payload: AgreementPayload): Promise<void> {
  if (
    !payload.secondParty.name.trim() ||
    !payload.secondParty.address.trim() ||
    !payload.secondParty.nomineeName.trim()
  ) {
    throw new Error('Complete Second Party details in Settings before generating the agreement.');
  }

  const parts = await loadTemplate();
  const tokens = buildTokens(payload);

  const filled = parts.map((part) => {
    if (part.path !== 'word/document.xml') {
      return part;
    }
    const text = String(part.text ?? '').replace(/\{\{([A-Z_]+)\}\}/g, (match, token: string) =>
      token in tokens ? escapeDocxText(tokens[token]) : match
    );
    return { path: part.path, text };
  });

  downloadBlob(buildDocx(filled), agreementFileName(payload));
}
