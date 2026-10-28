import { useSyncExternalStore } from 'react';
import {
  clockOffset,
  type Cause,
  type ChatMessage,
  type ClientMessage,
  type ClockSample,
  type Member,
  type ServerMessage,
  type Session,
} from '@wtgt/shared';

/** Состояние связи с комнатой: сессия, участники, ошибки команд (spec synced-playback, rooms). */
export type Net = {
  room: string | null;
  online: boolean;
  session: Session | null;
  /** что изменило сессию последним и кто — для подсказки поверх видео */
  cause: Cause | null;
  by: string | null;
  members: Member[];
  /** id этого соединения в members */
  you: string | null;
  /** id всех своих соединений за визит — чтобы свои сообщения оставались своими после переподключения */
  mine: string[];
  chat: ChatMessage[];
  error: { message: string; at: number } | null;
};

/** Столько сообщений чата держим в памяти вкладки. */
const CHAT_KEEP = 200;
/** Сколько последних ping/pong держим для медианы смещения часов. */
const CLOCK_SAMPLES = 5;
const PING_MS = 5_000;
/** Нет pong дольше — соединение мёртвое, даже если сокет считает себя открытым. */
const DEAD_MS = 12_000;
const BACKOFF_MIN_MS = 500;
const BACKOFF_MAX_MS = 5_000;

const initial: Net = {
  room: null,
  online: false,
  session: null,
  cause: null,
  by: null,
  members: [],
  you: null,
  mine: [],
  chat: [],
  error: null,
};
let state: Net = initial;
const subs = new Set<() => void>();
let ws: WebSocket | null = null;
let backoff = BACKOFF_MIN_MS;
let offset = 0;
let samples: ClockSample[] = [];
let lastPong = 0;
let pingTimer: ReturnType<typeof setInterval> | undefined;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
/** ник после «Присоединиться» — повторяем его при каждом переподключении */
let helloName: string | null = null;

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

/** Представиться в комнате (и сменить ник); запоминается до выхода из комнаты. */
export function hello(name: string): void {
  helloName = name;
  send({ type: 'hello', name });
}

/** Сообщение в чат комнаты; false — нет связи. */
export const say = (text: string): boolean => send({ type: 'chat', text });

function onMessage(msg: ServerMessage): void {
  switch (msg.type) {
    case 'state':
      return set({ session: msg.session, cause: msg.cause, by: msg.by });
    case 'members':
      return set({
        members: msg.members,
        you: msg.you,
        mine: state.mine.includes(msg.you) ? state.mine : [...state.mine, msg.you],
      });
    case 'chat':
      return set({ chat: msg.history ? msg.messages : [...state.chat, ...msg.messages].slice(-CHAT_KEEP) });
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
  retryTimer = setTimeout(open, backoff);
  backoff = Math.min(BACKOFF_MAX_MS, backoff * 2);
}

function open(): void {
  clearTimeout(retryTimer);
  if (ws || !state.room) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const sock = new WebSocket(`${proto}://${location.host}/ws?room=${encodeURIComponent(state.room)}`);
  ws = sock;
  sock.onopen = () => {
    if (ws !== sock) return;
    backoff = BACKOFF_MIN_MS;
    lastPong = Date.now();
    samples = [];
    set({ online: true });
    if (helloName) send({ type: 'hello', name: helloName });
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

/** Подключиться к комнате; прежнее соединение и состояние сбрасываются. */
export function enterRoom(code: string): void {
  if (state.room === code) return;
  leaveRoom();
  set({ ...initial, room: code });
  open();
}

export function leaveRoom(): void {
  clearTimeout(retryTimer);
  clearInterval(pingTimer);
  helloName = null;
  const sock = ws;
  ws = null;
  if (sock) {
    sock.onopen = sock.onclose = sock.onmessage = null;
    sock.close();
  }
  set(initial);
}

// вернулись в сеть или во вкладку — переподключаемся сразу, без ожидания backoff
const kick = () => {
  if (ws || !state.room) return;
  backoff = BACKOFF_MIN_MS;
  open();
};
window.addEventListener('online', kick);
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && kick());

function subscribe(f: () => void): () => void {
  subs.add(f);
  return () => subs.delete(f);
}

export const useNet = (): Net => useSyncExternalStore(subscribe, () => state);
export const getNet = (): Net => state;
