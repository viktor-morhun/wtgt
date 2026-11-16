import { useEffect, useState } from 'react';
import type { HomeFeed, TitleCard } from '@wtgt/shared';

/** Поиск ждёт, пока зритель допечатает. */
const DEBOUNCE_MS = 300;

type Result = { cards: TitleCard[] | null; error: string | null; loading: boolean };

/** Ответы и запросы в пути по адресу: одинаковые запросы склеиваются, неудачные не запоминаются. */
const cache = new Map<string, Promise<unknown>>();

function get<T>(url: string, valid: (body: unknown) => boolean): Promise<T> {
  const hit = cache.get(url);
  if (hit) return hit as Promise<T>;
  const p = (async () => {
    let res: Response;
    try {
      res = await fetch(url);
    } catch {
      throw new Error('Нет связи с сервером');
    }
    const body = (await res.json().catch(() => null)) as unknown;
    if (!res.ok || !valid(body)) {
      throw new Error((body as { message?: string } | null)?.message ?? 'AniLibria не отвечает');
    }
    return body as T;
  })();
  cache.set(url, p);
  p.catch(() => cache.get(url) === p && cache.delete(url));
  return p;
}

/** JSON с сервера по адресу (null — не запрашивать); ответы помним до перезагрузки страницы. */
function useJson<T>(url: string | null, delay: number, valid: (body: unknown) => boolean) {
  const [state, setState] = useState<{ url: string; data: T | null; error: string | null }>();
  useEffect(() => {
    if (!url) return;
    let alive = true;
    const timer = setTimeout(
      () =>
        get<T>(url, valid).then(
          (data) => alive && setState({ url, data, error: null }),
          (e: Error) => alive && setState({ url, data: null, error: e.message }),
        ),
      cache.has(url) ? 0 : delay,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // valid — чистая функция-проверка, от неё запрос не зависит
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, delay]);
  const fresh = url && state?.url === url ? state : null;
  return { data: fresh?.data ?? null, error: fresh?.error ?? null, loading: !!url && !fresh };
}

function useCards(url: string | null, delay: number): Result {
  const { data, error, loading } = useJson<TitleCard[]>(url, delay, Array.isArray);
  return { cards: data, error, loading };
}

/** Главная: баннер, подборки AniLibria и жанры. */
export const useHome = () =>
  useJson<HomeFeed>('/api/home', 0, (b) => Array.isArray((b as HomeFeed | null)?.shelves));

/** Тайтлы жанра по страницам, лучшие первыми. */
export const useGenre = (id: number | null, page: number) =>
  useJson<{ cards: TitleCard[]; more: boolean }>(id ? `/api/genre/${id}?page=${page}` : null, 0, (b) =>
    Array.isArray((b as { cards?: unknown } | null)?.cards),
  );

/** Сколько серий сейчас у тайтлов (до 20): для метки «+1 серия» в истории. */
export function useEpisodeCounts(aliases: string[]): Record<string, number> {
  const query = aliases
    .slice(0, 20)
    .map((a) => `alias=${encodeURIComponent(a)}`)
    .join('&');
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!query) return;
    const ctl = new AbortController();
    fetch(`/api/counts?${query}`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : {}))
      .then((c: Record<string, number>) => setCounts(c))
      .catch(() => {});
    return () => ctl.abort();
  }, [query]);
  return counts;
}

/** Случайный тайтл AniLibria с сериями — «не знаю, что смотреть». */
export async function randomTitle(): Promise<TitleCard> {
  let res: Response;
  try {
    res = await fetch('/api/random');
  } catch {
    throw new Error('Нет связи с сервером');
  }
  const body = (await res.json().catch(() => null)) as (TitleCard & { message?: string }) | null;
  if (!res.ok || !body?.alias) throw new Error(body?.message ?? 'AniLibria не отвечает');
  return body;
}

/** Тайтлы AniLibria и YummyAnime по названию; короче 2 символов — не ищем. */
export const useSearch = (query: string): Result => {
  const q = query.trim();
  return useCards(q.length >= 2 ? `/api/search?q=${encodeURIComponent(q)}` : null, DEBOUNCE_MS);
};

/** Новые серии на AniLibria. */
export const useLatest = (enabled = true): Result => useCards(enabled ? '/api/latest' : null, 0);
