import { navigate, roomPath } from './route';
import { getSettings } from './settings';

/**
 * Комната, которую этот зритель только что создал или выбрал на главной:
 * в неё входим сразу, без экрана «Присоединиться».
 */
const CREATED_KEY = 'wtgt.created';

/** С чего начать новую комнату: тайтл и, если продолжаем из истории, серия и время. */
export type Start = { alias: string; episodeId?: string; position?: number };

/** Новая комната — пустая или сразу с тайтлом; возвращает код. */
export async function createRoom(start?: Start): Promise<string> {
  let res: Response;
  try {
    res = await fetch('/api/rooms', {
      method: 'POST',
      headers: start ? { 'content-type': 'application/json' } : undefined,
      body: start ? JSON.stringify(start) : undefined,
    });
  } catch {
    throw new Error('Нет связи с сервером');
  }
  const body = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
  if (!res.ok || !body?.code) throw new Error(body?.message ?? 'Не получилось создать комнату');
  return body.code;
}

/** Перейти в комнату и войти в неё сразу под сохранённым ником. */
export function openRoom(code: string): void {
  try {
    sessionStorage.setItem(CREATED_KEY, code);
  } catch {
    // без хранилища просто нажмёт «Присоединиться»
  }
  navigate(roomPath(code));
}

/** Пришли в комнату с главной — входим сразу под сохранённым ником. */
export function takeCreated(code: string): boolean {
  try {
    if (sessionStorage.getItem(CREATED_KEY) !== code) return false;
    sessionStorage.removeItem(CREATED_KEY);
    return !!getSettings().name.trim();
  } catch {
    return false;
  }
}
