import { newRoomCode } from '@wtgt/shared';

type Options = { ttlMs?: number; max?: number; now?: () => number };

/**
 * Перенос истории на другое устройство без аккаунта: одно устройство кладёт свои комнаты и историю
 * и получает код из 6 символов, другое забирает по коду. Живёт в памяти ttlMs.
 */
export class Transfers {
  private readonly items = new Map<string, { at: number; data: unknown }>();
  private readonly ttlMs: number;
  private readonly max: number;
  private readonly now: () => number;

  constructor({ ttlMs = 10 * 60_000, max = 500, now = Date.now }: Options = {}) {
    this.ttlMs = ttlMs;
    this.max = max;
    this.now = now;
  }

  /** Код для данных; null — слишком много переносов сразу. */
  put(data: unknown): string | null {
    this.sweep();
    if (this.items.size >= this.max) return null;
    let code = newRoomCode();
    while (this.items.has(code)) code = newRoomCode();
    this.items.set(code, { at: this.now(), data });
    return code;
  }

  get(code: string): unknown {
    this.sweep();
    return this.items.get(code)?.data;
  }

  private sweep(): void {
    const now = this.now();
    for (const [code, item] of this.items) if (now - item.at >= this.ttlMs) this.items.delete(code);
  }
}
