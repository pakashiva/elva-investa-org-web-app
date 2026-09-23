import type { ReportDatePreset } from '../types/admin';
import { formatDate } from './format';

function isoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function resolveReportRange(preset: ReportDatePreset): {
  from: string;
  to: string;
  label: string;
} {
  const today = new Date();
  const to = isoDate(today);

  if (preset === 'inception') {
    return { from: '2000-01-01', to, label: `Inception - ${formatDate(to)}` };
  }

  if (preset === 'this_fy') {
    const month = today.getMonth();
    const fyStartYear = month >= 3 ? today.getFullYear() : today.getFullYear() - 1;
    const from = `${fyStartYear}-04-01`;
    return { from, to, label: `${formatDate(from)} - ${formatDate(to)}` };
  }

  const days = preset === 'last_7' ? 6 : preset === 'last_90' ? 89 : 29;
  const from = isoDate(addDays(today, -days));
  return { from, to, label: `${formatDate(from)} - ${formatDate(to)}` };
}
