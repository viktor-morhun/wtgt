import { useEffect, useRef, useState } from 'react';
import { formatTime, NAME_MAX, type TitleCard } from '@wtgt/shared';
import {
  removeRoom,
  removeTitle,
  useRooms,
  useTitles,
  WATCHED,
  type RoomEntry,
  type TitleEntry,
} from '../history';
import { Icon } from '../icons';
import { createRoom, openRoom, type Start } from '../lobby';
import { navigate, roomPath } from '../route';
import { setSettings, useSettings } from '../settings';
import { randomTitle, useLatest } from '../titles';
import { Poster, TitlePicker } from './TitlePicker';

const TOAST_MS = 2_500;

type Tab = 'latest' | 'rooms' | 'history';

const progress = (e: { ordinal: number; position: number; duration: number }) =>
  `Серия ${e.ordinal} · ${formatTime(e.position)}${e.duration > 0 ? ` / ${formatTime(e.duration)}` : ''}`;

/**
 * Главная: ник, пустая комната или сразу с тайтлом из поиска, «новое» на AniLibria,
 * комнаты, где зритель был, и история просмотра по тайтлам (spec rooms).
 */
export function Home() {
  const settings = useSettings();
  const [name, setName] = useState(settings.name);
  const nameRef = useRef<HTMLInputElement>(null);
  /** что сейчас открывается: «new» — пустая комната, иначе алиас */
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const rooms = useRooms();
  const titles = useTitles();
  const [tab, setTab] = useState<Tab>(() => (rooms.length ? 'rooms' : titles.length ? 'history' : 'latest'));
  const valid = name.trim().length > 0;

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  /** Новая комната — пустая или сразу с тайтлом; без ника сначала просим ник. */
  const start = async (key: string, from?: Start | (() => Promise<Start>)) => {
    if (busy) return;
    if (!valid) {
      setToast('Сначала ник');
      nameRef.current?.focus();
      return;
    }
    setBusy(key);
    setSettings({ name: name.trim() });
    try {
      openRoom(await createRoom(typeof from === 'function' ? await from() : from));
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Не получилось создать комнату');
      setBusy(null);
    }
  };

  const enterRecent = (code: string) => {
    // без ника — экран «Присоединиться» в комнате спросит его
    if (!valid) return navigate(roomPath(code));
    setSettings({ name: name.trim() });
    openRoom(code);
  };

  const tabs: [Tab, string, number][] = [
    ['latest', 'новое', 0],
    ['rooms', 'комнаты', rooms.length],
    ['history', 'история', titles.length],
  ];

  return (
    <div className="home">
      <div className="hero">
        <h1>
          смотрим
          <br />
          вместе
        </h1>
      </div>
      <form
        className="home-form"
        onSubmit={(e) => {
          e.preventDefault();
          void start('new');
        }}
      >
        <div className="search-field">
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => valid && setSettings({ name: name.trim() })}
            placeholder="Ник"
            maxLength={NAME_MAX}
            autoFocus={!name}
            aria-label="Ник"
          />
        </div>
        <button className="new-room rp" disabled={!!busy}>
          <span className="new-room-plus">{busy === 'new' ? <span className="spinner" /> : '+'}</span>
          <span className="rc-main">
            <span className="rc-title">создать комнату</span>
          </span>
        </button>
      </form>
      <section className="home-browse">
        <TitlePicker onPick={(alias) => void start(alias, { alias })} pending={busy}>
          <div className="chips home-tabs" role="tablist">
            {tabs.map(([key, label, count]) => (
              <button
                key={key}
                role="tab"
                aria-selected={tab === key}
                className={`chip rp${tab === key ? ' active' : ''}`}
                onClick={() => setTab(key)}
              >
                {label}
                {count > 0 && <span className="chip-count">{count}</span>}
              </button>
            ))}
          </div>
          {tab === 'latest' && (
            <Latest
              onPick={(c) => void start(c.alias, { alias: c.alias })}
              onRandom={() => void start('random', async () => ({ alias: (await randomTitle()).alias }))}
              busy={busy}
            />
          )}
          {tab === 'rooms' &&
            (rooms.length ? (
              <ul className="list">
                {rooms.map((e, i) => (
                  <RoomRow key={e.code} entry={e} i={i} onOpen={() => enterRecent(e.code)} />
                ))}
              </ul>
            ) : (
              <div className="empty hint">Пока пусто</div>
            ))}
          {tab === 'history' &&
            (titles.length ? (
              <ul className="list">
                {titles.map((e, i) => (
                  <HistoryRow
                    key={e.alias}
                    entry={e}
                    i={i}
                    busy={busy === `h:${e.alias}`}
                    onOpen={() =>
                      void start(`h:${e.alias}`, {
                        alias: e.alias,
                        episodeId: e.episodeId,
                        position: e.position,
                      })
                    }
                  />
                ))}
              </ul>
            ) : (
              <div className="empty hint">Пока пусто</div>
            ))}
        </TitlePicker>
      </section>
      {toast && (
        <div className="toasts">
          <div className="toast">{toast}</div>
        </div>
      )}
    </div>
  );
}

/** «Новое на AniLibria» постерами: нажал — комната сразу с этим тайтлом. */
function Latest({
  onPick,
  onRandom,
  busy,
}: {
  onPick(c: TitleCard): void;
  onRandom(): void;
  busy: string | null;
}) {
  const latest = useLatest();
  if (!latest.cards) return <div className="empty hint">{latest.error ?? <span className="spinner" />}</div>;
  return (
    <div className="poster-grid">
      <button className="poster-card rp" onClick={onRandom} disabled={!!busy}>
        <span className="poster-card-img poster-card-random">
          {busy === 'random' ? <span className="spinner" /> : Icon.dice}
        </span>
        <span className="poster-card-title">Случайное</span>
        <span className="poster-card-sub">не знаю, что смотреть</span>
      </button>
      {latest.cards.map((c, i) => (
        <button
          key={c.alias}
          className="poster-card rp"
          style={{ '--i': Math.min(i, 20) } as React.CSSProperties}
          onClick={() => onPick(c)}
          disabled={!!busy}
        >
          <span className="poster-card-img">
            {c.poster && <img src={c.poster} alt="" loading="lazy" />}
            {busy === c.alias && (
              <span className="poster-card-busy">
                <span className="spinner" />
              </span>
            )}
          </span>
          <span className="poster-card-title">{c.title}</span>
          <span className="poster-card-sub">{[c.year, c.kind].filter(Boolean).join(' · ')}</span>
        </button>
      ))}
    </div>
  );
}

function Bar({ value, max }: { value: number; max: number }) {
  return max > 0 ? (
    <span className="recent-bar">
      <i style={{ width: `${Math.min(100, (value / max) * 100)}%` }} />
    </span>
  ) : null;
}

/** Комната, где зритель был: в неё же и возвращаемся — с теми, кто там сейчас. */
function RoomRow({ entry: e, i, onOpen }: { entry: RoomEntry; i: number; onOpen(): void }) {
  return (
    <li className="row recent-row" style={{ '--i': Math.min(i, 20) } as React.CSSProperties}>
      <button className="row-tap rp" onClick={onOpen}>
        <Poster src={e.poster} />
        <span className="row-main">
          <span className="row-title">{e.title}</span>
          <span className="row-sub">{progress(e)}</span>
          <Bar value={e.position} max={e.duration} />
        </span>
      </button>
      <button
        className="icon-btn rp"
        onClick={() => removeRoom(e.code)}
        aria-label="Убрать из комнат"
        title="Убрать из комнат"
      >
        {Icon.close}
      </button>
    </li>
  );
}

/** Тайтл из истории: новая комната продолжает с той же серии и времени. */
function HistoryRow({
  entry: e,
  i,
  busy,
  onOpen,
}: {
  entry: TitleEntry;
  i: number;
  busy: boolean;
  onOpen(): void;
}) {
  const done = Object.values(e.seen).filter((v) => v >= WATCHED).length;
  return (
    <li className="row recent-row" style={{ '--i': Math.min(i, 20) } as React.CSSProperties}>
      <button className="row-tap rp" onClick={onOpen} title="Продолжить в новой комнате">
        <Poster src={e.poster} />
        <span className="row-main">
          <span className="row-title">{e.title}</span>
          <span className="row-sub">
            {progress(e)}
            {done > 0 ? ` · ✓ ${done}` : ''}
          </span>
          <Bar value={e.position} max={e.duration} />
        </span>
        {busy && <span className="spinner" />}
      </button>
      <button
        className="icon-btn rp"
        onClick={() => removeTitle(e.alias)}
        aria-label="Убрать из истории"
        title="Убрать из истории"
      >
        {Icon.close}
      </button>
    </li>
  );
}
