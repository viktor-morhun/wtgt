import { z } from 'zod';
import { QUALITIES, type Episode, type Release } from '@wtgt/shared';

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

export const isPlayable = (e: Episode): boolean => Object.keys(e.hls).length > 0;

/** fresh — мимо кэша: ссылки на видео могли устареть (design D7). */
export type Catalog = { get(alias: string, opts?: { fresh?: boolean }): Promise<Release> };

type Options = { fetch?: typeof fetch; ttlMs?: number; timeoutMs?: number };

/** Релизы из API с кэшем в памяти; одновременные запросы одного алиаса склеиваются. */
export function createCatalog({
  fetch: doFetch = fetch,
  ttlMs = 10 * 60_000,
  timeoutMs = 10_000,
}: Options = {}): Catalog {
  const cache = new Map<string, { at: number; value: Release }>();
  const inflight = new Map<string, Promise<Release>>();

  async function load(alias: string): Promise<Release> {
    let res: Response;
    try {
      res = await doFetch(`${ANILIBRIA_ORIGIN}/api/v1/anime/releases/${encodeURIComponent(alias)}`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new CatalogError('unavailable', 'AniLibria не отвечает');
    }
    if (res.status === 404) throw new CatalogError('not_found', 'Релиз не найден');
    if (!res.ok) throw new CatalogError('unavailable', 'AniLibria не отвечает');
    try {
      return normalizeRelease(await res.json());
    } catch {
      throw new CatalogError('unavailable', 'AniLibria вернула непонятный ответ');
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
