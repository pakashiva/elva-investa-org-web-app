import { useState, type MouseEvent } from 'react';
import { ArrowDownLeft, Calendar, Plus, Search, UserPlus } from 'lucide-react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { ErrorBanner } from '../components/States';
import { useNotifications } from '../hooks/useNotifications';
import type { AdminOutletContext } from '../layouts/AdminLayout';
import {
  markAllNotificationsRead,
  notificationBody,
  notificationTitle,
  notifyNotificationsChanged,
  setNotificationRead,
} from '../services/notificationService';
import type { AdminNotification, NotificationFilter, NotificationKind } from '../types/admin';
import { formatRelativeTime } from '../utils/format';

const FILTERS: { id: NotificationFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'investment', label: 'Investments' },
  { id: 'withdrawal', label: 'Withdrawals' },
  { id: 'customer', label: 'New Customers' },
];

export function NotificationsPage() {
  const { onOpenMenu } = useOutletContext<AdminOutletContext>();
  const navigate = useNavigate();
  const notices = useNotifications();
  const [dateOpen, setDateOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  async function markAll() {
    setSaving(true);
    try {
      await markAllNotificationsRead();
      notifyNotificationsChanged();
      await notices.reload();
    } finally {
      setSaving(false);
    }
  }

  async function toggleRead(row: AdminNotification, event: MouseEvent) {
    event.stopPropagation();
    try {
      await setNotificationRead(row.key, row.unread);
      notifyNotificationsChanged();
      await notices.reload();
    } catch {
      /* reload will show the current server state */
    }
  }

  return (
    <>
      <AppHeader
        title="Notifications"
        subtitle="Alerts, updates, and system notices."
        onOpenMenu={onOpenMenu}
        actions={
          <button type="button" className="ghost-btn" disabled={saving} onClick={() => void markAll()}>
            Mark All as Read
          </button>
        }
      />

      {notices.error ? (
        <ErrorBanner message={notices.error} onRetry={() => void notices.reload()} />
      ) : null}

      <section className="table-shell notice-shell">
        <div className="notice-toolbar">
          <div className="notice-pills">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`notice-pill${notices.filter === item.id ? ' active' : ''}`}
                onClick={() => notices.changeFilter(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="notice-controls">
            <label className="toolbar-search">
              <Search size={16} />
              <input
                value={notices.searchInput}
                onChange={(event) => notices.setSearchInput(event.target.value)}
                placeholder="Search notifications..."
              />
            </label>

            <select
              className="ghost-btn"
              value={notices.kind}
              onChange={(event) =>
                notices.changeKind(event.target.value as 'all' | NotificationKind)
              }
            >
              <option value="all">All types</option>
              <option value="investment">Investments</option>
              <option value="withdrawal">Withdrawals</option>
              <option value="customer">New customers</option>
            </select>

            <div className="date-filter">
              <button type="button" className="ghost-btn" onClick={() => setDateOpen((open) => !open)}>
                <Calendar size={16} />
                Date Range
              </button>
              {dateOpen ? (
                <div className="date-popover">
                  <label>
                    From
                    <input
                      type="date"
                      value={notices.from ?? ''}
                      onChange={(event) => notices.setRange(event.target.value || null, notices.to)}
                    />
                  </label>
                  <label>
                    To
                    <input
                      type="date"
                      value={notices.to ?? ''}
                      onChange={(event) => notices.setRange(notices.from, event.target.value || null)}
                    />
                  </label>
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => {
                      notices.setRange(null, null);
                      setDateOpen(false);
                    }}
                  >
                    Clear dates
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <p className="notice-heading">NOTIFICATIONS</p>

        {notices.isLoading ? (
          <div className="state-box">Loading notifications…</div>
        ) : notices.rows.length === 0 ? (
          <div className="state-box">No notifications in this view.</div>
        ) : (
          <ul className="notice-list">
            {notices.rows.map((row) => (
              <li key={row.key}>
                <button type="button" className="notice-item" onClick={() => navigate(row.href)}>
                  <span className={`notice-icon ${row.kind}`}>
                    {row.kind === 'investment' ? (
                      <Plus size={16} />
                    ) : row.kind === 'withdrawal' ? (
                      <ArrowDownLeft size={16} />
                    ) : (
                      <UserPlus size={16} />
                    )}
                  </span>
                  <span className="notice-copy">
                    <strong>{notificationTitle(row)}</strong>
                    <em>{notificationBody(row)}</em>
                  </span>
                  <span className="notice-meta">
                    <span>{formatRelativeTime(row.occurred_at)}</span>
                    <i
                      className={row.unread ? 'unread' : 'read'}
                      role="presentation"
                      onClick={(event) => void toggleRead(row, event)}
                    />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
