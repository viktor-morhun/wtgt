import { describe, expect, it } from 'vitest';
import { createFinder, libriaCards, yummyCards } from '../src/search';

const libria = [
  {
    alias: 'tokyo-revengers',
    year: 2021,
    name: { main: 'Токийские мстители', english: 'Tokyo Revengers' },
    type: { value: 'TV', description: 'ТВ' },
    episodes_total: 24,
    poster: { src: '/p.jpg', optimized: { src: '/p.webp', preview: '/pp.webp' } },
  },
  { broken: true },
];
const yummy = {
  response: [
    {
      anime_url: 'naruto-tv-1',
      title: 'Наруто',
      year: 2002,
      type: { shortname: 'ТВ', name: 'Сериал' },
      poster: { small: '//static.yani.tv/s.webp', medium: '//static.yani.tv/m.webp' },
    },
  ],
};

describe('карточки тайтлов', () => {
  it('AniLibria: алиас, название, постер с адресом сайта; битые записи пропускаются', () => {
    expect(libriaCards(libria)).toEqual([
      {
        alias: 'tokyo-revengers',
        title: 'Токийские мстители',
        poster: 'https://anilibria.top/pp.webp',
        year: 2021,
        kind: 'ТВ',
        episodes: 24,
        source: 'AniLibria',
      },
    ]);
  });

  it('YummyAnime: алиас с приставкой, постер по https', () => {
    expect(yummyCards(yummy)).toEqual([
      {
        alias: 'yummy:naruto-tv-1',
        title: 'Наруто',
        poster: 'https://static.yani.tv/m.webp',
        year: 2002,
        kind: 'ТВ',
        episodes: null,
        source: 'YummyAnime',
      },
    ]);
  });

  it('поиск: AniLibria первой; один источник лёг — второй всё равно отвечает; ответ кэшируется', async () => {
    let calls = 0;
    const fetch = (async (url: string) => {
      calls++;
      if (url.includes('anilibria')) return new Response(JSON.stringify(libria));
      if (url.includes('yani')) return new Response('down', { status: 502 });
      throw new Error(url);
    }) as typeof globalThis.fetch;
    const finder = createFinder({ fetch });
    expect((await finder.search('Мстители')).map((c) => c.alias)).toEqual(['tokyo-revengers']);
    await finder.search('  мстители ');
    expect(calls).toBe(2);
    expect(await finder.search('a')).toEqual([]);
  });

  it('случайный: первый тайтл с сериями, анонсы пропускаются', async () => {
    const announce = { ...libria[0], alias: 'soon', episodes_total: 0 };
    const fetch = (async () =>
      new Response(JSON.stringify([announce, libria[0]]))) as typeof globalThis.fetch;
    expect((await createFinder({ fetch }).random()).alias).toBe('tokyo-revengers');
    const none = (async () => new Response(JSON.stringify([announce]))) as typeof globalThis.fetch;
    await expect(createFinder({ fetch: none }).random()).rejects.toThrow('Не повезло');
  });

  it('поиск: тайтл, который есть на AniLibria, из YummyAnime не показываем; год 0 — неизвестен', async () => {
    const both = {
      response: [
        { anime_url: 'tokijskie-mstiteli', title: 'Токийские Мстители!', year: 2021 },
        { anime_url: 'tokyo-2', title: 'Токийские мстители', year: 2023 },
        { anime_url: 'new', title: 'Токийские мстители: Новое', year: 0 },
      ],
    };
    const fetch = (async (url: string) =>
      new Response(JSON.stringify(url.includes('anilibria') ? libria : both))) as typeof globalThis.fetch;
    const cards = await createFinder({ fetch }).search('мстители');
    expect(cards.map((c) => [c.alias, c.year])).toEqual([
      ['tokyo-revengers', 2021],
      ['yummy:tokyo-2', 2023],
      ['yummy:new', null],
    ]);
  });

  it('поиск: неполный ответ (один источник лёг) кэшируется ненадолго', async () => {
    let libriaUp = false;
    const fetch = (async (url: string) =>
      url.includes('anilibria')
        ? libriaUp
          ? new Response(JSON.stringify(libria))
          : new Response('down', { status: 403 })
        : new Response(JSON.stringify(yummy))) as typeof globalThis.fetch;
    const finder = createFinder({ fetch, partialTtlMs: 20 });
    expect((await finder.search('наруто')).map((c) => c.source)).toEqual(['YummyAnime']);
    libriaUp = true;
    await new Promise((r) => setTimeout(r, 40));
    expect((await finder.search('наруто')).map((c) => c.source)).toEqual(['AniLibria', 'YummyAnime']);
  });

  it('поиск: оба источника легли — ошибка, не кэшируется', async () => {
    let ok = false;
    const fetch = (async (url: string) =>
      ok && url.includes('yani')
        ? new Response(JSON.stringify(yummy))
        : new Response('down', { status: 502 })) as typeof globalThis.fetch;
    const finder = createFinder({ fetch });
    await expect(finder.search('наруто')).rejects.toThrow('Поиск не отвечает');
    ok = true;
    expect((await finder.search('наруто')).map((c) => c.alias)).toEqual(['yummy:naruto-tv-1']);
  });
});
