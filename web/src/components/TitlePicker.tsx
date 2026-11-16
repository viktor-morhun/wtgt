import { Fragment, useState, type ReactNode } from 'react';
import { isYummy, parseAlias, type TitleCard } from '@wtgt/shared';
import { Icon } from '../icons';
import { randomTitle, useLatest, useSearch } from '../titles';

/** «2021 · ТВ · 24 эп.» — источник в заголовке группы */
export const cardMeta = (c: TitleCard) =>
  [c.year, c.kind, c.episodes ? `${c.episodes} эп.` : null].filter(Boolean).join(' · ');

/** Источники в порядке приоритета: у AniLibria своё видео и наша панель, YummyAnime — то, чего там нет. */
const SOURCES: TitleCard['source'][] = ['AniLibria', 'YummyAnime'];

/** Похоже на ссылку или алиас с приставкой, а не на название. */
const looksLikeLink = (s: string) => /[./:]/.test(s.trim());

/** Поле поиска: название или ссылка; Enter — первый результат. */
export function PickerField({
  query,
  onQuery,
  onSubmit,
  autoFocus,
}: {
  query: string;
  onQuery(q: string): void;
  onSubmit(): void;
  autoFocus?: boolean;
}) {
  return (
    <form
      className="search-field picker-field"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <input
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder="Найти аниме или вставить ссылку"
        aria-label="Название аниме или ссылка на AniLibria или YummyAnime"
        enterKeyHint="search"
        autoFocus={autoFocus}
      />
      {query.trim() && (
        <button type="button" className="search-clear rp" onClick={() => onQuery('')} aria-label="Очистить">
          {Icon.close}
        </button>
      )}
    </form>
  );
}

/** Поиск по запросу: ссылка → «открыть по ссылке», название → AniLibria, ниже — YummyAnime. */
export function useTitleSearch(query: string) {
  const link = looksLikeLink(query) ? parseAlias(query) : null;
  const search = useSearch(looksLikeLink(query) ? '' : query);
  return { link, search, first: link ?? search.cards?.[0]?.alias ?? null };
}

export function PickerResults({
  query,
  onPick,
  pending,
}: {
  query: string;
  onPick(alias: string): void;
  pending?: string | null;
}) {
  const { link, search } = useTitleSearch(query);
  if (looksLikeLink(query)) {
    return link ? (
      <ul className="list">
        <li className="row">
          <button className="row-tap rp" onClick={() => onPick(link)}>
            <span className="title-poster title-poster-link">{Icon.link}</span>
            <span className="row-main">
              <span className="row-title">Открыть по ссылке</span>
              <span className="row-sub">
                {isYummy(link) ? 'YummyAnime' : 'AniLibria'} · {link}
              </span>
            </span>
            {pending === link && <span className="spinner" />}
          </button>
        </li>
      </ul>
    ) : (
      <div className="empty hint">Это не похоже на ссылку AniLibria или YummyAnime</div>
    );
  }
  if (query.trim().length < 2) return null;
  if (!search.cards) return <div className="empty hint">{search.error ?? <span className="spinner" />}</div>;
  if (!search.cards.length) return <div className="empty hint">Ничего не нашлось</div>;
  return (
    <>
      {SOURCES.map((source) => {
        const cards = search.cards!.filter((c) => c.source === source);
        return cards.length ? (
          <Fragment key={source}>
            <h3 className="picker-head">{source === 'AniLibria' ? 'AniLibria' : 'ещё на YummyAnime'}</h3>
            <TitleList cards={cards} onPick={onPick} pending={pending} />
          </Fragment>
        ) : null;
      })}
    </>
  );
}

/**
 * Поиск тайтла по названию в AniLibria и YummyAnime или по ссылке на релиз.
 * Пока поле пустое, вместо результатов — children (в комнате — «новое»).
 */
export function TitlePicker({
  onPick,
  pending,
  error,
  autoFocus,
  children,
}: {
  onPick(alias: string): void;
  /** алиас, который сейчас открывается, — у его строки крутилка */
  pending?: string | null;
  error?: string | null;
  autoFocus?: boolean;
  children?: ReactNode;
}) {
  const [query, setQuery] = useState('');
  const { first } = useTitleSearch(query);
  return (
    <div className="picker">
      <PickerField
        query={query}
        onQuery={setQuery}
        onSubmit={() => first && onPick(first)}
        autoFocus={autoFocus}
      />
      {error && <div className="release-error">{error}</div>}
      {query.trim() ? <PickerResults query={query} onPick={onPick} pending={pending} /> : children}
    </div>
  );
}

export function TitleList({
  cards,
  onPick,
  pending,
}: {
  cards: TitleCard[];
  onPick(alias: string): void;
  pending?: string | null;
}) {
  return (
    <ul className="list titles">
      {cards.map((c, i) => (
        <li key={c.alias} className="row" style={{ '--i': Math.min(i, 20) } as React.CSSProperties}>
          <button className="row-tap rp" onClick={() => onPick(c.alias)} disabled={!!pending}>
            <Poster src={c.poster} />
            <span className="row-main">
              <span className="row-title">{c.title}</span>
              <span className="row-sub">{cardMeta(c)}</span>
            </span>
            {pending === c.alias && <span className="spinner" />}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** «Новое на AniLibria» списком — в комнате, пока тайтл не выбран; сверху — случайный тайтл. */
export function LatestList({ onPick, pending }: { onPick(alias: string): void; pending?: string | null }) {
  const latest = useLatest();
  const [rolling, setRolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const roll = async () => {
    setRolling(true);
    setError(null);
    try {
      onPick((await randomTitle()).alias);
    } catch (e) {
      setError((e as Error).message);
    }
    setRolling(false);
  };
  return (
    <>
      <ul className="list titles">
        <li className="row">
          <button className="row-tap rp" onClick={() => void roll()} disabled={rolling || !!pending}>
            <span className="title-poster title-poster-link">{Icon.dice}</span>
            <span className="row-main">
              <span className="row-title">Случайное аниме</span>
              <span className="row-sub">{error ?? 'не знаю, что смотреть'}</span>
            </span>
            {rolling && <span className="spinner" />}
          </button>
        </li>
      </ul>
      <h3 className="picker-head">новое на AniLibria</h3>
      {latest.cards ? (
        <TitleList cards={latest.cards} onPick={onPick} pending={pending} />
      ) : (
        <div className="empty hint">{latest.error ?? <span className="spinner" />}</div>
      )}
    </>
  );
}

export function Poster({ src }: { src: string | null }) {
  return src ? (
    <img className="title-poster" src={src} alt="" loading="lazy" />
  ) : (
    <span className="title-poster" />
  );
}
