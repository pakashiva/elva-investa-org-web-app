import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  listNotifications,
  notificationBody,
  notificationTitle,
  notifyNotificationsChanged,
} from '../services/notificationService';
import type { AdminNotification } from '../types/admin';

const TOAST_SECONDS = 5;
const TOAST_MS = TOAST_SECONDS * 1000;
const POLL_MS = 2_000;
const RECENT_MS = 3 * 60_000;

type ToastItem = {
  id: string;
  title: string;
  body: string;
  href: string;
  kind: AdminNotification['kind'];
};

function isRecent(occurredAt: string, withinMs: number): boolean {
  const ts = Date.parse(occurredAt);
  if (!Number.isFinite(ts)) {
    return false;
  }
  return Date.now() - ts <= withinMs;
}

export function NotificationToastHost() {
  const navigate = useNavigate();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seenKeysRef = useRef<Set<string>>(new Set());
  const primedRef = useRef(false);
  const timersRef = useRef<Map<string, number>>(new Map());

  function dismiss(id: string) {
    const timer = timersRef.current.get(id);
    if (timer != null) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }

  function pushToast(row: AdminNotification) {
    const id = row.key;
    if (!id) {
      return;
    }

    setToasts((prev) => {
      if (prev.some((item) => item.id === id)) {
        return prev;
      }
      return [
        {
          id,
          title: notificationTitle(row),
          body: notificationBody(row),
          href: row.href || '/notifications',
          kind: row.kind,
        },
        ...prev,
      ].slice(0, 4);
    });

    const existing = timersRef.current.get(id);
    if (existing != null) {
      window.clearTimeout(existing);
    }
    timersRef.current.set(
      id,
      window.setTimeout(() => dismiss(id), TOAST_MS)
    );
  }

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;

    async function poll() {
      if (cancelled || inFlight) {
        return;
      }
      inFlight = true;
      try {
        const { rows } = await listNotifications({
          filter: 'all',
          kind: 'all',
          search: '',
          from: null,
          to: null,
        });
        if (cancelled) {
          return;
        }

        if (!primedRef.current) {
          for (const row of rows) {
            if (row.key) {
              seenKeysRef.current.add(row.key);
            }
          }
          primedRef.current = true;

          const recentUnread = rows
            .filter((row) => row.key && row.unread && isRecent(row.occurred_at, RECENT_MS))
            .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at));

          // Show the newest recent unread immediately (e.g. just came from mobile).
          if (recentUnread[0]) {
            pushToast(recentUnread[0]);
          }
          notifyNotificationsChanged();
          return;
        }

        const fresh = rows
          .filter((row) => row.key && !seenKeysRef.current.has(row.key))
          .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at));

        if (fresh.length === 0) {
          return;
        }

        for (const row of fresh) {
          seenKeysRef.current.add(row.key);
          pushToast(row);
        }
        notifyNotificationsChanged();
      } catch (err) {
        console.warn('[notifications] toast poll failed', err);
      } finally {
        inFlight = false;
      }
    }

    void poll();
    const interval = window.setInterval(() => void poll(), POLL_MS);

    function onVisible() {
      if (document.visibilityState === 'visible') {
        void poll();
      }
    }

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, []);

  if (toasts.length === 0 || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div className="notification-toast-host" aria-live="assertive">
      {toasts.map((toast) => (
        <div key={toast.id} className={`notification-toast kind-${toast.kind}`} role="alert">
          <span className="notification-toast-icon">
            <Bell size={16} />
          </span>
          <button
            type="button"
            className="notification-toast-body"
            onClick={() => {
              dismiss(toast.id);
              navigate(toast.href);
            }}
          >
            <strong>{toast.title}</strong>
            <em>{toast.body}</em>
          </button>
          <button
            type="button"
            className="notification-toast-close"
            aria-label="Dismiss"
            onClick={() => dismiss(toast.id)}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>,
    document.body
  );
}
