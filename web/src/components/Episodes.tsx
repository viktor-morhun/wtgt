import { useEffect, useRef } from 'react';
import { formatTime, type Release } from '@wtgt/shared';
import * as cmd from '../commands';
import { episodeLabel } from './Stage';

/** Список серий как очередь в listen-together: текущая выделена, у неё эквалайзер, пока идёт. */
export function Episodes({
  release,
  currentId,
  playing,
  visible,
}: {
  release: Release;
  currentId: string | null;
  playing: boolean;
  /** вкладка серий открыта — к текущей серии прокручиваем и при открытии вкладки */
  visible: boolean;
}) {
  const currentRef = useRef<HTMLButtonElement>(null);

  // к текущей серии — при открытии вкладки и при смене серии
  useEffect(() => {
    if (visible) currentRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [currentId, visible]);

  return (
    <ul className="list episodes">
      {release.episodes.map((e, i) => {
        const current = e.id === currentId;
        const playable = Object.keys(e.hls).length > 0;
        return (
          <li key={e.id} style={{ '--i': Math.min(i, 20) } as React.CSSProperties}>
            <button
              ref={current ? currentRef : undefined}
              className={`row row-button rp${current ? ' row-current' : ''}`}
              disabled={!playable}
              onClick={() => !current && cmd.playEpisode(e.id)}
            >
              <span className="ep-no">
                {current ? (
                  <span className={`eq${playing ? ' on' : ''}`}>
                    <i />
                    <i />
                    <i />
                  </span>
                ) : (
                  e.ordinal
                )}
              </span>
              <span className="row-main">
                <span className="row-title">{episodeLabel(e)}</span>
                {(e.name || !playable) && <span className="row-sub">{playable ? e.name : 'нет видео'}</span>}
              </span>
              {e.duration > 0 && <span className="badge">{formatTime(e.duration)}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
