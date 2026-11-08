import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createCatalog } from '../src/anilibria';
import { normalizeYummy } from '../src/yummy';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/yummy-devochka.json', import.meta.url), 'utf8'));

describe('normalizeYummy', () => {
  it('разбирает «Девочку из Чужеземья»: серии по номеру, озвучки только из Kodik', () => {
    const r = normalizeYummy(fixture);
    expect(r.alias).toBe('yummy:devochka-iz-chuzhezemya-ova-2022');
    expect(r.title).toBe('Девочка из Чужеземья (2022)');
    expect(r.poster).toMatch(/^https:\/\/static\.yani\.tv\/posters\//);
    expect(r.episodes.map((e) => e.id)).toEqual(['1', '2', '3']);
    const [first, second] = r.episodes;
    expect(first!.hls).toEqual({});
    expect(first!.duration).toBeGreaterThan(4000);
    const names = first!.dubs!.map((d) => d.name);
    // Alloha, CVH и VK снаружи не управляются — их нет
    expect(names).not.toContain('Озвучка AniStar');
    expect(names).not.toContain('Дубляж Рабочая партия');
    expect(names).toContain('Озвучка SHIZA Project');
    expect(new Set(names).size).toBe(names.length);
    for (const d of first!.dubs!) expect(d.url).toMatch(/^https:\/\/kodikplayer\.com\//);
    // самая смотрибельная по всему тайтлу — первой
    expect(names[0]).toBe('Субтитры Crunchyroll');
    expect(second!.dubs!.map((d) => d.name)).toEqual(['Субтитры Crunchyroll']);
  });

  it('без видео в Kodik — серий нет', () => {
    const raw = structuredClone(fixture);
    raw.response.videos = raw.response.videos.filter(
      (v: { iframe_url: string }) => !/kodik/.test(v.iframe_url),
    );
    expect(normalizeYummy(raw).episodes).toEqual([]);
  });
});

describe('каталог: YummyAnime', () => {
  it('«yummy:<slug>» идёт в api.yani.tv, 404 → not_found', async () => {
    const fetch = vi.fn(async (url: string | URL | Request) =>
      String(url).includes('devochka')
        ? new Response(JSON.stringify(fixture), { status: 200 })
        : new Response('{}', { status: 404 }),
    );
    const c = createCatalog({ fetch: fetch as typeof globalThis.fetch });
    const r = await c.get('yummy:devochka-iz-chuzhezemya-ova-2022');
    expect(r.alias).toBe('yummy:devochka-iz-chuzhezemya-ova-2022');
    expect(String(fetch.mock.calls[0]![0])).toBe(
      'https://api.yani.tv/anime/devochka-iz-chuzhezemya-ova-2022?need_videos=true',
    );
    await expect(c.get('yummy:nope')).rejects.toMatchObject({ code: 'not_found' });
  });
});
