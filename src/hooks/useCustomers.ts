import { useCallback, useEffect, useState } from 'react';
import { listCustomers } from '../services/customerService';
import type {
  CustomerFilter,
  CustomerListResult,
  CustomerSort,
} from '../types/admin';

const PAGE_SIZE = 10;

export function useCustomers() {
  const [filter, setFilter] = useState<CustomerFilter>('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<CustomerSort>('joined_desc');
  const [joinFrom, setJoinFrom] = useState<string | null>(null);
  const [joinTo, setJoinTo] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<CustomerListResult | null>(null);
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
      const data = await listCustomers({
        filter,
        search,
        joinFrom,
        joinTo,
        sort,
        page,
        pageSize: PAGE_SIZE,
      });
      setResult(data);
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : 'Failed to load customers');
    } finally {
      setIsLoading(false);
    }
  }, [filter, search, joinFrom, joinTo, sort, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const changeFilter = (next: CustomerFilter) => {
    setFilter(next);
    setPage(1);
  };

  const changeSort = (next: CustomerSort) => {
    setSort(next);
    setPage(1);
  };

  const changeJoinRange = (from: string | null, to: string | null) => {
    setJoinFrom(from);
    setJoinTo(to);
    setPage(1);
  };

  const pageCount = result ? Math.max(1, Math.ceil(result.total / PAGE_SIZE)) : 1;

  return {
    filter,
    searchInput,
    setSearchInput,
    sort,
    joinFrom,
    joinTo,
    page,
    pageSize: PAGE_SIZE,
    pageCount,
    result,
    isLoading,
    error,
    changeFilter,
    changeSort,
    changeJoinRange,
    setPage,
    reload: load,
  };
}
