import { z } from 'zod';
import { isYummy, QUALITIES, YUMMY_PREFIX, type Episode, type Release } from '@wtgt/shared';
import { normalizeYummy, yummyUrl } from './yummy';

export const ANILIBRIA_ORIGIN = 'https://anilibria.top';

export class CatalogError extends Error {
  constructor(
    readonly code: 'not_found' | 'unavailable',
    message: string,
  ) {
    super(message);
  }
}

const url = z.string().url().nullish();
const rawRelease = z.object({
  alias: z.string(),
  name: z.object({ main: z.string().nullish(), english: z.string().nullish() }),
  poster: z
    .object({ src: z.string().nullish(), optimized: z.object({ src: z.string().nullish() }).nullish() })
    .nullish(),
  episodes: z.array(
    z.object({
      id: z.string(),
      ordinal: z.number(),
      name: z.string().nullish(),
      duration: z.number().nullish(),
      sort_order: z.number().nullish(),
      hls_480: url,
      hls_720: url,
      hls_1080: url,
    }),
  ),
});

/** Ответ API AniLibria → модель клиента (design D3). Весь разбор формата AniLibria — только здесь. */
export function normalizeRelease(raw: unknown): Release {
  const r = rawRelease.parse(raw);
  const poster = r.poster?.optimized?.src ?? r.poster?.src ?? null;
  const episodes: Episode[] = [...r.episodes]
    .sort((a, b) => (a.sort_order ?? a.ordinal) - (b.sort_order ?? b.ordinal) || a.ordinal - b.ordinal)
    .map((e) => {
      const hls: Episode['hls'] = {};
      for (const q of QUALITIES) {
        const src = e[`hls_${q}`];
        if (src) hls[q] = src;
      }
      return { id: e.id, ordinal: e.ordinal, name: e.name || null, duration: e.duration ?? 0, hls };
    });
  return {
    alias: r.alias,
    title: r.name.main || r.name.english || r.alias,
    poster: poster ? new URL(poster, ANILIBRIA_ORIGIN).href : null,
    episodes,
  };
}

/** fresh — мимо кэша: ссылки на видео могли устареть (design D7). */
export type Catalog = { get(alias: string, opts?: { fresh?: boolean }): Promise<Release> };

type Options = { fetch?: typeof fetch; ttlMs?: number; timeoutMs?: number };

/** Откуда брать релиз: «yummy:<slug>» — YummyAnime, остальное — AniLibria. */
function source(alias: string) {
  if (isYummy(alias)) {
    return { name: 'YummyAnime', url: yummyUrl(alias.slice(YUMMY_PREFIX.length)), normalize: normalizeYummy };
  }
  return {
    name: 'AniLibria',
    url: `${ANILIBRIA_ORIGIN}/api/v1/anime/releases/${encodeURIComponent(alias)}`,
    normalize: normalizeRelease,
  };
}

/** Релизы из API с кэшем в памяти; одновременные запросы одного алиаса склеиваются. */
export function createCatalog({
  fetch: doFetch = fetch,
  ttlMs = 10 * 60_000,
  timeoutMs = 10_000,
}: Options = {}): Catalog {
  const cache = new Map<string, { at: number; value: Release }>();
  const inflight = new Map<string, Promise<Release>>();

  async function load(alias: string): Promise<Release> {
    const src = source(alias);
    let res: Response;
    try {
      res = await doFetch(src.url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new CatalogError('unavailable', `${src.name} не отвечает`);
    }
    if (res.status === 404) throw new CatalogError('not_found', 'Релиз не найден');
    if (!res.ok) throw new CatalogError('unavailable', `${src.name} не отвечает`);
    try {
      return src.normalize(await res.json());
    } catch {
      throw new CatalogError('unavailable', `${src.name} вернула непонятный ответ`);
    }
  }

  return {
    get(alias, { fresh = false } = {}) {
      const hit = cache.get(alias);
      if (!fresh && hit && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.value);
      let p = inflight.get(alias);
      if (!p) {
        p = load(alias)
          .then((value) => {
            cache.set(alias, { at: Date.now(), value });
            return value;
          })
          .finally(() => inflight.delete(alias));
        inflight.set(alias, p);
      }
      return p;
    },
  };
}
