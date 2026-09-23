import { useCallback, useEffect, useState } from 'react';
import { getTdsDashboard } from '../services/tdsService';
import type { TdsDashboardData } from '../types/admin';

export function useTdsDashboard() {
  const [data, setData] = useState<TdsDashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setData(await getTdsDashboard());
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : 'Failed to load TDS dashboard');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, isLoading, error, reload: load };
}
