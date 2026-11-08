import { z } from 'zod';
import { YUMMY_PREFIX, type Dub, type Episode, type Release } from '@wtgt/shared';

export const YUMMY_API = 'https://api.yani.tv';

const rawAnime = z.object({
  anime_url: z.string(),
  title: z.string(),
  poster: z.record(z.string(), z.string().nullish()).nullish(),
  videos: z
    .array(
      z.object({
        number: z.union([z.string(), z.number()]).transform(String),
        iframe_url: z.string().nullish(),
        data: z.object({ dubbing: z.string().nullish() }).nullish(),
        views: z.number().nullish(),
        duration: z.number().nullish(),
      }),
    )
    .nullish(),
});

const https = (url: string) => (url.startsWith('//') ? `https:${url}` : url);

/** Плеер Kodik — единственный из плееров YummyAnime, которым можно управлять снаружи (postMessage). */
function kodikUrl(iframe: string | null | undefined): string | null {
  if (!iframe) return null;
  try {
    const url = new URL(https(iframe));
    return /(^|\.)(kodik[a-z]*\.[a-z]+|aniqit\.com)$/.test(url.hostname) ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Ответ api.yani.tv/anime/<slug>?need_videos=true → модель клиента.
 * Серии — по номеру видео; у каждой озвучки в Kodik, самые смотрибельные (по всему тайтлу) первыми.
 */
export function normalizeYummy(raw: unknown): Release {
  const r = z.object({ response: rawAnime }).parse(raw).response;
  const videos = (r.videos ?? []).flatMap((v) => {
    const url = kodikUrl(v.iframe_url);
    const name = v.data?.dubbing?.trim();
    return url && name ? [{ ...v, url, name }] : [];
  });

  const popularity = new Map<string, number>();
  for (const v of videos) popularity.set(v.name, (popularity.get(v.name) ?? 0) + (v.views ?? 0));

  const byNumber = new Map<string, typeof videos>();
  for (const v of videos) byNumber.set(v.number, [...(byNumber.get(v.number) ?? []), v]);

  const episodes: Episode[] = [...byNumber].map(([number, list], i) => {
    const dubs: Dub[] = [];
    for (const v of [...list].sort((a, b) => popularity.get(b.name)! - popularity.get(a.name)!)) {
      if (!dubs.some((d) => d.name === v.name)) dubs.push({ name: v.name, url: v.url });
    }
    const ordinal = Number.parseFloat(number);
    return {
      id: number,
      ordinal: Number.isFinite(ordinal) ? ordinal : i + 1,
      name: null,
      duration: Math.max(0, ...list.map((v) => v.duration ?? 0)),
      hls: {},
      dubs,
    };
  });
  episodes.sort((a, b) => a.ordinal - b.ordinal);

  const poster = r.poster?.big ?? r.poster?.fullsize ?? r.poster?.medium ?? null;
  return {
    alias: YUMMY_PREFIX + r.anime_url,
    title: r.title,
    poster: poster ? https(poster) : null,
    episodes,
  };
}

export const yummyUrl = (slug: string) => `${YUMMY_API}/anime/${encodeURIComponent(slug)}?need_videos=true`;
