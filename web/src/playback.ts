import Hls from 'hls.js/light';
import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  DRIFT_THRESHOLD_S,
  positionAt,
  QUALITIES,
  type Episode,
  type Quality,
  type Session,
} from '@wtgt/shared';
import { send, serverNow } from './net';

/** Как часто сверяем видео с сессией (design D5). */
const SYNC_MS = 500;
/** На паузе кадр должен совпасть точнее: остановились — смотрим в одну точку. */
const PAUSED_THRESHOLD_S = 0.3;
/** Столько после своего изменения события <video> не считаем действиями пользователя (design D6). */
const APPLY_GUARD_MS = 500;

type IOSVideo = HTMLVideoElement & { webkitDisplayingFullscreen?: boolean };

/** Ближайшее доступное качество к выбранному (spec anilibria-source). */
export function pickQuality(ep: Episode, preferred: Quality): Quality | null {
  const available = QUALITIES.filter((q) => ep.hls[q]);
  if (!available.length) return null;
  return available.reduce((best, q) => (Math.abs(q - preferred) < Math.abs(best - preferred) ? q : best));
}

type Options = {
  video: RefObject<HTMLVideoElement | null>;
  session: Session | null;
  episode: Episode | null;
  quality: Quality;
  /** зритель нажал «Присоединиться» — можно управлять видео со звуком */
  joined: boolean;
  /** ссылки на поток, возможно, устарели — перезапросить релиз мимо кэша */
  onStale(): void;
};

export type Playback = {
  /** догоняем сессию после перемотки или загрузки */
  catchingUp: boolean;
  /** браузер не дал включить видео без нажатия */
  blocked: boolean;
  error: string | null;
  retry(): void;
};

/**
 * Держит <video> на позиции общей сессии: грузит HLS выбранной серии и качества, применяет
 * пуск/паузу/скорость и перематывается, если расхождение больше порога (spec synced-playback).
 * Команды отсюда не уходят — их шлют только кнопки и клавиши; исключение — нативный полный экран iOS.
 */
export function usePlayback({ video, session, episode, quality, joined, onStale }: Options): Playback {
  const [catchingUp, setCatchingUp] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const applyingUntil = useRef(0);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const staleRef = useRef(onStale);
  staleRef.current = onStale;

  const q = episode ? pickQuality(episode, quality) : null;
  const src = episode && q ? episode.hls[q]! : null;

  // загрузка потока; при смене качества продолжаем с той же позиции — её выставит сверка
  useEffect(() => {
    const v = video.current;
    if (!v || !src) return;
    setError(null);
    let triedStale = false;
    let triedMedia = false;
    const fail = () => {
      if (!triedStale) {
        triedStale = true;
        staleRef.current();
        return;
      }
      setError('Не удалось загрузить видео');
    };

    if (Hls.isSupported()) {
      const hls = new Hls({ maxBufferLength: 60, backBufferLength: 30 });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !triedMedia) {
          triedMedia = true;
          hls.recoverMediaError();
          return;
        }
        fail();
      });
      hls.loadSource(src);
      hls.attachMedia(v);
      return () => hls.destroy();
    }
    // Safari на iOS: нативный HLS
    v.src = src;
    v.addEventListener('error', fail);
    return () => {
      v.removeEventListener('error', fail);
      v.removeAttribute('src');
      v.load();
    };
  }, [video, src, attempt]);

  // сверка с сессией
  useEffect(() => {
    const v = video.current;
    if (!v || !joined) return;
    const mark = () => (applyingUntil.current = performance.now() + APPLY_GUARD_MS);

    const sync = () => {
      const s = sessionRef.current;
      if (!s || !episode || s.episodeId !== episode.id || v.readyState < HTMLMediaElement.HAVE_METADATA)
        return;
      if (v.playbackRate !== s.rate) {
        mark();
        v.defaultPlaybackRate = v.playbackRate = s.rate;
      }
      const duration = Number.isFinite(v.duration) ? v.duration : episode.duration;
      const expected = Math.min(positionAt(s, serverNow()), Math.max(0, duration - 0.05));
      const drift = Math.abs(v.currentTime - expected);
      const threshold = s.paused ? PAUSED_THRESHOLD_S : DRIFT_THRESHOLD_S;
      if (drift > threshold && !v.seeking) {
        mark();
        v.currentTime = expected;
        setCatchingUp(!s.paused);
      }
      if (s.paused && !v.paused) {
        mark();
        v.pause();
      } else if (!s.paused && v.paused && !v.ended) {
        mark();
        v.play().then(
          () => setBlocked(false),
          (e: DOMException) => e.name === 'NotAllowedError' && setBlocked(true),
        );
      }
    };

    const settled = () => setCatchingUp(false);
    const ended = () => {
      const s = sessionRef.current;
      if (s && !s.paused && episode && s.episodeId === episode.id) {
        send({ type: 'ended', episodeId: episode.id, version: s.version });
      }
    };
    // нативный полный экран iOS: управление системное, его действия превращаем в команды (design D6)
    const native = (e: Event) => {
      if (!(v as IOSVideo).webkitDisplayingFullscreen || performance.now() < applyingUntil.current) return;
      if (e.type === 'play') send({ type: 'play' });
      else if (e.type === 'pause' && !v.ended) send({ type: 'pause', position: v.currentTime });
      else if (e.type === 'seeked') send({ type: 'seek', position: v.currentTime });
    };

    sync();
    const timer = setInterval(sync, SYNC_MS);
    const onVisible = () => document.visibilityState === 'visible' && sync();
    document.addEventListener('visibilitychange', onVisible);
    v.addEventListener('loadedmetadata', sync);
    v.addEventListener('canplay', sync);
    v.addEventListener('playing', settled);
    v.addEventListener('seeked', settled);
    v.addEventListener('ended', ended);
    for (const t of ['play', 'pause', 'seeked']) v.addEventListener(t, native);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      v.removeEventListener('loadedmetadata', sync);
      v.removeEventListener('canplay', sync);
      v.removeEventListener('playing', settled);
      v.removeEventListener('seeked', settled);
      v.removeEventListener('ended', ended);
      for (const t of ['play', 'pause', 'seeked']) v.removeEventListener(t, native);
    };
  }, [video, joined, episode, session?.version]);

  return { catchingUp, blocked, error, retry: () => setAttempt((n) => n + 1) };
}

export type Clock = { time: number; duration: number; buffered: number; waiting: boolean };

/** Время, длительность и загруженный кусок видео — для полосы перемотки. */
export function useVideoClock(video: RefObject<HTMLVideoElement | null>, fallbackDuration: number): Clock {
  const [clock, setClock] = useState<Clock>({ time: 0, duration: 0, buffered: 0, waiting: false });
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    let waiting = false;
    const update = () => {
      let buffered = 0;
      for (let i = 0; i < v.buffered.length; i++) {
        if (v.buffered.start(i) <= v.currentTime + 0.5) buffered = Math.max(buffered, v.buffered.end(i));
      }
      setClock({
        time: v.currentTime,
        duration: Number.isFinite(v.duration) && v.duration > 0 ? v.duration : fallbackDuration,
        buffered,
        waiting,
      });
    };
    const onWaiting = () => ((waiting = true), update());
    const onReady = () => ((waiting = false), update());
    const events = ['timeupdate', 'durationchange', 'progress', 'seeked', 'loadedmetadata', 'emptied'];
    for (const t of events) v.addEventListener(t, update);
    v.addEventListener('waiting', onWaiting);
    v.addEventListener('playing', onReady);
    v.addEventListener('canplay', onReady);
    update();
    return () => {
      for (const t of events) v.removeEventListener(t, update);
      v.removeEventListener('waiting', onWaiting);
      v.removeEventListener('playing', onReady);
      v.removeEventListener('canplay', onReady);
    };
  }, [video, fallbackDuration]);
  return clock;
}
