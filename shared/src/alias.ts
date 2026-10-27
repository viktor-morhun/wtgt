const ALIAS = /^[a-z0-9][a-z0-9-]{0,99}$/;

/**
 * Алиас релиза из ссылки AniLibria или голого алиаса:
 * anilibria.tv/release/<a>.html, aniliberty.top/anime/releases/release/<a>[/episodes], anilibria.top/…
 */
export function parseAlias(input: string): string | null {
  const text = input.trim().toLowerCase();
  if (ALIAS.test(text)) return text;

  let url: URL;
  try {
    url = new URL(/^https?:\/\//.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (!/(^|\.)(anilibria|aniliberty|anilib)\.[a-z]+$/.test(url.hostname)) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  const i = parts.lastIndexOf('release');
  const raw = i >= 0 ? parts[i + 1] : undefined;
  const alias = raw?.replace(/\.html?$/, '');
  return alias && ALIAS.test(alias) ? alias : null;
}
