import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getUnreadNotificationCount } from '../services/notificationService';

const POLL_MS = 3_000;

export function useUnreadCount() {
  const { admin } = useAuth();
  const enabled = admin?.role === 'client_admin';
  const [count, setCount] = useState(0);

  const load = useCallback(async () => {
    if (!enabled) {
      setCount(0);
      return;
    }
    try {
      setCount(await getUnreadNotificationCount());
    } catch {
      setCount(0);
    }
  }, [enabled]);

  useEffect(() => {
    void load();
    if (!enabled) {
      return;
    }
    const onChange = () => void load();
    const interval = window.setInterval(() => void load(), POLL_MS);
    window.addEventListener('admin-notifications-changed', onChange);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('admin-notifications-changed', onChange);
    };
  }, [load, enabled]);

  return count;
}
