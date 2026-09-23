import { useCallback, useEffect, useState } from 'react';
import { listWithdrawals } from '../services/withdrawalService';
import type { WithdrawalFilter, WithdrawalListResult } from '../types/admin';

const PAGE_SIZE = 10;

export function useWithdrawals() {
  const [filter, setFilter] = useState<WithdrawalFilter>('pending');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<WithdrawalListResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await listWithdrawals({
        filter,
        search,
        page,
        pageSize: PAGE_SIZE,
      });
      setResult(data);
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : 'Failed to load withdrawals');
    } finally {
      setIsLoading(false);
    }
  }, [filter, search, page]);

  useEffect(() => {
    void load();
  }, [load]);

  return {
    filter,
    searchInput,
    setSearchInput,
    page,
    pageSize: PAGE_SIZE,
    pageCount: result ? Math.max(1, Math.ceil(result.total / PAGE_SIZE)) : 1,
    result,
    isLoading,
    error,
    changeFilter: (next: WithdrawalFilter) => {
      setFilter(next);
      setPage(1);
    },
    setPage,
    reload: load,
  };
}
