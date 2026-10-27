import { useCallback, useEffect, useState } from 'react';
import type { Release } from '@wtgt/shared';

type ReleaseState = {
  release: Release | null;
  error: string | null;
  loading: boolean;
  /** перезапросить; fresh — мимо кэша сервера (ссылки на видео устарели) */
  reload(fresh?: boolean): void;
};

/** Релиз текущей сессии через сервер (design D3). */
export function useRelease(alias: string | null): ReleaseState {
  const [data, setData] = useState<{ alias: string; release: Release } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState<{ n: number; fresh: boolean }>({ n: 0, fresh: false });

  useEffect(() => {
    if (!alias) return;
    const ctl = new AbortController();
    setError(null);
    fetch(`/api/release/${encodeURIComponent(alias)}${nonce.fresh ? '?fresh=1' : ''}`, { signal: ctl.signal })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.message ?? 'AniLibria не отвечает');
        setData({ alias, release: body as Release });
      })
      .catch((e: Error) => {
        if (!ctl.signal.aborted)
          setError(e.message === 'Failed to fetch' ? 'Нет связи с сервером' : e.message);
      });
    return () => ctl.abort();
  }, [alias, nonce]);

  const reload = useCallback((fresh = false) => setNonce((p) => ({ n: p.n + 1, fresh })), []);
  const release = data && data.alias === alias ? data.release : null;
  return { release, error, loading: !release && !error, reload };
}
