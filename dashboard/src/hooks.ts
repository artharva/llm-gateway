import { useCallback, useEffect, useRef, useState } from 'react';

interface Polled<T> {
  data: T | undefined;
  error: string | undefined;
  loading: boolean;
  updatedAt: Date | undefined;
  refresh: () => void;
}

/** Fetches now, then every `everyMs`, and again whenever `deps` change. */
export function usePolling<T>(load: () => Promise<T>, everyMs: number, deps: unknown[]): Polled<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date>();
  const loadRef = useRef(load);
  loadRef.current = load;
  const seq = useRef(0);

  const run = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const next = await loadRef.current();
      if (mine !== seq.current) return;
      setData(next);
      setError(undefined);
      setUpdatedAt(new Date());
    } catch (err) {
      if (mine !== seq.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void run();
    const timer = setInterval(() => void run(), everyMs);
    return () => clearInterval(timer);
  }, [run, everyMs, ...deps]);

  return { data, error, loading, updatedAt, refresh: () => void run() };
}
