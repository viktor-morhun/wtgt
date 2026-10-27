import { useEffect, useState } from 'react';
import { parseAlias } from '@wtgt/shared';
import { send, useNet } from '../net';

/** Шторка «сменить тайтл»: ссылка на релиз AniLibria или алиас (spec anilibria-source). */
export function ReleaseSheet({ currentAlias, onClose }: { currentAlias: string; onClose(): void }) {
  const net = useNet();
  const [input, setInput] = useState('');
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [sentVersion, setSentVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // сервер ответил: ошибка — показываем, сменился релиз — закрываемся
  useEffect(() => {
    if (sentAt && net.error && net.error.at >= sentAt) {
      setError(net.error.message);
      setSentAt(null);
    }
  }, [net.error, sentAt]);
  useEffect(() => {
    if (sentAt && net.cause === 'release' && (net.session?.version ?? 0) > sentVersion) onClose();
  }, [net.session?.version, net.cause, sentAt, sentVersion, onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = () => {
    const alias = parseAlias(input);
    if (!alias) return setError('Это не похоже на ссылку AniLibria');
    if (alias === currentAlias) return onClose();
    setError(null);
    if (send({ type: 'release', input: alias })) {
      setSentVersion(net.session?.version ?? 0);
      setSentAt(Date.now());
    } else setError('Нет связи с сервером');
  };

  return (
    <div className="sheet-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="sheet release-sheet"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="sheet-title">Сменить тайтл — переключится у всех</div>
        <div className="search-field">
          <input
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="https://anilibria.tv/release/…"
            inputMode="url"
            aria-label="Ссылка на релиз AniLibria"
          />
        </div>
        {error && <div className="release-error">{error}</div>}
        <button className="btn btn-wide rp" disabled={!input.trim() || sentAt !== null}>
          {sentAt !== null ? <span className="spinner" /> : 'Смотреть'}
        </button>
      </form>
    </div>
  );
}
