import { text } from './util.ts';

export type AgreementOffice = {
  id: string;
  placeName: string;
  address: string;
  phone: string;
  email: string;
  noticeDays: number;
};

export type AgreementParty = {
  name: string;
  offices: AgreementOffice[];
  nomineeName: string;
  nomineeAadhaar: string;
  nomineePan: string;
  nomineeRelation: string;
  nomineePhone: string;
};

const MAX_OFFICES = 8;

function phone10(value: unknown) {
  const digits = text(value).replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function newOfficeId() {
  return crypto.randomUUID();
}

export function parseOffices(raw: unknown): AgreementOffice[] {
  const source = Array.isArray(raw) ? raw : [];
  const offices: AgreementOffice[] = [];
  for (const item of source) {
    const row = (item ?? {}) as Record<string, unknown>;
    const notice = Number(row.noticeDays ?? row.notice_days);
    offices.push({
      id: text(row.id) || newOfficeId(),
      placeName: text(row.placeName ?? row.place_name),
      address: text(row.address),
      phone: phone10(row.phone),
      email: text(row.email).toLowerCase(),
      noticeDays: Number.isInteger(notice) ? notice : 0,
    });
    if (offices.length >= MAX_OFFICES) break;
  }
  return offices;
}

function officesFromLegacy(nested: Record<string, unknown>, source: Record<string, unknown>): AgreementOffice[] {
  const pick = (camel: string, snake: string) => nested[camel] ?? nested[snake] ?? source[camel] ?? source[snake];
  const offices: AgreementOffice[] = [];
  const ballariAddress = text(pick('ballariAddress', 'secondPartyBallariAddress'));
  if (ballariAddress) {
    offices.push({
      id: newOfficeId(),
      placeName: 'Ballari',
      address: ballariAddress,
      phone: phone10(pick('ballariPhone', 'secondPartyBallariPhone')),
      email: text(pick('ballariEmail', 'secondPartyBallariEmail')).toLowerCase(),
      noticeDays: 30,
    });
  }
  const raichurAddress = text(pick('raichurAddress', 'secondPartyRaichurAddress'));
  if (raichurAddress) {
    offices.push({
      id: newOfficeId(),
      placeName: 'Raichur',
      address: raichurAddress,
      phone: phone10(pick('raichurPhone', 'secondPartyRaichurPhone')),
      email: text(pick('raichurEmail', 'secondPartyRaichurEmail')).toLowerCase(),
      noticeDays: 60,
    });
  }
  return offices;
}

export function parseAgreementParty(body: Record<string, unknown> | null | undefined): AgreementParty {
  const source = body ?? {};
  const nested = (source.agreementParty ?? source.secondParty ?? {}) as Record<string, unknown>;
  const pick = (camel: string, snake: string) => nested[camel] ?? nested[snake] ?? source[camel] ?? source[snake];
  let offices = parseOffices(nested.offices ?? source.offices ?? source.agreementOffices);
  if (offices.length === 0) {
    offices = officesFromLegacy(nested, source);
  }
  return {
    name: text(pick('name', 'secondPartyName')),
    offices,
    nomineeName: text(pick('nomineeName', 'secondPartyNomineeName')),
    nomineeAadhaar: text(pick('nomineeAadhaar', 'secondPartyNomineeAadhaar')).replace(/\D/g, ''),
    nomineePan: text(pick('nomineePan', 'secondPartyNomineePan')).toUpperCase(),
    nomineeRelation: text(pick('nomineeRelation', 'secondPartyNomineeRelation')),
    nomineePhone: phone10(pick('nomineePhone', 'secondPartyNomineePhone')),
  };
}

export function mapAgreementParty(row: Record<string, unknown>): AgreementParty {
  let offices = parseOffices(row.agreement_offices ?? row.agreementOffices ?? row.offices);
  if (offices.length === 0) {
    offices = officesFromLegacy(row, row);
  }
  return {
    name: text(row.second_party_name),
    offices,
    nomineeName: text(row.second_party_nominee_name),
    nomineeAadhaar: text(row.second_party_nominee_aadhaar).replace(/\D/g, ''),
    nomineePan: text(row.second_party_nominee_pan).toUpperCase(),
    nomineeRelation: text(row.second_party_nominee_relation),
    nomineePhone: phone10(row.second_party_nominee_phone),
  };
}

export function validateAgreementParty(party: AgreementParty): string | null {
  if (!party.name) return 'Enter the second party legal name as it should appear on the agreement.';
  if (party.offices.length === 0) {
    return 'Add at least one office. The agreement is executed at that office.';
  }
  const seen = new Set<string>();
  for (const office of party.offices) {
    if (!office.placeName) return 'Enter a city or place name for each office.';
    const key = office.placeName.toLowerCase();
    if (seen.has(key)) return `Office place "${office.placeName}" is listed more than once.`;
    seen.add(key);
    if (!office.address) return `Enter the address for the ${office.placeName} office.`;
    if (!/^[6-9]\d{9}$/.test(office.phone)) {
      return `Enter a 10-digit mobile number for the ${office.placeName} office.`;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(office.email)) {
      return `Enter a valid email for the ${office.placeName} office.`;
    }
    if (!Number.isInteger(office.noticeDays) || office.noticeDays < 1 || office.noticeDays > 365) {
      return `Withdrawal notice for ${office.placeName} must be between 1 and 365 days.`;
    }
  }
  if (!party.nomineeName) return 'Enter the second party nominee name.';
  if (!/^\d{12}$/.test(party.nomineeAadhaar)) {
    return 'Second party nominee Aadhaar must be 12 digits.';
  }
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(party.nomineePan)) {
    return 'Enter a valid PAN for the second party nominee.';
  }
  if (!party.nomineeRelation) return 'Enter the second party nominee relationship.';
  if (!/^[6-9]\d{9}$/.test(party.nomineePhone)) {
    return 'Enter a 10-digit mobile number for the second party nominee.';
  }
  return null;
}

export function isAgreementPartyComplete(party: AgreementParty) {
  return validateAgreementParty(party) === null;
}

function normalizePlace(value: string) {
  const raw = value.trim().toLowerCase();
  if (raw === 'bellari') return 'ballari';
  return raw;
}

export function officeForSelection(
  party: AgreementParty,
  selection: { officeId?: string; placeName?: string }
): AgreementOffice | null {
  if (party.offices.length === 0) return null;
  const byId = selection.officeId
    ? party.offices.find((office) => office.id === selection.officeId)
    : undefined;
  if (byId) return byId;
  const needle = normalizePlace(selection.placeName ?? '');
  if (needle) {
    const byPlace = party.offices.find((office) => normalizePlace(office.placeName) === needle);
    if (byPlace) return byPlace;
  }
  return party.offices[0] ?? null;
}

export const AGREEMENT_PARTY_COLUMNS = `
  s.second_party_name,
  s.agreement_offices,
  s.second_party_nominee_name,
  s.second_party_nominee_aadhaar,
  s.second_party_nominee_pan,
  s.second_party_nominee_relation,
  s.second_party_nominee_phone
`;
