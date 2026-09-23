const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

export function formatInr(amount: number, fractionDigits = 0): string {
  return `₹${Number(amount).toLocaleString('en-IN', {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  })}`;
}

export function formatCompactInr(amount: number): string {
  const value = Number(amount) || 0;
  const abs = Math.abs(value);

  if (abs >= 10_000_000) {
    return `₹${(value / 10_000_000).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} Cr`;
  }

  if (abs >= 100_000) {
    return `₹${(value / 100_000).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} L`;
  }

  return formatInr(value);
}

export function toCrores(amount: number): number {
  return Number(((Number(amount) || 0) / 10_000_000).toFixed(2));
}

export function toLakhs(amount: number): number {
  return Number(((Number(amount) || 0) / 100_000).toFixed(2));
}

export function formatSignedCount(count: number): string {
  const value = Number(count) || 0;
  return value >= 0 ? `+${value}` : String(value);
}

export function formatDate(iso: string): string {
  if (!iso) {
    return '—';
  }

  const dateOnly = iso.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
    const [year, month, day] = dateOnly.split('-').map(Number);
    if (!year || !month || !day) {
      return '—';
    }
    return `${String(day).padStart(2, '0')} ${MONTHS[month - 1]} ${year}`;
  }

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  const day = String(date.getDate()).padStart(2, '0');
  return `${day} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export function formatRelativeTime(iso: string): string {
  if (!iso) {
    return '—';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return formatDate(iso);
  }

  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) {
    return 'Just now';
  }
  if (diffMin < 60) {
    return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
  }

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) {
    return `${diffHr} hour${diffHr === 1 ? '' : 's'} ago`;
  }

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfThatDay = new Date(date);
  startOfThatDay.setHours(0, 0, 0, 0);
  const dayDiff = Math.round((startOfToday.getTime() - startOfThatDay.getTime()) / 86400000);
  if (dayDiff === 1) {
    return 'Yesterday';
  }

  const now = new Date();
  if (date.getFullYear() === now.getFullYear()) {
    const day = String(date.getDate()).padStart(2, '0');
    return `${day} ${MONTHS[date.getMonth()]}`;
  }

  return formatDayMonth(iso);
}

export function formatDayMonth(iso: string): string {
  if (!iso) {
    return '—';
  }
  const formatted = formatDate(iso);
  if (formatted === '—') {
    return '—';
  }
  const parts = formatted.split(' ');
  return parts.length >= 2 ? `${parts[0]} ${parts[1]}` : formatted;
}

export function formatAddress(parts: {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pin_code?: string | null;
}): string {
  return [parts.address, parts.city, parts.state, parts.pin_code]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(', ') || '—';
}

export function formatLedgerType(type: string): string {
  switch (type) {
    case 'instant_credit':
      return 'Investment';
    case 'referral_bonus':
      return 'Payout';
    case 'withdrawal':
      return 'Withdrawal';
    default:
      return type;
  }
}

export function formatSignedInr(type: string, amount: number): {
  display: string;
  tone: 'credit' | 'debit';
} {
  const formatted = formatInr(Math.abs(amount));
  if (type === 'withdrawal') {
    return { display: `-${formatted}`, tone: 'debit' };
  }
  return { display: `+${formatted}`, tone: 'credit' };
}

export function formatMobile(mobile: string | null | undefined): string {
  const digits = String(mobile ?? '').replace(/\D/g, '');
  const local = digits.startsWith('91') && digits.length >= 12 ? digits.slice(2) : digits;

  if (local.length === 10) {
    return `+91 ${local.slice(0, 5)} ${local.slice(5)}`;
  }

  return String(mobile ?? '').trim() || '—';
}

export function maskPan(pan: string | null | undefined): string {
  const value = pan?.trim().toUpperCase() ?? '';
  if (!value) {
    return '—';
  }
  if (value.length <= 4) {
    return '*'.repeat(Math.max(value.length, 1));
  }
  return `${'*'.repeat(Math.max(value.length - 4, 5))}${value.slice(-4)}`;
}

export function displayCustomerId(customerId: string | null | undefined): string {
  const value = customerId?.trim();
  return value ? value : '—';
}

export function displayRequestId(requestId: string | null | undefined): string {
  const value = requestId?.trim();
  return value ? value : '—';
}

export function requestStatusLabel(status: string): 'Pending' | 'Under Review' | 'Approved' | 'Rejected' {
  if (status === 'Under Review') return 'Under Review';
  if (status === 'Rejected') return 'Rejected';
  if (status === 'Active' || status === 'Closed' || status === 'Approved') return 'Approved';
  return 'Pending';
}

export function withdrawalStatusLabel(
  status: string
): 'Pending' | 'On Hold' | 'Approved' | 'Rejected' {
  if (status === 'On Hold') return 'On Hold';
  if (status === 'Rejected') return 'Rejected';
  if (status === 'Approved' || status === 'Paid') return 'Approved';
  return 'Pending';
}

export function formatTimeIst(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  }).format(date);
}

export function maskBankAccount(bankName: string | null, accountNumber: string | null): string {
  const bank = bankName?.trim() || 'Bank';
  if (!accountNumber) {
    return bank;
  }
  return `${bank} •••• ${last4Account(accountNumber)}`;
}

export function formatPercent(rate: number): string {
  const percent = Number(rate) * 100;
  return `${percent.toFixed(2)}%`;
}

export function formatTdsRate(rate: number): string {
  const percent = Math.round(Number(rate) * 10000) / 100;
  return Number.isInteger(percent) ? `${percent}%` : `${percent.toFixed(2)}%`;
}

export function last4Account(accountNumber: string | null | undefined): string {
  const digits = String(accountNumber ?? '').replace(/\D/g, '');
  return digits.slice(-4) || '****';
}

export function adminRoleLabel(role: string): string {
  if (role === 'super_admin') {
    return 'SUPER ADMIN';
  }
  if (role === 'client_admin') {
    return 'CLIENT ADMIN';
  }
  return 'OPS ADMIN';
}

export function firstName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0] ?? 'Admin';
  }
  const lastInitial = parts[parts.length - 1]?.charAt(0);
  return lastInitial ? `${parts[0]} ${lastInitial}.` : parts[0] ?? 'Admin';
}

export function parseRpcError(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String((error as { message: string }).message);
    const lower = message.toLowerCase();
    if (lower.includes('not authorized')) {
      return 'This account is not authorized for the Admin Portal.';
    }
    // PostgREST: missing RPC in API schema cache / not created yet
    if (
      (lower.includes('could not find the function') || lower.includes('rpc')) &&
      (lower.includes('does not exist') || lower.includes('not found'))
    ) {
      return 'Required admin database functions are missing. Run the latest files in supabase/migrations/ in the Supabase SQL Editor.';
    }
    if (
      lower.includes('function public.admin_') &&
      lower.includes('does not exist')
    ) {
      return 'Required admin database functions are missing. Run the latest files in supabase/migrations/ in the Supabase SQL Editor.';
    }
    return message;
  }
  return 'Something went wrong. Please try again.';
}
