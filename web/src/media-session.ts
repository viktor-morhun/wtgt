import { useEffect, type RefObject } from 'react';
import type { Episode, Release } from '@wtgt/shared';
import * as cmd from './commands';
import type { Media } from './kodik';
import { getNet } from './net';

const ACTIONS: MediaSessionAction[] = [
  'play',
  'pause',
  'seekbackward',
  'seekforward',
  'nexttrack',
  'previoustrack',
];

type Options = {
  /** зритель вошёл в комнату — системные кнопки управляют ею */
  enabled: boolean;
  release: Release | null;
  episode: Episode | null;
  paused: boolean;
  media: RefObject<Media | null>;
};

/**
 * Кнопки системного плеера — окна «картинки в картинке», экрана блокировки, гарнитуры — становятся
 * командами комнаты, как кнопки на панели (design D6); там же название тайтла, серия и постер.
 */
export function useMediaSession({ enabled, release, episode, paused, media }: Options): void {
  const ms = 'mediaSession' in navigator ? navigator.mediaSession : null;

  useEffect(() => {
    if (!ms || !enabled || !release) return;
    ms.metadata = new MediaMetadata({
      title: release.title,
      artist: episode ? `Серия ${episode.ordinal}` : '',
      album: 'Смотрим вместе',
      artwork: release.poster ? [{ src: release.poster }] : [],
    });
    return () => {
      ms.metadata = null;
    };
  }, [ms, enabled, release, episode]);

  useEffect(() => {
    if (ms && enabled) ms.playbackState = paused ? 'paused' : 'playing';
  }, [ms, enabled, paused]);

  useEffect(() => {
    if (!ms || !enabled) return;
    const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        // браузер не знает этого действия
      }
    };
    const duration = () => {
      const v = media.current;
      return v && Number.isFinite(v.duration) ? v.duration : (episode?.duration ?? 0);
    };
    const toggleIf = (wantPaused: boolean) => () => {
      if (getNet().session?.paused === wantPaused) cmd.togglePlay(media.current);
    };
    const episodeId = () => getNet().session?.episodeId ?? null;
    set('play', toggleIf(true));
    set('pause', toggleIf(false));
    set('seekbackward', (d) => cmd.seekBy(-(d.seekOffset ?? 10), media.current, duration()));
    set('seekforward', (d) => cmd.seekBy(d.seekOffset ?? 10, media.current, duration()));
    set('nexttrack', () => cmd.playEpisode(cmd.neighbour(release, episodeId(), 1)));
    set('previoustrack', () => cmd.playEpisode(cmd.neighbour(release, episodeId(), -1)));
    return () => {
      for (const a of ACTIONS) set(a, null);
    };
  }, [ms, enabled, release, episode, media]);
}
