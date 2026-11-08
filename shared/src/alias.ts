const ALIAS = /^[a-z0-9][a-z0-9-]{0,99}$/;

/** Релизы YummyAnime отличаются от алиасов AniLibria приставкой. */
export const YUMMY_PREFIX = 'yummy:';

export const isYummy = (alias: string): boolean => alias.startsWith(YUMMY_PREFIX);

/**
 * Алиас релиза из ссылки или голого алиаса:
 * AniLibria — anilibria.tv/release/<a>.html, aniliberty.top/anime/releases/release/<a>[/episodes], anilibria.top/…;
 * YummyAnime — yummyani.me/catalog/item/<a> (и old./ru.) → «yummy:<a>».
 */
export function parseAlias(input: string): string | null {
  const text = input.trim().toLowerCase();
  if (ALIAS.test(text)) return text;
  if (isYummy(text)) return ALIAS.test(text.slice(YUMMY_PREFIX.length)) ? text : null;

  let url: URL;
  try {
    url = new URL(/^https?:\/\//.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const parts = url.pathname.split('/').filter(Boolean);
  const after = (segment: string) => {
    const i = parts.lastIndexOf(segment);
    return i >= 0 ? parts[i + 1] : undefined;
  };

  if (/(^|\.)(yummyani|yummy-anime|yani)\.[a-z]+$/.test(url.hostname)) {
    const slug = after('item');
    return slug && ALIAS.test(slug) ? YUMMY_PREFIX + slug : null;
  }
  if (!/(^|\.)(anilibria|aniliberty|anilib)\.[a-z]+$/.test(url.hostname)) return null;
  const alias = after('release')?.replace(/\.html?$/, '');
  return alias && ALIAS.test(alias) ? alias : null;
}
