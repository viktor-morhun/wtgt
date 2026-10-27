import { useState } from 'react';
import { NAME_MAX } from '@wtgt/shared';
import { navigate, roomPath } from '../route';
import { setSettings, useSettings } from '../settings';

/** Комната, которую этот зритель только что создал: в неё входим сразу, без экрана «Присоединиться». */
export const CREATED_KEY = 'wtgt.created';

/** Главная: ник и «Создать комнату» — дальше ссылку отправляешь другу (spec rooms). */
export function Home() {
  const settings = useSettings();
  const [name, setName] = useState(settings.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      try {
        sessionStorage.setItem(CREATED_KEY, body.code);
      } catch {
        // без хранилища создатель просто нажмёт «Присоединиться»
      }
      navigate(roomPath(body.code));
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
        <div className="hint">
          Аниме с AniLibria в одной комнате: пауза, перемотка и скорость — у всех сразу.
        </div>
      </div>
      <form
        className="home-form"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <h3>как тебя зовут</h3>
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
            <span className="rc-meta">ссылку на неё отправишь другу</span>
          </span>
        </button>
        {error && <div className="release-error">{error}</div>}
      </form>
    </div>
  );
}
