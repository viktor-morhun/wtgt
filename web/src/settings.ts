import { useSyncExternalStore } from 'react';
import { NAME_MAX, QUALITIES, type Quality } from '@wtgt/shared';

/** Личные настройки зрителя: громкость, качество и ник — в браузере, не синхронизируются (design D7). */
export type Settings = { volume: number; muted: boolean; quality: Quality; name: string };

const KEY = 'wtgt.settings';
const subs = new Set<() => void>();

function load(): Settings {
  const fallback: Settings = { volume: 1, muted: false, quality: 720, name: '' };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Settings> | null;
    if (!raw) return fallback;
    return {
      volume: typeof raw.volume === 'number' ? Math.min(1, Math.max(0, raw.volume)) : fallback.volume,
      muted: raw.muted === true,
      quality: QUALITIES.includes(raw.quality as Quality) ? (raw.quality as Quality) : fallback.quality,
      name: typeof raw.name === 'string' ? raw.name.slice(0, NAME_MAX) : fallback.name,
    };
  } catch {
    return fallback;
  }
}

let current = load();

export function setSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // без хранилища настройки живут до перезагрузки
  }
  for (const f of subs) f();
}

export const getSettings = (): Settings => current;

function subscribe(f: () => void): () => void {
  subs.add(f);
  return () => subs.delete(f);
}

export const useSettings = (): Settings => useSyncExternalStore(subscribe, () => current);
