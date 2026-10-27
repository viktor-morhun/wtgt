import { describe, expect, it } from 'vitest';
import { parseAlias } from '../src';

describe('parseAlias', () => {
  it.each([
    ['https://anilibria.tv/release/tokyo-revengers.html', 'tokyo-revengers'],
    ['anilibria.tv/release/tokyo-revengers.html', 'tokyo-revengers'],
    ['https://aniliberty.top/anime/releases/release/tokyo-revengers', 'tokyo-revengers'],
    ['https://aniliberty.top/anime/releases/release/tokyo-revengers/episodes', 'tokyo-revengers'],
    ['https://anilibria.top/anime/releases/release/chainsaw-man/episodes?x=1', 'chainsaw-man'],
    ['  Tokyo-Revengers ', 'tokyo-revengers'],
  ])('%s → %s', (input, alias) => expect(parseAlias(input)).toBe(alias));

  it.each(['', 'https://example.com/release/foo.html', 'https://anilibria.tv/', 'привет мир', 'a b'])(
    'мусор «%s» → null',
    (input) => expect(parseAlias(input)).toBeNull(),
  );
});
