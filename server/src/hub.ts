import {
  freeze,
  parseAlias,
  type Cause,
  type ClientMessage,
  type ErrorCode,
  type Release,
  type ServerMessage,
  type Session,
} from '@wtgt/shared';
import { CatalogError, isPlayable, type Catalog } from './anilibria';

export type Client = { send(msg: ServerMessage): void };

/** Позиция паузы от клиента берётся, если она не дальше этого от расчётной (design D4). */
const PAUSE_TRUST_S = 2;

/** Единая общая сессия просмотра: состояние в памяти, рассылка всем подключённым. */
export class Hub {
  session: Session;
  private readonly clients = new Set<Client>();

  constructor(
    private readonly catalog: Catalog,
    defaultAlias: string,
    private readonly now: () => number = Date.now,
  ) {
    this.session = {
      alias: defaultAlias,
      episodeId: null,
      paused: true,
      position: 0,
      anchor: now(),
      rate: 1,
      version: 0,
    };
  }

  get viewers(): number {
    return this.clients.size;
  }

  /** Подставить первую серию, если релиз ещё не загружался (старт при недоступной AniLibria). */
  async ensureEpisode(): Promise<void> {
    if (this.session.episodeId) return;
    const alias = this.session.alias;
    let release: Release;
    try {
      release = await this.catalog.get(alias);
    } catch {
      return;
    }
    const first = release.episodes.find(isPlayable);
    if (!first || this.session.episodeId || this.session.alias !== alias) return;
    this.commit({ ...this.session, episodeId: first.id, position: 0, paused: true }, 'release');
  }

  join(client: Client): void {
    this.clients.add(client);
    client.send({ type: 'state', session: this.session, cause: 'join' });
    this.broadcastViewers();
    void this.ensureEpisode();
  }

  leave(client: Client): void {
    if (!this.clients.delete(client)) return;
    // никого не осталось — ставим на паузу, чтобы при возвращении не убежать на полсерии вперёд
    if (this.clients.size === 0 && !this.session.paused) {
      this.commit({ ...freeze(this.session, this.now()), paused: true }, 'pause');
    }
    this.broadcastViewers();
  }

  async handle(client: Client, msg: ClientMessage): Promise<void> {
    const s = this.session;
    switch (msg.type) {
      case 'ping':
        client.send({ type: 'pong', t0: msg.t0, server: this.now() });
        return;
      case 'release':
        return this.switchRelease(client, msg.input);
    }
    if (!s.episodeId) return; // релиз не загружен — управлять нечем

    switch (msg.type) {
      case 'play':
        this.commit({ ...freeze(s, this.now()), paused: false }, 'play');
        return;
      case 'pause': {
        const f = freeze(s, this.now());
        const position = Math.abs(msg.position - f.position) <= PAUSE_TRUST_S ? msg.position : f.position;
        this.commit({ ...f, paused: true, position }, 'pause');
        return;
      }
      case 'seek':
        this.commit({ ...freeze(s, this.now()), position: msg.position }, 'seek');
        return;
      case 'rate':
        this.commit({ ...freeze(s, this.now()), rate: msg.rate }, 'rate');
        return;
      case 'episode': {
        const release = await this.release(client);
        if (!release) return;
        const ep = release.episodes.find((e) => e.id === msg.episodeId);
        if (!ep || !isPlayable(ep)) return this.error(client, 'bad_request', 'Серия недоступна');
        if (this.session.alias !== release.alias) return;
        this.commit(
          { ...this.session, episodeId: ep.id, position: 0, paused: true, anchor: this.now() },
          'episode',
        );
        return;
      }
      case 'ended':
        return this.ended(msg.episodeId, msg.version);
    }
  }

  /** Конец серии: следующая играет сразу; дубли от других клиентов отсекаются по version. */
  private async ended(episodeId: string, version: number): Promise<void> {
    const fresh = () => this.session.episodeId === episodeId && this.session.version === version;
    if (!fresh() || this.session.paused) return;
    let release: Release;
    try {
      release = await this.catalog.get(this.session.alias);
    } catch {
      return;
    }
    if (!fresh()) return;
    const i = release.episodes.findIndex((e) => e.id === episodeId);
    const next = release.episodes.slice(i + 1).find(isPlayable);
    const now = this.now();
    if (i >= 0 && next) {
      this.commit({ ...this.session, episodeId: next.id, position: 0, paused: false, anchor: now }, 'next');
    } else {
      const f = freeze(this.session, now);
      const duration = release.episodes[i]?.duration || f.position;
      this.commit({ ...f, paused: true, position: Math.min(f.position, duration) }, 'end');
    }
  }

  private async switchRelease(client: Client, input: string): Promise<void> {
    const alias = parseAlias(input);
    if (!alias) return this.error(client, 'not_found', 'Релиз не найден');
    let release: Release;
    try {
      release = await this.catalog.get(alias);
    } catch (e) {
      const err = e instanceof CatalogError ? e : new CatalogError('unavailable', 'AniLibria не отвечает');
      return this.error(client, err.code, err.message);
    }
    const first = release.episodes.find(isPlayable);
    if (!first) return this.error(client, 'not_found', 'В релизе нет доступных серий');
    this.commit(
      {
        ...this.session,
        alias: release.alias,
        episodeId: first.id,
        position: 0,
        paused: true,
        anchor: this.now(),
      },
      'release',
    );
  }

  private async release(client: Client): Promise<Release | null> {
    try {
      return await this.catalog.get(this.session.alias);
    } catch (e) {
      const err = e instanceof CatalogError ? e : new CatalogError('unavailable', 'AniLibria не отвечает');
      this.error(client, err.code, err.message);
      return null;
    }
  }

  private commit(next: Session, cause: Cause): void {
    this.session = { ...next, version: this.session.version + 1 };
    this.broadcast({ type: 'state', session: this.session, cause });
  }

  private error(client: Client, code: ErrorCode, message: string): void {
    client.send({ type: 'error', code, message });
  }

  private broadcastViewers(): void {
    this.broadcast({ type: 'viewers', count: this.clients.size });
  }

  private broadcast(msg: ServerMessage): void {
    for (const c of this.clients) c.send(msg);
  }
}
