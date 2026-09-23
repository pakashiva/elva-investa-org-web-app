const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];

const TENS = [
  '',
  '',
  'Twenty',
  'Thirty',
  'Forty',
  'Fifty',
  'Sixty',
  'Seventy',
  'Eighty',
  'Ninety',
];

function twoDigits(value: number): string {
  if (value < 20) {
    return ONES[value];
  }
  const tens = TENS[Math.floor(value / 10)];
  const ones = ONES[value % 10];
  return ones ? `${tens} ${ones}` : tens;
}

/**
 * Indian-system words used inside "(Rupees ... only)" on the agreement,
 * e.g. 500000 -> "Five Lakhs", 725000 -> "Seven Lakhs Twenty Five Thousand".
 */
export function amountToIndianWords(amount: number): string {
  const rupees = Math.round(Math.abs(amount));
  if (rupees === 0) {
    return 'Zero';
  }

  const crore = Math.floor(rupees / 10000000);
  const lakh = Math.floor((rupees % 10000000) / 100000);
  const thousand = Math.floor((rupees % 100000) / 1000);
  const hundred = Math.floor((rupees % 1000) / 100);
  const rest = rupees % 100;

  const groups: string[] = [];
  if (crore) groups.push(`${twoDigits(crore)} ${crore === 1 ? 'Crore' : 'Crores'}`);
  if (lakh) groups.push(`${twoDigits(lakh)} ${lakh === 1 ? 'Lakh' : 'Lakhs'}`);
  if (thousand) groups.push(`${twoDigits(thousand)} Thousand`);
  if (hundred) groups.push(`${ONES[hundred]} Hundred`);
  if (rest) groups.push(twoDigits(rest));

  return groups.join(' ');
}
