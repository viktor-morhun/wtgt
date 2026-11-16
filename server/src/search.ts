import { z } from 'zod';
import { YUMMY_PREFIX, type Genre, type HomeFeed, type Shelf, type TitleCard } from '@wtgt/shared';
import { ANILIBRIA_ORIGIN, CatalogError } from './anilibria';
import { YUMMY_API } from './yummy';

/** Поиск тайтлов и «новое» — для главной и выбора тайтла в комнате. */
export type Finder = {
  search(query: string): Promise<TitleCard[]>;
  latest(): Promise<TitleCard[]>;
  /** случайный тайтл AniLibria, у которого уже есть серии */
  random(): Promise<TitleCard>;
  /** главная: баннер, подборки AniLibria и жанры */
  home(): Promise<HomeFeed>;
  /** тайтлы жанра, лучшие первыми */
  genre(id: number, page: number): Promise<{ cards: TitleCard[]; more: boolean }>;
};

/** Столько результатов берём у каждого источника. */
const PER_SOURCE = 12;
const LATEST = 18;
/** Столько случайных берём за раз: анонсы без серий отсеиваются. */
const RANDOM_BATCH = 10;
/** Столько тайтлов в подборке на главной и на странице жанра. */
const SHELF = 18;
const GENRE_PAGE = 30;
/** Столько новинок листает баннер. */
const BANNER = 5;
const DESCRIPTION_MAX = 400;

const rawLibria = z.object({
  alias: z.string(),
  year: z.number().nullish(),
  name: z.object({ main: z.string().nullish(), english: z.string().nullish() }),
  type: z.object({ description: z.string().nullish() }).nullish(),
  episodes_total: z.number().nullish(),
  poster: z
    .object({
      src: z.string().nullish(),
      optimized: z.object({ src: z.string().nullish(), preview: z.string().nullish() }).nullish(),
    })
    .nullish(),
  description: z.string().nullish(),
  genres: z.array(z.object({ name: z.string() })).nullish(),
});

const rawYummy = z.object({
  anime_url: z.string(),
  title: z.string(),
  year: z.number().nullish(),
  type: z.object({ shortname: z.string().nullish(), name: z.string().nullish() }).nullish(),
  poster: z.record(z.string(), z.string().nullish()).nullish(),
});

/** Один и тот же тайтл в разных источниках: название без регистра, ё и знаков, плюс год (если известен). */
export const sameTitle = (c: Pick<TitleCard, 'title' | 'year'>) =>
  c.title
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim() + (c.year ? `|${c.year}` : '');

/** Карточки по одной: битая запись не роняет весь ответ. */
const each = <T>(schema: z.ZodType<T>, list: unknown): T[] =>
  (Array.isArray(list) ? list : []).flatMap((x) => {
    const r = schema.safeParse(x);
    return r.success ? [r.data] : [];
  });

export function libriaCards(raw: unknown): TitleCard[] {
  return each(rawLibria, raw).map((r) => {
    const poster = r.poster?.optimized?.preview ?? r.poster?.optimized?.src ?? r.poster?.src ?? null;
    return {
      alias: r.alias,
      title: r.name.main || r.name.english || r.alias,
      poster: poster ? new URL(poster, ANILIBRIA_ORIGIN).href : null,
      year: r.year || null,
      kind: r.type?.description ?? null,
      episodes: r.episodes_total || null,
      source: 'AniLibria',
      ...(r.description ? { description: r.description.trim().slice(0, DESCRIPTION_MAX) } : {}),
      ...(r.genres?.length ? { genres: r.genres.map((g) => g.name) } : {}),
    };
  });
}

/** Расписание AniLibria на сегодня: тайтл и номер серии, которая выйдет. */
export function scheduleCards(raw: unknown): TitleCard[] {
  const today = (raw as { today?: unknown } | null)?.today;
  const items = each(
    z.object({ release: z.unknown(), next_release_episode_number: z.number().nullish() }),
    today,
  );
  return items.flatMap((x) => {
    const [card] = libriaCards([x.release]);
    if (!card) return [];
    return [x.next_release_episode_number ? { ...card, next: x.next_release_episode_number } : card];
  });
}

const rawGenre = z.object({ id: z.number(), name: z.string() });

export function yummyCards(raw: unknown): TitleCard[] {
  const list = (raw as { response?: unknown } | null)?.response;
  return each(rawYummy, list).map((r) => {
    const poster = r.poster?.medium ?? r.poster?.small ?? r.poster?.big ?? null;
    return {
      alias: YUMMY_PREFIX + r.anime_url,
      title: r.title,
      poster: poster ? (poster.startsWith('//') ? `https:${poster}` : poster) : null,
      year: r.year || null,
      kind: r.type?.shortname ?? r.type?.name ?? null,
      episodes: null,
      source: 'YummyAnime',
    };
  });
}

type Options = {
  fetch?: typeof fetch;
  ttlMs?: number;
  timeoutMs?: number;
  maxEntries?: number;
  /** столько живёт в кэше ответ, где один из источников не ответил */
  partialTtlMs?: number;
};

/** Ответы обоих источников с кэшем в памяти; один источник лёг — отдаём второй. */
export function createFinder({
  fetch: doFetch = fetch,
  ttlMs = 10 * 60_000,
  timeoutMs = 8_000,
  maxEntries = 300,
  partialTtlMs = 30_000,
}: Options = {}): Finder {
  const cache = new Map<string, { at: number; value: Promise<unknown> }>();

  async function json(url: string): Promise<unknown> {
    const res = await doFetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  }

  function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value as Promise<T>;
    const value = load();
    cache.set(key, { at: Date.now(), value });
    // неудачный ответ не кэшируем
    value.catch(() => cache.get(key)?.value === value && cache.delete(key));
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value!);
    return value;
  }

  /** Каталог AniLibria с фильтрами: f[sorting], f[types], f[genres], f[publish_statuses]. */
  const catalogUrl = (filters: Record<string, string>, limit = SHELF, page = 1) => {
    const q = new URLSearchParams({ limit: String(limit), page: String(page), ...filters });
    return `${ANILIBRIA_ORIGIN}/api/v1/anime/catalog/releases?${q}`;
  };
  const catalog = async (filters: Record<string, string>) =>
    libriaCards(((await json(catalogUrl(filters))) as { data?: unknown } | null)?.data);

  /** Убрать ответ из кэша через ms (если его не успели заменить). */
  function forget(key: string, ms: number): void {
    const hit = cache.get(key);
    const timer = setTimeout(() => cache.get(key) === hit && cache.delete(key), ms);
    timer.unref?.();
  }

  return {
    search(query) {
      const q = query.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 100);
      if (q.length < 2) return Promise.resolve([]);
      return cached(`s:${q}`, async () => {
        const [libria, yummy] = await Promise.allSettled([
          json(`${ANILIBRIA_ORIGIN}/api/v1/app/search/releases?query=${encodeURIComponent(q)}`).then(
            libriaCards,
          ),
          json(`${YUMMY_API}/search?q=${encodeURIComponent(q)}&limit=${PER_SOURCE}`).then(yummyCards),
        ]);
        if (libria.status === 'rejected' && yummy.status === 'rejected') {
          throw new CatalogError('unavailable', 'Поиск не отвечает');
        }
        const ok = (r: PromiseSettledResult<TitleCard[]>) =>
          r.status === 'fulfilled' ? r.value.slice(0, PER_SOURCE) : [];
        // AniLibria — первыми: у неё своё видео и наша панель управления;
        // тайтлы, которые есть на AniLibria, из YummyAnime не показываем
        // один источник не ответил — такой ответ ненадолго: следующий поиск спросит оба заново
        if (libria.status === 'rejected' || yummy.status === 'rejected') forget(`s:${q}`, partialTtlMs);
        const first = ok(libria);
        const seen = new Set(first.map(sameTitle));
        return [...first, ...ok(yummy).filter((c) => !seen.has(sameTitle(c)))];
      });
    },
    async random() {
      let cards: TitleCard[];
      try {
        cards = libriaCards(
          await json(`${ANILIBRIA_ORIGIN}/api/v1/anime/releases/random?limit=${RANDOM_BATCH}`),
        );
      } catch {
        throw new CatalogError('unavailable', 'AniLibria не отвечает');
      }
      const card = cards.find((c) => c.episodes);
      if (!card) throw new CatalogError('unavailable', 'Не повезло — попробуй ещё раз');
      return card;
    },
    home() {
      return cached('home', async (): Promise<HomeFeed> => {
        // каждая подборка сама по себе: не ответила одна — остальные на месте, а ответ ненадолго
        let partial = false;
        const shelf = async (
          key: string,
          title: string,
          load: () => Promise<TitleCard[]>,
        ): Promise<Shelf> => ({
          key,
          title,
          cards: await load().catch(() => ((partial = true), [])),
        });
        const [today, fresh, ongoing, top, movies, genres] = await Promise.all([
          shelf('today', 'Сегодня выходят', async () =>
            scheduleCards(await json(`${ANILIBRIA_ORIGIN}/api/v1/anime/schedule/now`)),
          ),
          shelf('fresh', 'Новые серии', async () =>
            libriaCards(await json(`${ANILIBRIA_ORIGIN}/api/v1/anime/releases/latest?limit=${SHELF}`)),
          ),
          shelf('ongoing', 'Онгоинги', () => catalog({ 'f[publish_statuses]': 'IS_ONGOING' })),
          shelf('top', 'Лучшее', () => catalog({ 'f[sorting]': 'RATING_DESC' })),
          shelf('movies', 'Фильмы', () => catalog({ 'f[types]': 'MOVIE', 'f[sorting]': 'RATING_DESC' })),
          json(`${ANILIBRIA_ORIGIN}/api/v1/anime/catalog/references/genres`)
            .then((raw) => each(rawGenre, raw))
            .catch((): Genre[] => []),
        ]);
        const shelves = [today, fresh, ongoing, top, movies].filter((x) => x.cards.length);
        if (!shelves.length) throw new CatalogError('unavailable', 'AniLibria не отвечает');
        if (partial) forget('home', partialTtlMs);
        // баннер — новинки с описанием
        const banner = fresh.cards.filter((c) => c.description && c.poster).slice(0, BANNER);
        return { banner, shelves, genres: genres.map(({ id, name }) => ({ id, name })) };
      });
    },
    genre(id, page) {
      return cached(`g:${id}:${page}`, async () => {
        try {
          const raw = (await json(
            catalogUrl({ 'f[genres]': String(id), 'f[sorting]': 'RATING_DESC' }, GENRE_PAGE, page),
          )) as { data?: unknown; meta?: { pagination?: { total_pages?: number } } };
          return { cards: libriaCards(raw.data), more: page < (raw.meta?.pagination?.total_pages ?? 0) };
        } catch {
          throw new CatalogError('unavailable', 'AniLibria не отвечает');
        }
      });
    },
    latest() {
      return cached('latest', async () => {
        try {
          return libriaCards(await json(`${ANILIBRIA_ORIGIN}/api/v1/anime/releases/latest?limit=${LATEST}`));
        } catch {
          throw new CatalogError('unavailable', 'AniLibria не отвечает');
        }
      });
    },
  };
}
