import { useEffect, useState } from 'react';
import type { TitleCard } from '@wtgt/shared';

/** Поиск ждёт, пока зритель допечатает. */
const DEBOUNCE_MS = 300;

type Result = { cards: TitleCard[] | null; error: string | null; loading: boolean };

const cache = new Map<string, TitleCard[]>();

async function get(url: string): Promise<TitleCard[]> {
  const hit = cache.get(url);
  if (hit) return hit;
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new Error('Нет связи с сервером');
  }
  const body = (await res.json().catch(() => null)) as TitleCard[] | { message?: string } | null;
  if (!res.ok || !Array.isArray(body)) {
    throw new Error((body as { message?: string } | null)?.message ?? 'Поиск не отвечает');
  }
  cache.set(url, body);
  return body;
}

function useCards(url: string | null, delay: number): Result {
  const [state, setState] = useState<{ url: string; cards: TitleCard[] | null; error: string | null }>();
  useEffect(() => {
    if (!url) return;
    let alive = true;
    const timer = setTimeout(
      () =>
        get(url).then(
          (cards) => alive && setState({ url, cards, error: null }),
          (e: Error) => alive && setState({ url, cards: null, error: e.message }),
        ),
      cache.has(url) ? 0 : delay,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [url, delay]);
  const fresh = url && state?.url === url ? state : null;
  return { cards: fresh?.cards ?? null, error: fresh?.error ?? null, loading: !!url && !fresh };
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
