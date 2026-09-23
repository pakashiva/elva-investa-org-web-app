export type AgreementOfficeForm = {
  id: string;
  placeName: string;
  address: string;
  phone: string;
  email: string;
  noticeDays: string;
};

export type AgreementPartyForm = {
  name: string;
  offices: AgreementOfficeForm[];
  nomineeName: string;
  nomineeAadhaar: string;
  nomineePan: string;
  nomineeRelation: string;
  nomineePhone: string;
};

export function emptyOffice(): AgreementOfficeForm {
  return {
    id: crypto.randomUUID(),
    placeName: '',
    address: '',
    phone: '',
    email: '',
    noticeDays: '30',
  };
}

export const EMPTY_AGREEMENT_PARTY: AgreementPartyForm = {
  name: '',
  offices: [emptyOffice()],
  nomineeName: '',
  nomineeAadhaar: '',
  nomineePan: '',
  nomineeRelation: '',
  nomineePhone: '',
};

export const AGREEMENT_NOMINEE_RELATIONS = [
  'Spouse',
  'Father',
  'Mother',
  'Son',
  'Daughter',
  'Brother',
  'Sister',
  'Other',
];

export const MAX_AGREEMENT_OFFICES = 8;

export type AgreementOfficeErrors = Partial<
  Record<'placeName' | 'address' | 'phone' | 'email' | 'noticeDays', string>
>;

export type AgreementPartyErrors = {
  name?: string;
  offices?: string;
  nomineeName?: string;
  nomineeAadhaar?: string;
  nomineePan?: string;
  nomineeRelation?: string;
  nomineePhone?: string;
  officeErrors?: AgreementOfficeErrors[];
};

function asOffice(raw: unknown): AgreementOfficeForm {
  const row = (raw ?? {}) as Record<string, unknown>;
  const text = (value: unknown) => String(value ?? '');
  const notice = text(row.noticeDays ?? row.notice_days);
  return {
    id: text(row.id) || crypto.randomUUID(),
    placeName: text(row.placeName ?? row.place_name),
    address: text(row.address),
    phone: text(row.phone),
    email: text(row.email),
    noticeDays: notice || '30',
  };
}

export function partyPayload(party: AgreementPartyForm): AgreementPartyForm {
  return {
    name: party.name.trim(),
    offices: party.offices.map((office) => ({
      id: office.id || crypto.randomUUID(),
      placeName: office.placeName.trim(),
      address: office.address.trim(),
      phone: office.phone.replace(/\D/g, '').slice(-10),
      email: office.email.trim().toLowerCase(),
      noticeDays: String(Number(office.noticeDays.replace(/\D/g, '')) || ''),
    })),
    nomineeName: party.nomineeName.trim(),
    nomineeAadhaar: party.nomineeAadhaar.replace(/\D/g, ''),
    nomineePan: party.nomineePan.trim().toUpperCase(),
    nomineeRelation: party.nomineeRelation.trim(),
    nomineePhone: party.nomineePhone.replace(/\D/g, '').slice(-10),
  };
}

export function asAgreementPartyForm(raw: unknown): AgreementPartyForm {
  const row = (raw ?? {}) as Record<string, unknown>;
  const text = (value: unknown) => String(value ?? '');
  const officesRaw = Array.isArray(row.offices) ? row.offices : [];
  const offices = officesRaw.map(asOffice);
  if (offices.length === 0 && text(row.ballariAddress)) {
    offices.push({
      id: crypto.randomUUID(),
      placeName: 'Ballari',
      address: text(row.ballariAddress),
      phone: text(row.ballariPhone),
      email: text(row.ballariEmail),
      noticeDays: '30',
    });
    if (text(row.raichurAddress)) {
      offices.push({
        id: crypto.randomUUID(),
        placeName: 'Raichur',
        address: text(row.raichurAddress),
        phone: text(row.raichurPhone),
        email: text(row.raichurEmail),
        noticeDays: '60',
      });
    }
  }
  return {
    name: text(row.name),
    offices: offices.length > 0 ? offices : [emptyOffice()],
    nomineeName: text(row.nomineeName),
    nomineeAadhaar: text(row.nomineeAadhaar),
    nomineePan: text(row.nomineePan),
    nomineeRelation: text(row.nomineeRelation),
    nomineePhone: text(row.nomineePhone),
  };
}

export function validateAgreementPartyForm(party: AgreementPartyForm): AgreementPartyErrors {
  const errors: AgreementPartyErrors = {};
  if (!party.name.trim()) errors.name = 'Legal name as it should appear on the agreement is required.';
  if (party.offices.length === 0) errors.offices = 'Add at least one office.';
  const officeErrors: AgreementOfficeErrors[] = party.offices.map(() => ({}));
  const seen = new Set<string>();
  party.offices.forEach((office, index) => {
    const slot = officeErrors[index];
    if (!office.placeName.trim()) slot.placeName = 'City or place name is required.';
    const key = office.placeName.trim().toLowerCase();
    if (key && seen.has(key)) slot.placeName = 'This place is already listed.';
    if (key) seen.add(key);
    if (!office.address.trim()) slot.address = 'Office address is required.';
    if (!/^[6-9]\d{9}$/.test(office.phone.replace(/\D/g, ''))) {
      slot.phone = 'Enter a 10-digit mobile number.';
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(office.email.trim())) {
      slot.email = 'Enter a valid email.';
    }
    const notice = Number(office.noticeDays.replace(/\D/g, ''));
    if (!Number.isInteger(notice) || notice < 1 || notice > 365) {
      slot.noticeDays = 'Enter notice days between 1 and 365.';
    }
  });
  if (officeErrors.some((slot) => Object.keys(slot).length > 0)) {
    errors.officeErrors = officeErrors;
  }
  if (!party.nomineeName.trim()) errors.nomineeName = 'Nominee name is required.';
  if (!/^\d{12}$/.test(party.nomineeAadhaar.replace(/\D/g, ''))) {
    errors.nomineeAadhaar = 'Aadhaar must be 12 digits.';
  }
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(party.nomineePan.trim().toUpperCase())) {
    errors.nomineePan = 'Enter a valid PAN.';
  }
  if (!party.nomineeRelation.trim()) errors.nomineeRelation = 'Relationship is required.';
  if (!/^[6-9]\d{9}$/.test(party.nomineePhone.replace(/\D/g, ''))) {
    errors.nomineePhone = 'Enter a 10-digit mobile number.';
  }
  return errors;
}
