export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function text(value: unknown) {
  return String(value ?? '').trim();
}

export function asNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

export function money(value: unknown) {
  const parsed = asNumber(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
}

export function formatInr(amount: number) {
  return `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

export function isUuid(value: string) {
  return UUID_RE.test(value);
}

export function customerPasswordError(password: string): string | null {
  if (!password.trim()) {
    return 'Password is required.';
  }
  if (password.length < 8) {
    return 'Password must be at least 8 characters.';
  }
  if (!/[A-Z]/.test(password)) {
    return 'Password must contain at least 1 uppercase letter.';
  }
  if (!/[0-9]/.test(password)) {
    return 'Password must contain at least 1 number.';
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return 'Password must contain at least 1 special character.';
  }
  return null;
}

export const EMAIL_MOBILE_COMBO_ERROR =
  'An account with this email and mobile number already exists with this trader. Use a different email or mobile, or sign in.';

export function isEmailMobileComboDuplicate(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  const message = String((error as { message?: string }).message ?? '');
  if (code !== '23505') {
    return false;
  }
  return (
    message.includes('customers_email_mobile_combo_idx') ||
    message.includes('customers_mobile_unique_idx') ||
    message.includes('customers_email_lower_idx')
  );
}
