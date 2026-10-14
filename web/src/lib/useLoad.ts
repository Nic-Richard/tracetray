import { useCallback, useEffect, useState, type DependencyList } from "react";

export interface Loaded<T> {
  data: T | null;
  error: string;
  loading: boolean;
  reload: () => void;
}

/** Runs a request when its inputs change and drops answers that arrive after newer requests. */
export function useLoad<T>(load: () => Promise<T> | null, deps: DependencyList): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [count, setCount] = useState(0);
  const reload = useCallback(() => setCount(n => n + 1), []);

  useEffect(() => {
    const request = load();
    if (!request) { setData(null); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError("");
    request
      .then(result => { if (!cancelled) { setData(result); setLoading(false); } })
      .catch(err => { if (!cancelled) { setError(err?.message || "something went wrong"); setLoading(false); } });
    return () => { cancelled = true; };
  }, [...deps, count]);

  return { data, error, loading, reload };
}
