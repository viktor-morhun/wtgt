import { useSyncExternalStore } from 'react';
import { isRoomCode, RATES, type Rate } from '@wtgt/shared';

/**
 * Комнаты, в которых зритель был: тайтл, серия и время — в браузере, без аккаунта.
 * По ним главная показывает «комнаты», а пересозданная комната продолжает с того же места.
 */
export type RoomEntry = {
  code: string;
  alias: string;
  title: string;
  poster: string | null;
  episodeId: string;
  /** номер серии для подписи */
  ordinal: number;
  /** секунды */
  position: number;
  /** длительность серии; 0 — неизвестна */
  duration: number;
  rate: Rate;
  /** озвучка (YummyAnime); null — у релиза нет выбора */
  dub: string | null;
  /** Date.now() последнего сохранения */
  at: number;
};

/**
 * История просмотра по тайтлам, в какой бы комнате ни смотрели: последняя серия и время,
 * и сколько просмотрено в каждой серии — для отметок в списке серий и «продолжить» на главной.
 */
export type TitleEntry = {
  alias: string;
  title: string;
  poster: string | null;
  episodeId: string;
  ordinal: number;
  position: number;
  duration: number;
  dub: string | null;
  at: number;
  /** id серии → просмотренная доля 0..1 */
  seen: Record<string, number>;
  /** сколько серий было у тайтла, когда смотрели; больше стало — «+1 серия» на главной */
  count: number | null;
};

/** Список в localStorage, общий для вкладок: свежие записи первыми, не больше max. */
function store<T extends { at: number }>(key: string, max: number, parse: (raw: unknown) => T | null) {
  const subs = new Set<() => void>();
  const load = (): T[] => {
    try {
      const raw = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown;
      return Array.isArray(raw)
        ? raw
            .flatMap((x) => {
              const e = parse(x);
              return e ? [e] : [];
            })
            .sort((a, b) => b.at - a.at)
            .slice(0, max)
        : [];
    } catch {
      return [];
    }
  };
  let current = load();
  const notify = () => {
    for (const f of subs) f();
  };
  // другая вкладка смотрит другую комнату — подхватываем её сохранения
  window.addEventListener('storage', (e) => {
    if (e.key !== key) return;
    current = load();
    notify();
  });
  const subscribe = (f: () => void) => {
    subs.add(f);
    return () => subs.delete(f);
  };
  return {
    parse,
    get: () => current,
    write(next: T[]) {
      current = next.slice(0, max);
      try {
        localStorage.setItem(key, JSON.stringify(current));
      } catch {
        // без хранилища история живёт до перезагрузки
      }
      notify();
    },
    use: () => useSyncExternalStore(subscribe, () => current),
  };
}

const str = (x: unknown): string | null => (typeof x === 'string' ? x : null);
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : null);

const rooms = store<RoomEntry>('wtgt.rooms', 20, (x) => {
  const r = (x ?? {}) as Record<string, unknown>;
  const code = str(r.code);
  const alias = str(r.alias);
  const title = str(r.title);
  const episodeId = str(r.episodeId);
  const [ordinal, position, duration, at] = [num(r.ordinal), num(r.position), num(r.duration), num(r.at)];
  if (!code || !isRoomCode(code) || !alias || title === null || !episodeId) return null;
  if (ordinal === null || position === null || duration === null || at === null) return null;
  if (!RATES.includes(r.rate as Rate)) return null;
  const rate = r.rate as Rate;
  return {
    code,
    alias,
    title,
    poster: str(r.poster),
    episodeId,
    ordinal,
    position,
    duration,
    rate,
    dub: str(r.dub),
    at,
  };
});

const titles = store<TitleEntry>('wtgt.history', 60, (x) => {
  const r = (x ?? {}) as Record<string, unknown>;
  const alias = str(r.alias);
  const title = str(r.title);
  const episodeId = str(r.episodeId);
  const [ordinal, position, duration, at] = [num(r.ordinal), num(r.position), num(r.duration), num(r.at)];
  if (!alias || title === null || !episodeId) return null;
  if (ordinal === null || position === null || duration === null || at === null) return null;
  const seen: Record<string, number> = {};
  if (r.seen && typeof r.seen === 'object') {
    for (const [id, v] of Object.entries(r.seen)) {
      const n = num(v);
      if (n !== null) seen[id] = Math.min(1, n);
    }
  }
  return {
    alias,
    title,
    poster: str(r.poster),
    episodeId,
    ordinal,
    position,
    duration,
    dub: str(r.dub),
    at,
    seen,
    count: num(r.count),
  };
});

export function saveRoom(entry: RoomEntry): void {
  rooms.write([entry, ...rooms.get().filter((e) => e.code !== entry.code)]);
}

export function removeRoom(code: string): void {
  rooms.write(rooms.get().filter((e) => e.code !== code));
}

export const getRoom = (code: string): RoomEntry | null => rooms.get().find((e) => e.code === code) ?? null;
export const useRooms = rooms.use;

/** Серия досмотрена, если позади столько её длительности (титры не в счёт). */
export const WATCHED = 0.9;

/** Запомнить, где тайтл: последняя серия и время, доля просмотренного в этой серии не уменьшается. */
export function saveTitle(entry: Omit<TitleEntry, 'seen'>): void {
  const prev = titles.get().find((e) => e.alias === entry.alias);
  const part = entry.duration > 0 ? Math.min(1, entry.position / entry.duration) : 0;
  const seen = { ...prev?.seen };
  // доли округляем — запись в localStorage короче
  seen[entry.episodeId] = Math.round(Math.max(seen[entry.episodeId] ?? 0, part) * 100) / 100;
  titles.write([{ ...entry, seen }, ...titles.get().filter((e) => e.alias !== entry.alias)]);
}

export function removeTitle(alias: string): void {
  titles.write(titles.get().filter((e) => e.alias !== alias));
}

export const useTitles = titles.use;

/** Комнаты и история этого браузера — для переноса на другое устройство кодом. */
export const exportHistory = () => ({ rooms: rooms.get(), history: titles.get() });

/**
 * Влить перенесённое с другого устройства: из двух записей одной комнаты или тайтла берём свежую,
 * просмотренные доли серий — наибольшие. Возвращает, сколько записей добавилось или обновилось.
 */
export function importHistory(data: { rooms?: unknown; history?: unknown }): number {
  let changed = 0;
  const list = (x: unknown) => (Array.isArray(x) ? x : []);

  const roomList = [...rooms.get()];
  for (const e of list(data.rooms).flatMap((x) => rooms.parse(x) ?? [])) {
    const i = roomList.findIndex((r) => r.code === e.code);
    if (i < 0) roomList.push(e);
    else if (roomList[i]!.at < e.at) roomList[i] = e;
    else continue;
    changed++;
  }
  rooms.write(roomList.sort((a, b) => b.at - a.at));

  const titleList = [...titles.get()];
  for (const e of list(data.history).flatMap((x) => titles.parse(x) ?? [])) {
    const i = titleList.findIndex((t) => t.alias === e.alias);
    const prev = titleList[i];
    if (!prev) {
      titleList.push(e);
      changed++;
      continue;
    }
    const seen = { ...prev.seen };
    for (const [id, v] of Object.entries(e.seen)) seen[id] = Math.max(seen[id] ?? 0, v);
    titleList[i] = { ...(prev.at < e.at ? e : prev), seen };
    changed++;
  }
  titles.write(titleList.sort((a, b) => b.at - a.at));
  return changed;
}
