import { useState, type ReactNode } from 'react';
import { isYummy, parseAlias, type TitleCard } from '@wtgt/shared';
import { Icon } from '../icons';
import { useLatest, useSearch } from '../titles';

/** «2021 · ТВ · 24 эп. · AniLibria» */
export const cardMeta = (c: TitleCard) =>
  [c.year, c.kind, c.episodes ? `${c.episodes} эп.` : null, c.source].filter(Boolean).join(' · ');

/** Похоже на ссылку или алиас с приставкой, а не на название. */
const looksLikeLink = (s: string) => /[./:]/.test(s.trim());

/**
 * Поиск тайтла по названию в AniLibria и YummyAnime или по ссылке на релиз.
 * Пока поле пустое, вместо результатов — children (на главной — вкладки, в комнате — «новое»).
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
  const link = looksLikeLink(query) ? parseAlias(query) : null;
  const search = useSearch(looksLikeLink(query) ? '' : query);
  const typing = query.trim().length > 0;

  return (
    <div className="picker">
      <form
        className="search-field picker-field"
        onSubmit={(e) => {
          e.preventDefault();
          const first = link ?? search.cards?.[0]?.alias;
          if (first) onPick(first);
        }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Найти аниме или вставить ссылку"
          aria-label="Название аниме или ссылка на AniLibria или YummyAnime"
          enterKeyHint="search"
          autoFocus={autoFocus}
        />
        {typing && (
          <button
            type="button"
            className="search-clear rp"
            onClick={() => setQuery('')}
            aria-label="Очистить"
          >
            {Icon.close}
          </button>
        )}
      </form>
      {error && <div className="release-error">{error}</div>}
      {!typing ? (
        children
      ) : looksLikeLink(query) ? (
        link ? (
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
        )
      ) : query.trim().length < 2 ? null : search.cards ? (
        search.cards.length ? (
          <TitleList cards={search.cards} onPick={onPick} pending={pending} />
        ) : (
          <div className="empty hint">Ничего не нашлось</div>
        )
      ) : (
        <div className="empty hint">{search.error ?? <span className="spinner" />}</div>
      )}
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

/** «Новое на AniLibria» списком — в комнате, пока тайтл не выбран. */
export function LatestList({ onPick, pending }: { onPick(alias: string): void; pending?: string | null }) {
  const latest = useLatest();
  return (
    <>
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
