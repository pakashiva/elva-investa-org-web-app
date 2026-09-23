import { useCallback, useEffect, useState } from 'react';
import { listNotifications } from '../services/notificationService';
import type { AdminNotification, NotificationFilter, NotificationKind } from '../types/admin';

export function useNotifications() {
  const [filter, setFilter] = useState<NotificationFilter>('all');
  const [kind, setKind] = useState<'all' | NotificationKind>('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [rows, setRows] = useState<AdminNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handle = window.setTimeout(() => setSearch(searchInput), 300);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await listNotifications({ filter, kind, search, from, to });
      setRows(result.rows);
      setUnreadCount(result.unreadCount);
    } catch (err) {
      setRows([]);
      setError(err instanceof Error ? err.message : 'Failed to load notifications');
    } finally {
      setIsLoading(false);
    }
  }, [filter, kind, search, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  return {
    filter,
    kind,
    searchInput,
    setSearchInput,
    from,
    to,
    setRange: (nextFrom: string | null, nextTo: string | null) => {
      setFrom(nextFrom);
      setTo(nextTo);
    },
    rows,
    unreadCount,
    isLoading,
    error,
    changeFilter: (next: NotificationFilter) => {
      setFilter(next);
      if (next === 'investment' || next === 'withdrawal' || next === 'customer') {
        setKind(next);
      }
      if (next === 'all') {
        setKind('all');
      }
    },
    changeKind: (next: 'all' | NotificationKind) => {
      setKind(next);
      if (next !== 'all' && filter !== 'unread') {
        setFilter(next);
      }
      if (next === 'all' && filter !== 'unread') {
        setFilter('all');
      }
    },
    reload: load,
  };
}
