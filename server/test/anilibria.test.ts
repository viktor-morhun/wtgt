import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createCatalog, normalizeRelease } from '../src/anilibria';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/tokyo-revengers.json', import.meta.url), 'utf8'));

describe('normalizeRelease', () => {
  it('разбирает «Токийских мстителей»', () => {
    const r = normalizeRelease(fixture);
    expect(r.alias).toBe('tokyo-revengers');
    expect(r.title).toBe('Токийские мстители');
    expect(r.poster).toMatch(/^https:\/\/anilibria\.top\/storage\/releases\/posters\//);
    expect(r.episodes).toHaveLength(24);
    expect(r.episodes.map((e) => e.ordinal)).toEqual([...Array(24)].map((_, i) => i + 1));
    expect(r.episodes[0]!.duration).toBe(1422);
    expect(Object.keys(r.episodes[0]!.hls).sort()).toEqual(['1080', '480', '720']);
    expect(r.episodes[0]!.hls[720]).toMatch(/\.m3u8/);
  });

  it('серия без ссылок остаётся в списке без hls', () => {
    const raw = structuredClone(fixture);
    raw.episodes[1].hls_480 = raw.episodes[1].hls_720 = raw.episodes[1].hls_1080 = null;
    expect(normalizeRelease(raw).episodes[1]!.hls).toEqual({});
  });
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('createCatalog', () => {
  it('кэширует и склеивает одновременные запросы', async () => {
    const fetch = vi.fn(async () => json(fixture));
    const c = createCatalog({ fetch });
    await Promise.all([c.get('tokyo-revengers'), c.get('tokyo-revengers')]);
    await c.get('tokyo-revengers');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('404 → not_found, сетевая ошибка → unavailable', async () => {
    const notFound = createCatalog({ fetch: async () => new Response('<html>', { status: 404 }) });
    await expect(notFound.get('x')).rejects.toMatchObject({ code: 'not_found' });
    const down = createCatalog({
      fetch: async () => {
        throw new TypeError('fetch failed');
      },
    });
    await expect(down.get('x')).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('таймаут → unavailable', async () => {
    const hang = (_: unknown, init?: RequestInit) =>
      new Promise<Response>((_, reject) =>
        init?.signal?.addEventListener('abort', () => reject(new Error('abort'))),
      );
    const c = createCatalog({ fetch: hang as typeof fetch, timeoutMs: 50 });
    await expect(c.get('x')).rejects.toMatchObject({ code: 'unavailable' });
  });
});
