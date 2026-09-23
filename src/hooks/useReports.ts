import { useCallback, useEffect, useState } from 'react';
import { listGeneratedReports } from '../services/reportService';
import type { GeneratedReportRow } from '../types/admin';

export function useGeneratedReports() {
  const [rows, setRows] = useState<GeneratedReportRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setRows(await listGeneratedReports());
    } catch (err) {
      setRows([]);
      setError(err instanceof Error ? err.message : 'Failed to load reports');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { rows, isLoading, error, reload: load };
}
