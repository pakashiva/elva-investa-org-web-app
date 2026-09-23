import { useCallback, useEffect, useState } from 'react';
import { getClientSettings, type ClientSettingsView } from '../services/settingsService';

export function usePortalSettings() {
  const [settings, setSettings] = useState<ClientSettingsView | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setSettings(await getClientSettings());
    } catch (err) {
      setSettings(null);
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { settings, isLoading, error, reload: load };
}
