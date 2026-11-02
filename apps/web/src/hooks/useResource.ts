import { useEffect, useState } from "react";
import { api } from "../lib/api";

export function useResource<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    api<T>(path).then((value) => {
      if (active) { setData(value); setLoading(false); }
    }).catch((cause) => {
      if (active) { setError(cause instanceof Error ? cause.message : "Request failed."); setLoading(false); }
    });
    return () => { active = false; };
  }, [path, revision]);
  return { data, loading, error, refresh: () => setRevision((value) => value + 1) };
}
