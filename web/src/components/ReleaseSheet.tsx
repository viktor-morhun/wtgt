import { useCallback, useEffect, useState } from 'react';
import { send, useNet } from '../net';
import { LatestList, TitlePicker } from './TitlePicker';

/**
 * Сменить тайтл комнаты: отправляем алиас и ждём ответа сервера.
 * pending — алиас, который открывается; done — сервер сменил тайтл.
 */
export function usePickRelease(onDone?: () => void) {
  const net = useNet();
  const [sent, setSent] = useState<{ alias: string; at: number; version: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // сервер ответил: ошибка — показываем, сменился релиз — готово
  useEffect(() => {
    if (sent && net.error && net.error.at >= sent.at) {
      setError(net.error.message);
      setSent(null);
    }
  }, [net.error, sent]);
  useEffect(() => {
    if (sent && net.cause === 'release' && (net.session?.version ?? 0) > sent.version) {
      setSent(null);
      onDone?.();
    }
  }, [net.session?.version, net.cause, sent, onDone]);

  const pick = useCallback(
    (alias: string) => {
      const s = net.session;
      if (sent) return;
      if (alias === s?.alias) return onDone?.();
      setError(null);
      if (send({ type: 'release', input: alias })) {
        setSent({ alias, at: Date.now(), version: s?.version ?? 0 });
      } else setError('Нет связи с сервером');
    },
    [net.session, sent, onDone],
  );

  return { pick, pending: sent?.alias ?? null, error };
}

/** Шторка «сменить тайтл»: поиск по названию или ссылка на AniLibria / YummyAnime (spec anilibria-source). */
export function ReleaseSheet({ onClose }: { onClose(): void }) {
  const { pick, pending, error } = usePickRelease(onClose);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet release-sheet">
        <TitlePicker onPick={pick} pending={pending} error={error} autoFocus>
          <LatestList onPick={pick} pending={pending} />
        </TitlePicker>
      </div>
    </div>
  );
}
