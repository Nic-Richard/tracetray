import { useCallback, useEffect, useState, type DependencyList } from "react";

export function useLoad<T>(load: () => Promise<T>, deps: DependencyList) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError("");
    setLoading(true);
    load().then(value => { if (!cancelled) setData(value); })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : "Check your connection and try again."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [...deps, revision]);
  return { data, setData, error, loading, reload };
}
