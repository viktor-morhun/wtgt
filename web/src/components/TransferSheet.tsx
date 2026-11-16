import { useEffect, useState } from 'react';
import { NAME_MAX, ROOM_CODE_LENGTH, type Transfer } from '@wtgt/shared';
import { exportHistory, importHistory } from '../history';
import { getSettings, setSettings } from '../settings';

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error('Нет связи с сервером');
  }
  const body = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
  if (!res.ok || !body) throw new Error(body?.message ?? 'Не получилось');
  return body;
}

/** Числительное: 1 запись, 2 записи, 5 записей. */
const records = (n: number) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} запись`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} записи`;
  return `${n} записей`;
};

/**
 * Перенос комнат и истории на другое устройство без аккаунта: здесь — «показать код»,
 * там — ввести его. Код живёт 10 минут.
 */
export function TransferSheet({ onClose, onDone }: { onClose(): void; onDone(text: string): void }) {
  const [code, setCode] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState<'out' | 'in' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const send = async () => {
    setBusy('out');
    setError(null);
    try {
      const name = getSettings().name.trim().slice(0, NAME_MAX);
      const data: Transfer = { ...exportHistory(), ...(name ? { name } : {}) };
      const r = await call<{ code: string }>('/api/transfer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      });
      setCode(r.code);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(null);
  };

  const receive = async () => {
    const c = input.trim().toLowerCase();
    if (c.length !== ROOM_CODE_LENGTH) return setError(`Код — ${ROOM_CODE_LENGTH} символов`);
    setBusy('in');
    setError(null);
    try {
      const data = await call<Partial<Transfer>>(`/api/transfer/${encodeURIComponent(c)}`);
      const n = importHistory(data);
      if (data.name && !getSettings().name.trim()) setSettings({ name: data.name });
      onDone(n ? `Перенесено: ${records(n)}` : 'Всё уже здесь');
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  return (
    <div className="sheet-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet transfer-sheet">
        <h3>с этого устройства</h3>
        {code ? (
          <div className="transfer-code" aria-label={`Код ${code.split('').join(' ')}`}>
            {code.split('').map((ch, i) => (
              <span key={i} style={{ '--i': i } as React.CSSProperties}>
                {ch}
              </span>
            ))}
            <div className="hint small">введи его на другом устройстве · 10 минут</div>
          </div>
        ) : (
          <button className="btn btn-wide rp" onClick={() => void send()} disabled={!!busy}>
            {busy === 'out' ? <span className="spinner" /> : 'Показать код'}
          </button>
        )}
        <h3>на это устройство</h3>
        <form
          className="transfer-in"
          onSubmit={(e) => {
            e.preventDefault();
            void receive();
          }}
        >
          <div className="search-field">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value.replace(/\s/g, ''))}
              placeholder="Код с другого устройства"
              maxLength={ROOM_CODE_LENGTH}
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              aria-label="Код с другого устройства"
            />
          </div>
          <button className="btn rp" disabled={input.trim().length !== ROOM_CODE_LENGTH || !!busy}>
            {busy === 'in' ? <span className="spinner" /> : 'Перенести'}
          </button>
        </form>
        {error && <div className="release-error">{error}</div>}
      </div>
    </div>
  );
}
