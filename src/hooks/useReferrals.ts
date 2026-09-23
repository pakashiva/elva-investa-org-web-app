import { useCallback, useEffect, useState } from 'react';
import { listReferrals } from '../services/referralService';
import type { ReferralsPageData } from '../types/admin';

const PAGE_SIZE = 10;

export function useReferrals() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ReferralsPageData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setData(await listReferrals({ page, pageSize: PAGE_SIZE }));
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : 'Failed to load referrals');
    } finally {
      setIsLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  return {
    data,
    isLoading,
    error,
    page,
    pageSize: PAGE_SIZE,
    pageCount: data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1,
    setPage,
    reload: load,
  };
}
