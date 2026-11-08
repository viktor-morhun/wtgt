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
    [
      'https://old.yummyani.me/catalog/item/devochka-iz-chuzhezemya-ova-2022',
      'yummy:devochka-iz-chuzhezemya-ova-2022',
    ],
    ['yummyani.me/catalog/item/magicheskaya-bitva?tab=video', 'yummy:magicheskaya-bitva'],
    ['https://ru.yummyani.me/catalog/item/magicheskaya-bitva/', 'yummy:magicheskaya-bitva'],
    ['yummy:magicheskaya-bitva', 'yummy:magicheskaya-bitva'],
  ])('%s → %s', (input, alias) => expect(parseAlias(input)).toBe(alias));

  it.each([
    '',
    'https://example.com/release/foo.html',
    'https://anilibria.tv/',
    'привет мир',
    'a b',
    'https://yummyani.me/catalog',
    'yummy:',
  ])('мусор «%s» → null', (input) => expect(parseAlias(input)).toBeNull());
});
