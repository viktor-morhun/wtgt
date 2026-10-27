import { useSyncExternalStore } from 'react';
import {
  clockOffset,
  type Cause,
  type ClientMessage,
  type ClockSample,
  type ServerMessage,
  type Session,
} from '@wtgt/shared';

/** Состояние связи с сервером: сессия, зрители, ошибки команд (spec synced-playback). */
export type Net = {
  online: boolean;
  session: Session | null;
  /** что изменило сессию последним — для подсказки поверх видео */
  cause: Cause | null;
  viewers: number;
  error: { message: string; at: number } | null;
};

/** Сколько последних ping/pong держим для медианы смещения часов. */
const CLOCK_SAMPLES = 5;
const PING_MS = 5_000;
/** Нет pong дольше — соединение мёртвое, даже если сокет считает себя открытым. */
const DEAD_MS = 12_000;
const BACKOFF_MIN_MS = 500;
const BACKOFF_MAX_MS = 5_000;

let state: Net = { online: false, session: null, cause: null, viewers: 0, error: null };
const subs = new Set<() => void>();
let ws: WebSocket | null = null;
let backoff = BACKOFF_MIN_MS;
let offset = 0;
let samples: ClockSample[] = [];
let lastPong = 0;
let pingTimer: ReturnType<typeof setInterval> | undefined;
let retryTimer: ReturnType<typeof setTimeout> | undefined;

function set(patch: Partial<Net>): void {
  state = { ...state, ...patch };
  for (const f of subs) f();
}

/** Часы сервера по смещению, найденному ping/pong. */
export const serverNow = (): number => Date.now() + offset;

export function send(msg: ClientMessage): boolean {
  if (!ws || ws.readyState !== WebSocket.OPEN || !state.online) return false;
  ws.send(JSON.stringify(msg));
  return true;
}

const ping = () => send({ type: 'ping', t0: Date.now() });

function onMessage(msg: ServerMessage): void {
  switch (msg.type) {
    case 'state':
      return set({ session: msg.session, cause: msg.cause });
    case 'viewers':
      return set({ viewers: msg.count });
    case 'pong':
      lastPong = Date.now();
      samples = [...samples, { t0: msg.t0, server: msg.server, t1: lastPong }].slice(-CLOCK_SAMPLES);
      offset = clockOffset(samples);
      return;
    case 'error':
      return set({ error: { message: msg.message, at: Date.now() } });
  }
}

function drop(sock: WebSocket): void {
  if (ws !== sock) return;
  ws = null;
  sock.onclose = sock.onmessage = null;
  sock.close();
  clearInterval(pingTimer);
  set({ online: false });
  retryTimer = setTimeout(connect, backoff);
  backoff = Math.min(BACKOFF_MAX_MS, backoff * 2);
}

export function connect(): void {
  clearTimeout(retryTimer);
  if (ws) return;
  const sock = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws = sock;
  sock.onopen = () => {
    backoff = BACKOFF_MIN_MS;
    lastPong = Date.now();
    samples = [];
    set({ online: true });
    // первые замеры часов — сразу пачкой, дальше ping заодно служит проверкой связи
    for (let i = 0; i < CLOCK_SAMPLES; i++) setTimeout(ping, i * 150);
    clearInterval(pingTimer);
    pingTimer = setInterval(() => (Date.now() - lastPong > DEAD_MS ? drop(sock) : ping()), PING_MS);
  };
  sock.onmessage = (e) => {
    try {
      onMessage(JSON.parse(String(e.data)) as ServerMessage);
    } catch {
      // битое сообщение пропускаем
    }
  };
  sock.onclose = () => drop(sock);
}

// вернулись в сеть или во вкладку — переподключаемся сразу, без ожидания backoff
const kick = () => {
  if (ws) return;
  backoff = BACKOFF_MIN_MS;
  connect();
};
window.addEventListener('online', kick);
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && kick());

function subscribe(f: () => void): () => void {
  subs.add(f);
  return () => subs.delete(f);
}

export const useNet = (): Net => useSyncExternalStore(subscribe, () => state);
export const getNet = (): Net => state;
