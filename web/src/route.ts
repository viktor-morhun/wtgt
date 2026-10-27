import { useSyncExternalStore } from 'react';
import { isRoomCode } from '@wtgt/shared';

/** Два адреса: `/` — главная, `/r/<код>` — комната (design D10). */
export type Route = { kind: 'home' } | { kind: 'room'; code: string };

const subs = new Set<() => void>();

function parse(path: string): Route {
  const m = path.match(/^\/r\/([^/]+)\/?$/);
  return m && isRoomCode(m[1]!) ? { kind: 'room', code: m[1]! } : { kind: 'home' };
}

let current = parse(location.pathname);

function update(): void {
  const next = parse(location.pathname);
  if (
    next.kind === current.kind &&
    (next.kind === 'home' || next.code === (current as { code: string }).code)
  )
    return;
  current = next;
  for (const f of subs) f();
}

window.addEventListener('popstate', update);

export function navigate(path: string): void {
  history.pushState(null, '', path);
  update();
}

export const roomPath = (code: string) => `/r/${code}`;

function subscribe(f: () => void): () => void {
  subs.add(f);
  return () => subs.delete(f);
}

export const useRoute = (): Route => useSyncExternalStore(subscribe, () => current);
