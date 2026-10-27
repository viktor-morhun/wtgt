import { positionAt, RATES, type Rate, type Release, type Session } from '@wtgt/shared';
import { getNet, send, serverNow } from './net';

/** Команды общей сессии от кнопок и клавиш (design D6): все действия зрителя идут только отсюда. */

const session = (): Session | null => getNet().session;

/**
 * Нажатия быстрее ответа сервера (→ → →, Shift+> ×3) считаются от последней отправленной команды,
 * а не от сессии, которая ещё не обновилась. Пока version та же — ответа не было.
 */
type Pending<T> = { value: T; version: number };
let pendingSeek: Pending<number> | null = null;
let pendingRate: Pending<Rate> | null = null;
const fresh = <T>(p: Pending<T> | null, s: Session): T | null =>
  p && p.version === s.version ? p.value : null;

export function togglePlay(video: HTMLVideoElement | null): void {
  const s = session();
  if (!s) return;
  if (s.paused) send({ type: 'play' });
  else send({ type: 'pause', position: video?.currentTime ?? positionAt(s, serverNow()) });
}

export function seekTo(sec: number, duration: number): void {
  const s = session();
  const max = duration > 0 ? Math.max(0, duration - 0.5) : sec;
  const position = Math.min(Math.max(0, sec), max);
  if (s && send({ type: 'seek', position })) pendingSeek = { value: position, version: s.version };
}

export function seekBy(delta: number, _video: HTMLVideoElement | null, duration: number): void {
  const s = session();
  if (!s) return;
  seekTo((fresh(pendingSeek, s) ?? positionAt(s, serverNow())) + delta, duration);
}

export function setRate(rate: Rate): void {
  const s = session();
  if (s && send({ type: 'rate', rate })) pendingRate = { value: rate, version: s.version };
}

export function stepRate(dir: 1 | -1): void {
  const s = session();
  if (!s) return;
  const base = fresh(pendingRate, s) ?? s.rate;
  const next = RATES[Math.min(RATES.length - 1, Math.max(0, RATES.indexOf(base) + dir))]!;
  if (next !== base) setRate(next);
}

/** Соседняя доступная серия: dir = 1 — следующая, -1 — предыдущая. */
export function neighbour(release: Release | null, episodeId: string | null, dir: 1 | -1): string | null {
  if (!release || !episodeId) return null;
  const list = release.episodes;
  for (let i = list.findIndex((e) => e.id === episodeId) + dir; i >= 0 && i < list.length; i += dir) {
    if (Object.keys(list[i]!.hls).length) return list[i]!.id;
  }
  return null;
}

export function playEpisode(episodeId: string | null): void {
  if (episodeId) send({ type: 'episode', episodeId });
}

type FsVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

/** Полный экран — весь плеер вместе с панелью; на iOS — нативный у видео (spec player-ui). */
export function toggleFullscreen(stage: HTMLElement | null, video: HTMLVideoElement | null): void {
  if (document.fullscreenElement) {
    void document.exitFullscreen();
    return;
  }
  if (stage?.requestFullscreen && document.fullscreenEnabled) {
    void stage.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    return;
  }
  (video as FsVideo | null)?.webkitEnterFullscreen?.();
}
