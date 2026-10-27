import type { Session } from './protocol';

/** Порог расхождения, после которого клиент перематывается к сессии (spec synced-playback). */
export const DRIFT_THRESHOLD_S = 1;

type Playback = Pick<Session, 'paused' | 'position' | 'anchor' | 'rate'>;

/** Ожидаемая позиция по часам сервера: при игре — позиция на anchor плюс прошедшее время × скорость. */
export function positionAt(s: Playback, serverNow: number): number {
  if (s.paused) return s.position;
  return s.position + (Math.max(0, serverNow - s.anchor) / 1000) * s.rate;
}

/** «Заморозить» позицию на момент now — перед любым изменением сессии (design D4). */
export function freeze<T extends Playback>(s: T, now: number): T {
  return { ...s, position: positionAt(s, now), anchor: now };
}

export type ClockSample = { t0: number; server: number; t1: number };

/** Смещение часов сервера относительно клиента: медиана по замерам ping/pong (как в tg). */
export function clockOffset(samples: readonly ClockSample[]): number {
  if (samples.length === 0) return 0;
  const offsets = samples.map(({ t0, server, t1 }) => server - (t0 + (t1 - t0) / 2)).sort((a, b) => a - b);
  const mid = offsets.length >> 1;
  return offsets.length % 2 ? offsets[mid]! : (offsets[mid - 1]! + offsets[mid]!) / 2;
}

export function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
