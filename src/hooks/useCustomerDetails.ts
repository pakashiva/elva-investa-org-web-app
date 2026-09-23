import { useCallback, useEffect, useState } from 'react';
import { getCustomerDetails } from '../services/customerService';
import type { CustomerDetails } from '../types/admin';

export function useCustomerDetails(userId: string | undefined) {
  const [data, setData] = useState<CustomerDetails | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(userId));
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) {
      setData(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const details = await getCustomerDetails(userId);
      setData(details);
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : 'Failed to load customer');
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, isLoading, error, reload: load };
}
