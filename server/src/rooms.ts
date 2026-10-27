import { isRoomCode, newRoomCode } from '@wtgt/shared';
import type { Catalog } from './anilibria';
import { Hub, type Client } from './hub';

type Options = {
  /** пустая комната живёт столько, потом удаляется (spec rooms) */
  emptyTtlMs?: number;
  max?: number;
};

type Room = { hub: Hub; timer?: ReturnType<typeof setTimeout> };

/** Комнаты в памяти: код → сессия. Неизвестный код создаёт комнату заново (design D10). */
export class Rooms {
  private readonly rooms = new Map<string, Room>();
  private readonly emptyTtlMs: number;
  private readonly max: number;

  constructor(
    private readonly catalog: Catalog,
    private readonly defaultAlias: string,
    { emptyTtlMs = 30 * 60_000, max = 200 }: Options = {},
  ) {
    this.emptyTtlMs = emptyTtlMs;
    this.max = max;
  }

  get size(): number {
    return this.rooms.size;
  }

  has(code: string): boolean {
    return this.rooms.has(code);
  }

  hub(code: string): Hub | undefined {
    return this.rooms.get(code)?.hub;
  }

  /** Новая комната со свободным кодом; null — достигнут лимит. */
  create(): string | null {
    if (this.rooms.size >= this.max) return null;
    let code = newRoomCode();
    while (this.rooms.has(code)) code = newRoomCode();
    this.open(code);
    return code;
  }

  /** Подключить клиента к комнате (создав её по коду при необходимости); null — неверный код или лимит. */
  join(code: string, client: Client): Hub | null {
    if (!isRoomCode(code)) return null;
    const room = this.rooms.get(code) ?? (this.rooms.size < this.max ? this.open(code) : null);
    if (!room) return null;
    clearTimeout(room.timer);
    room.timer = undefined;
    room.hub.join(client);
    return room.hub;
  }

  leave(code: string, client: Client): void {
    const room = this.rooms.get(code);
    if (!room) return;
    room.hub.leave(client);
    if (room.hub.size === 0) this.scheduleCleanup(code, room);
  }

  close(): void {
    for (const room of this.rooms.values()) clearTimeout(room.timer);
    this.rooms.clear();
  }

  private open(code: string): Room {
    const room: Room = { hub: new Hub(this.catalog, this.defaultAlias) };
    this.rooms.set(code, room);
    void room.hub.ensureEpisode();
    // комнату создали, но так никто и не зашёл — тоже убираем
    this.scheduleCleanup(code, room);
    return room;
  }

  private scheduleCleanup(code: string, room: Room): void {
    clearTimeout(room.timer);
    room.timer = setTimeout(() => {
      if (room.hub.size === 0 && this.rooms.get(code) === room) this.rooms.delete(code);
    }, this.emptyTtlMs);
    room.timer.unref?.();
  }
}
