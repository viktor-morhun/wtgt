import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { formatTime, type Genre, type TitleCard } from '@wtgt/shared';
import { removeRoom, removeTitle, useRooms, useTitles, type RoomEntry, type TitleEntry } from '../history';
import { Icon } from '../icons';
import { createRoom, openRoom, type Start } from '../lobby';
import { navigate, roomPath } from '../route';
import { setSettings, useSettings } from '../settings';
import { randomTitle, useEpisodeCounts, useGenre, useHome } from '../titles';
import { Avatar } from './Avatars';
import { NameSheet } from './NameSheet';
import { PickerField, PickerResults, useTitleSearch } from './TitlePicker';
import { TransferSheet } from './TransferSheet';

const TOAST_MS = 2_500;
/** Баннер листается сам раз в столько. */
const SLIDE_MS = 8_000;
/** Свайп по баннеру длиннее этого — следующий или предыдущий кадр. */
const SWIPE_PX = 40;

const progress = (e: { ordinal: number; position: number; duration: number }) =>
  `Серия ${e.ordinal} · ${formatTime(e.position)}${e.duration > 0 ? ` / ${formatTime(e.duration)}` : ''}`;

/** 1 серия, 2 серии, 5 серий */
const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10;
  const m100 = n % 100;
  const word = m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
  return `${n} ${word}`;
};

const cardSub = (c: TitleCard) =>
  c.next ? `выйдет ${c.next}-я серия` : [c.year, c.kind].filter(Boolean).join(' · ');

/**
 * Главная-афиша: поиск в шапке, баннер с новинками (первым — «продолжить»), комнаты большими
 * плитками, полки «продолжить», «сегодня выходят», «онгоинги», «лучшее», «фильмы» и жанры.
 * Ник спрашиваем, когда зритель впервые создаёт комнату (spec rooms).
 */
export function Home() {
  const settings = useSettings();
  const [query, setQuery] = useState('');
  const [genre, setGenre] = useState<Genre | null>(null);
  /** что сейчас открывается: «new» — пустая комната, «random», иначе алиас */
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'name' | 'transfer' | null>(null);
  /** что сделать, когда зритель введёт ник */
  const afterName = useRef<(() => void) | null>(null);
  const closeSheet = useCallback(() => {
    afterName.current = null;
    setSheet(null);
  }, []);
  const feed = useHome();
  const rooms = useRooms();
  const history = useTitles();
  // у тайтлов из истории вышли новые серии — метка «+1 серия», такие тайтлы первыми
  const counts = useEpisodeCounts(history.filter((t) => t.count !== null).map((t) => t.alias));
  const fresh = (t: TitleEntry) => Math.max(0, (counts[t.alias] ?? 0) - (t.count ?? Infinity));
  const titles = [...history].sort((a, b) => Number(fresh(b) > 0) - Number(fresh(a) > 0));
  const { first } = useTitleSearch(query);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  /** Без ника — сначала спрашиваем его, потом делаем то, что зритель нажал. */
  const withName = (action: () => void) => {
    if (settings.name.trim()) return action();
    afterName.current = action;
    setSheet('name');
  };

  /** Новая комната — пустая или сразу с тайтлом. */
  const start = (key: string, from?: Start | (() => Promise<Start>)) =>
    withName(async () => {
      if (busy) return;
      setBusy(key);
      try {
        openRoom(await createRoom(typeof from === 'function' ? await from() : from));
      } catch (e) {
        setToast(e instanceof Error ? e.message : 'Не получилось создать комнату');
        setBusy(null);
      }
    });
  const watch = (alias: string) => start(alias, { alias });
  const random = () => start('random', async () => ({ alias: (await randomTitle()).alias }));
  const resume = (e: TitleEntry) =>
    start(`h:${e.alias}`, { alias: e.alias, episodeId: e.episodeId, position: e.position });
  // без ника — экран «Присоединиться» в комнате спросит его
  const enterRoom = (code: string) => (settings.name.trim() ? openRoom(code) : navigate(roomPath(code)));

  const home = () => {
    setQuery('');
    setGenre(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  let body: ReactNode;
  if (query.trim()) {
    body = (
      <section className="lobby-results">
        <PickerResults query={query} onPick={watch} pending={busy} />
      </section>
    );
  } else if (genre) {
    body = <GenreView genre={genre} onBack={() => setGenre(null)} onPick={watch} busy={busy} />;
  } else {
    const slides: Slide[] = [
      ...(titles[0]
        ? [continueSlide(titles[0], () => resume(titles[0]!), busy === `h:${titles[0].alias}`)]
        : []),
      ...(feed.data?.banner ?? []).map((c) => cardSlide(c, () => watch(c.alias), busy === c.alias)),
    ];
    body = (
      <>
        {slides.length ? (
          <Banner slides={slides} onRandom={random} randomBusy={busy === 'random'} />
        ) : (
          <div className="banner banner-empty">{feed.error ?? <span className="spinner" />}</div>
        )}
        <Shelf title="Комнаты" wide>
          <button className="room-tile room-tile-new rp" onClick={() => start('new')} disabled={!!busy}>
            <span className="room-tile-plus">{busy === 'new' ? <span className="spinner" /> : '+'}</span>
            <span className="room-tile-title">Новая комната</span>
            <span className="room-tile-sub">аниме выберете вместе</span>
          </button>
          {rooms.map((r) => (
            <RoomTile key={r.code} entry={r} onOpen={() => enterRoom(r.code)} />
          ))}
        </Shelf>
        {titles.length > 0 && (
          <Shelf title="Продолжить">
            {titles.map((t) => (
              <PosterCard
                key={t.alias}
                poster={t.poster}
                title={t.title}
                sub={`Серия ${t.ordinal} · ${formatTime(t.position)}`}
                bar={t.duration > 0 ? t.position / t.duration : null}
                badge={fresh(t) > 0 ? `+${plural(fresh(t), 'серия', 'серии', 'серий')}` : null}
                busy={busy === `h:${t.alias}`}
                onClick={() => resume(t)}
                onRemove={() => removeTitle(t.alias)}
                removeLabel="Убрать из истории"
              />
            ))}
          </Shelf>
        )}
        {feed.data?.shelves.map((s) => (
          <Shelf key={s.key} title={s.title}>
            {s.key === 'fresh' && (
              <button className="poster-card rp" onClick={random} disabled={!!busy}>
                <span className="poster-card-img poster-card-random">
                  {busy === 'random' ? <span className="spinner" /> : Icon.dice}
                </span>
                <span className="poster-card-title">Случайное</span>
                <span className="poster-card-sub">не знаю, что смотреть</span>
              </button>
            )}
            {s.cards.map((c) => (
              <PosterCard
                key={c.alias}
                poster={c.poster}
                title={c.title}
                sub={cardSub(c)}
                busy={busy === c.alias}
                onClick={() => watch(c.alias)}
              />
            ))}
          </Shelf>
        ))}
        {!!feed.data?.genres.length && (
          <section className="lobby-section">
            <h2 className="lobby-h2">Жанры</h2>
            <div className="genre-chips">
              {feed.data.genres.map((g) => (
                <button
                  key={g.id}
                  className="chip rp"
                  onClick={() => {
                    setGenre(g);
                    window.scrollTo({ top: 0 });
                  }}
                >
                  {g.name}
                </button>
              ))}
            </div>
          </section>
        )}
      </>
    );
  }

  return (
    <div className="lobby">
      <header className="lobby-top">
        <button className="lobby-logo rp" onClick={home} aria-label="Главная">
          смотрим
          <br />
          вместе
        </button>
        <PickerField query={query} onQuery={setQuery} onSubmit={() => first && watch(first)} />
        <button
          className="lobby-me rp"
          onClick={() => setSheet('name')}
          title={settings.name ? `${settings.name} — сменить ник` : 'Ник'}
          aria-label={settings.name ? `Ник: ${settings.name}` : 'Указать ник'}
        >
          <Avatar name={settings.name || '?'} size={36} />
        </button>
      </header>
      <main className="lobby-body">{body}</main>
      <footer className="lobby-foot">
        <button className="transfer-link rp" onClick={() => setSheet('transfer')}>
          {Icon.transfer} перенести историю на другое устройство
        </button>
      </footer>
      {sheet === 'name' && (
        <NameSheet
          current={settings.name}
          title={afterName.current ? 'Как тебя зовут? Ник увидят в комнате' : undefined}
          action={afterName.current ? 'Дальше' : undefined}
          onSave={(nick) => {
            setSettings({ name: nick });
            const next = afterName.current;
            afterName.current = null;
            setSheet(null);
            next?.();
          }}
          onClose={closeSheet}
        />
      )}
      {sheet === 'transfer' && <TransferSheet onClose={closeSheet} onDone={setToast} />}
      {toast && (
        <div className="toasts">
          <div className="toast">{toast}</div>
        </div>
      )}
    </div>
  );
}

type Slide = {
  key: string;
  label: string;
  title: string;
  poster: string | null;
  meta: string;
  text: string | null;
  action: string;
  bar: number | null;
  busy: boolean;
  onAction(): void;
};

const continueSlide = (t: TitleEntry, onAction: () => void, busy: boolean): Slide => ({
  key: `h:${t.alias}`,
  label: 'продолжить',
  title: t.title,
  poster: t.poster,
  meta: progress(t),
  text: null,
  action: 'Продолжить',
  bar: t.duration > 0 ? t.position / t.duration : null,
  busy,
  onAction,
});

const cardSlide = (c: TitleCard, onAction: () => void, busy: boolean): Slide => ({
  key: c.alias,
  label: 'новое на AniLibria',
  title: c.title,
  poster: c.poster,
  meta: [c.year, c.kind, c.episodes ? `${c.episodes} эп.` : null, ...(c.genres ?? []).slice(0, 3)]
    .filter(Boolean)
    .join(' · '),
  text: c.description ?? null,
  action: 'Смотреть вместе',
  bar: null,
  busy,
  onAction,
});

/** Баннер во всю ширину: размытый постер фоном, постер, название, описание; листается сам и свайпом. */
function Banner({
  slides,
  onRandom,
  randomBusy,
}: {
  slides: Slide[];
  onRandom(): void;
  randomBusy: boolean;
}) {
  const [i, setI] = useState(0);
  const [hold, setHold] = useState(false);
  const touchX = useRef<number | null>(null);
  const n = slides.length;
  const at = Math.min(i, n - 1);
  const slide = slides[at]!;
  const go = (d: number) => setI((x) => (Math.min(x, n - 1) + d + n) % n);

  useEffect(() => {
    if (hold || n < 2) return;
    const t = setInterval(() => document.visibilityState === 'visible' && go(1), SLIDE_MS);
    return () => clearInterval(t);
    // go зависит только от n
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hold, n, at]);

  return (
    <section
      className="banner"
      onPointerEnter={(e) => e.pointerType === 'mouse' && setHold(true)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && setHold(false)}
      onTouchStart={(e) => (touchX.current = e.touches[0]?.clientX ?? null)}
      onTouchEnd={(e) => {
        const x0 = touchX.current;
        const x1 = e.changedTouches[0]?.clientX;
        touchX.current = null;
        if (x0 != null && x1 != null && Math.abs(x1 - x0) > SWIPE_PX) go(x1 < x0 ? 1 : -1);
      }}
      aria-roledescription="карусель"
    >
      {slides.map((s, k) => (
        <div
          key={s.key}
          className={`banner-bg${k === at ? ' on' : ''}`}
          style={s.poster ? { backgroundImage: `url(${s.poster})` } : undefined}
        />
      ))}
      <div className="banner-inner" key={slide.key}>
        {slide.poster && <img className="banner-poster" src={slide.poster} alt="" />}
        <div className="banner-text">
          <div className="banner-label">{slide.label}</div>
          <h2 className="banner-title">{slide.title}</h2>
          {slide.meta && <div className="banner-meta">{slide.meta}</div>}
          {slide.bar !== null && (
            <span className="recent-bar banner-bar">
              <i style={{ width: `${Math.min(100, slide.bar * 100)}%` }} />
            </span>
          )}
          {slide.text && <p className="banner-desc">{slide.text}</p>}
          <div className="banner-actions">
            <button className="btn rp" onClick={slide.onAction} disabled={slide.busy}>
              {slide.busy ? (
                <span className="spinner" />
              ) : (
                <>
                  {Icon.play} {slide.action}
                </>
              )}
            </button>
            <button className="btn btn-tonal rp" onClick={onRandom} disabled={randomBusy}>
              {randomBusy ? <span className="spinner" /> : <>{Icon.dice} Случайное</>}
            </button>
          </div>
        </div>
      </div>
      {n > 1 && (
        <div className="banner-dots">
          {slides.map((s, k) => (
            <button
              key={s.key}
              className={`banner-dot${k === at ? ' on' : ''}`}
              onClick={() => setI(k)}
              aria-label={`Кадр ${k + 1}: ${s.title}`}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/** Полка: заголовок и горизонтальный ряд, листается пальцем, колесом или стрелками. */
function Shelf({ title, wide, children }: { title: string; wide?: boolean; children: ReactNode }) {
  const row = useRef<HTMLDivElement>(null);
  // стрелки — только если ряд не помещается
  const [overflow, setOverflow] = useState(false);
  const check = () => {
    const el = row.current;
    if (el) setOverflow(el.scrollWidth > el.clientWidth + 1);
  };
  // после каждой отрисовки (добавилась плитка) и при смене ширины окна
  useEffect(check);
  useEffect(() => {
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  const scroll = (d: number) =>
    row.current?.scrollBy({ left: d * row.current.clientWidth * 0.8, behavior: 'smooth' });
  return (
    <section className="lobby-section">
      <div className="shelf-head">
        <h2 className="lobby-h2">{title}</h2>
        <div className="shelf-arrows" hidden={!overflow}>
          <button className="icon-btn rp" onClick={() => scroll(-1)} aria-label="Назад">
            {Icon.back}
          </button>
          <button className="icon-btn shelf-next rp" onClick={() => scroll(1)} aria-label="Дальше">
            {Icon.back}
          </button>
        </div>
      </div>
      <div className={`shelf-row${wide ? ' shelf-wide' : ''}`} ref={row}>
        {children}
      </div>
    </section>
  );
}

function PosterCard({
  poster,
  title,
  sub,
  bar = null,
  badge = null,
  busy,
  onClick,
  onRemove,
  removeLabel,
}: {
  poster: string | null;
  title: string;
  sub: string;
  bar?: number | null;
  badge?: string | null;
  busy: boolean;
  onClick(): void;
  onRemove?(): void;
  removeLabel?: string;
}) {
  return (
    <div className="poster-slot">
      <button className="poster-card rp" onClick={onClick}>
        <span className="poster-card-img">
          {poster && <img src={poster} alt="" loading="lazy" />}
          {badge && <span className="new-badge poster-badge">{badge}</span>}
          {bar !== null && (
            <span className="poster-bar">
              <i style={{ width: `${Math.min(100, bar * 100)}%` }} />
            </span>
          )}
          {busy && (
            <span className="poster-card-busy">
              <span className="spinner" />
            </span>
          )}
        </span>
        <span className="poster-card-title">{title}</span>
        <span className="poster-card-sub">{sub}</span>
      </button>
      {onRemove && (
        <button className="poster-remove rp" onClick={onRemove} aria-label={removeLabel} title={removeLabel}>
          {Icon.close}
        </button>
      )}
    </div>
  );
}

/** Комната, где зритель был: большая плитка с размытым постером, серией и временем. */
function RoomTile({ entry: e, onOpen }: { entry: RoomEntry; onOpen(): void }) {
  return (
    <div className="room-tile-slot">
      <button className="room-tile rp" onClick={onOpen}>
        {e.poster && <span className="room-tile-bg" style={{ backgroundImage: `url(${e.poster})` }} />}
        {e.poster && <img className="room-tile-poster" src={e.poster} alt="" loading="lazy" />}
        <span className="room-tile-text">
          <span className="room-tile-code">комната {e.code}</span>
          <span className="room-tile-title">{e.title}</span>
          <span className="room-tile-sub">{progress(e)}</span>
          {e.duration > 0 && (
            <span className="recent-bar">
              <i style={{ width: `${Math.min(100, (e.position / e.duration) * 100)}%` }} />
            </span>
          )}
        </span>
      </button>
      <button
        className="poster-remove rp"
        onClick={() => removeRoom(e.code)}
        aria-label="Убрать из комнат"
        title="Убрать из комнат"
      >
        {Icon.close}
      </button>
    </div>
  );
}

/** Жанр: лучшие тайтлы сеткой, «ещё» — следующая страница. */
function GenreView({
  genre,
  onBack,
  onPick,
  busy,
}: {
  genre: Genre;
  onBack(): void;
  onPick(alias: string): void;
  busy: string | null;
}) {
  const [pages, setPages] = useState(1);
  return (
    <section className="lobby-section">
      <div className="shelf-head">
        <button className="icon-btn rp" onClick={onBack} aria-label="Назад">
          {Icon.back}
        </button>
        <h2 className="lobby-h2">{genre.name}</h2>
      </div>
      <div className="poster-grid">
        {Array.from({ length: pages }, (_, k) => (
          <GenrePage
            key={k}
            id={genre.id}
            page={k + 1}
            last={k + 1 === pages}
            onMore={() => setPages(pages + 1)}
            onPick={onPick}
            busy={busy}
          />
        ))}
      </div>
    </section>
  );
}

function GenrePage({
  id,
  page,
  last,
  onMore,
  onPick,
  busy,
}: {
  id: number;
  page: number;
  last: boolean;
  onMore(): void;
  onPick(alias: string): void;
  busy: string | null;
}) {
  const { data, error } = useGenre(id, page);
  if (!data) return <div className="empty hint grid-wide">{error ?? <span className="spinner" />}</div>;
  return (
    <>
      {data.cards.map((c) => (
        <PosterCard
          key={c.alias}
          poster={c.poster}
          title={c.title}
          sub={cardSub(c)}
          busy={busy === c.alias}
          onClick={() => onPick(c.alias)}
        />
      ))}
      {last && data.more && (
        <button className="btn btn-tonal grid-wide rp" onClick={onMore}>
          Ещё
        </button>
      )}
    </>
  );
}
