import { api } from '../lib/api';
import type { AdminNotification, NotificationFilter, NotificationKind } from '../types/admin';
import { formatInr } from '../utils/format';

function asKind(value: unknown): NotificationKind {
  if (value === 'withdrawal' || value === 'customer') {
    return value;
  }
  return 'investment';
}

function mapRow(row: Record<string, unknown>): AdminNotification {
  const amount = row.amount == null ? null : Number(row.amount);
  return {
    key: String(row.key ?? ''),
    kind: asKind(row.kind),
    customer_name: String(row.customer_name ?? 'Customer'),
    amount: Number.isFinite(amount) ? amount : null,
    plan_name: row.plan_name ? String(row.plan_name) : null,
    occurred_at: String(row.occurred_at ?? ''),
    href: String(row.href ?? '/'),
    unread: Boolean(row.unread),
  };
}

export function notificationTitle(row: AdminNotification): string {
  if (row.kind === 'investment') {
    return `New investment request from ${row.customer_name} - ${formatInr(row.amount ?? 0)} in ${row.plan_name || 'New Fund Request'}`;
  }
  if (row.kind === 'withdrawal') {
    return `Withdrawal request from ${row.customer_name} - ${formatInr(row.amount ?? 0)}`;
  }
  return `New customer registered: ${row.customer_name}`;
}

export function notificationBody(row: AdminNotification): string {
  if (row.kind === 'investment') {
    return 'Review and approve the request to proceed with allocation.';
  }
  if (row.kind === 'withdrawal') {
    return 'Awaiting approval for payout to the linked bank account.';
  }
  return 'Profile created. Review customer details if needed.';
}

export async function listNotifications(params: {
  filter: NotificationFilter;
  kind: 'all' | NotificationKind;
  search: string;
  from: string | null;
  to: string | null;
}): Promise<{ rows: AdminNotification[]; unreadCount: number }> {
  const query = new URLSearchParams();
  query.set('filter', params.filter);
  query.set('kind', params.kind);
  if (params.search.trim()) query.set('q', params.search.trim());
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  const payload = await api<{ rows: Record<string, unknown>[]; unreadCount: number }>(
    `/api/client-portal/notifications?${query.toString()}`
  );
  return {
    rows: Array.isArray(payload.rows) ? payload.rows.map(mapRow) : [],
    unreadCount: Number(payload.unreadCount ?? 0) || 0,
  };
}

export async function setNotificationRead(key: string, read: boolean): Promise<void> {
  await api('/api/client-portal/notifications/read', {
    method: 'POST',
    body: JSON.stringify({ key, read }),
  });
}

export async function markAllNotificationsRead(): Promise<void> {
  await api('/api/client-portal/notifications/read-all', { method: 'POST' });
}

export async function getUnreadNotificationCount(): Promise<number> {
  const payload = await api<{ unreadCount: number }>('/api/client-portal/notifications/unread-count');
  return Number(payload.unreadCount ?? 0) || 0;
}

export function notifyNotificationsChanged() {
  window.dispatchEvent(new Event('admin-notifications-changed'));
}
