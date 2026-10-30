import { useState } from 'react';
import { formatTime, NAME_MAX } from '@wtgt/shared';
import { removeRoom, useRooms, type RoomEntry } from '../history';
import { Icon } from '../icons';
import { navigate, roomPath } from '../route';
import { setSettings, useSettings } from '../settings';

/**
 * Комната, которую этот зритель только что создал или выбрал среди недавних:
 * в неё входим сразу, без экрана «Присоединиться».
 */
export const CREATED_KEY = 'wtgt.created';

function enter(code: string): void {
  try {
    sessionStorage.setItem(CREATED_KEY, code);
  } catch {
    // без хранилища просто нажмёт «Присоединиться»
  }
  navigate(roomPath(code));
}

const progress = (e: RoomEntry) =>
  `Серия ${e.ordinal} · ${formatTime(e.position)}${e.duration > 0 ? ` / ${formatTime(e.duration)}` : ''}`;

/** Главная: ник и «Создать комнату» — дальше ссылку отправляешь другу (spec rooms). */
export function Home() {
  const settings = useSettings();
  const [name, setName] = useState(settings.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rooms = useRooms();
  const valid = name.trim().length > 0;

  const create = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    setSettings({ name: name.trim() });
    try {
      const res = await fetch('/api/rooms', { method: 'POST' });
      const body = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
      if (!res.ok || !body?.code) throw new Error(body?.message ?? 'Не получилось создать комнату');
      enter(body.code);
    } catch (e) {
      setError(e instanceof Error && e.message !== 'Failed to fetch' ? e.message : 'Нет связи с сервером');
      setBusy(false);
    }
  };

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
          void create();
        }}
      >
        <div className="search-field">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ник"
            maxLength={NAME_MAX}
            autoFocus
            aria-label="Ник"
          />
        </div>
        <button className="new-room rp" disabled={!valid || busy}>
          <span className="new-room-plus">{busy ? <span className="spinner" /> : '+'}</span>
          <span className="rc-main">
            <span className="rc-title">создать комнату</span>
          </span>
        </button>
        {error && <div className="release-error">{error}</div>}
      </form>
      {rooms.length > 0 && (
        <section className="recent">
          <h3>недавние</h3>
          <ul className="list">
            {rooms.map((e, i) => (
              <li key={e.code} className="row" style={{ '--i': Math.min(i, 20) } as React.CSSProperties}>
                <button
                  className="row-tap rp"
                  onClick={() => {
                    // без ника — экран «Присоединиться» в комнате спросит его
                    if (!valid) return navigate(roomPath(e.code));
                    setSettings({ name: name.trim() });
                    enter(e.code);
                  }}
                >
                  {e.poster ? (
                    <img className="recent-poster" src={e.poster} alt="" loading="lazy" />
                  ) : (
                    <span className="recent-poster" />
                  )}
                  <span className="row-main">
                    <span className="row-title">{e.title}</span>
                    <span className="row-sub">{progress(e)}</span>
                    {e.duration > 0 && (
                      <span className="recent-bar">
                        <i style={{ width: `${Math.min(100, (e.position / e.duration) * 100)}%` }} />
                      </span>
                    )}
                  </span>
                </button>
                <button
                  className="icon-btn rp"
                  onClick={() => removeRoom(e.code)}
                  aria-label="Убрать из недавних"
                  title="Убрать из недавних"
                >
                  {Icon.close}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
