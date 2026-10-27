import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { ClientMessage, ServerMessage, Session } from '@wtgt/shared';
import { CatalogError, normalizeRelease, type Catalog } from '../src/anilibria';
import { buildApp } from '../src/app';

const release = normalizeRelease(
  JSON.parse(readFileSync(new URL('./fixtures/tokyo-revengers.json', import.meta.url), 'utf8')),
);
const okCatalog: Catalog = {
  get: async (alias) => {
    if (alias === 'tokyo-revengers') return release;
    if (alias === 'other') return { ...release, alias: 'other', title: 'Другой' };
    throw new CatalogError('not_found', 'Релиз не найден');
  },
};

type Pred = (m: ServerMessage) => boolean;
type Conn = {
  send(msg: ClientMessage): void;
  /** следующее подходящее сообщение (уже пришедшее или будущее); забирает его из лога */
  next(pred: Pred, timeoutMs?: number): Promise<ServerMessage>;
  log: ServerMessage[];
  close(): void;
};

let apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  await Promise.all(apps.map((a) => a.close()));
  apps = [];
});

async function start(catalog = okCatalog) {
  const app = await buildApp({ catalog, defaultRelease: 'tokyo-revengers' });
  apps.push(app);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as AddressInfo;
  await app.hub.ensureEpisode();
  return { app, url: `ws://127.0.0.1:${port}/ws`, http: `http://127.0.0.1:${port}` };
}

function connect(url: string): Promise<Conn> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const log: ServerMessage[] = [];
    const waiters: { pred: Pred; done: (m: ServerMessage) => void }[] = [];
    const take = (m: ServerMessage) => log.splice(log.indexOf(m), 1);
    ws.on('message', (d) => {
      const m = JSON.parse(String(d)) as ServerMessage;
      log.push(m);
      const w = waiters.find((w) => w.pred(m));
      if (w) {
        waiters.splice(waiters.indexOf(w), 1);
        take(m);
        w.done(m);
      }
    });
    ws.on('error', reject);
    ws.on('open', () =>
      resolve({
        log,
        send: (msg) => ws.send(JSON.stringify(msg)),
        close: () => ws.close(),
        next: (pred, timeoutMs = 2000) => {
          const seen = log.find(pred);
          if (seen) {
            take(seen);
            return Promise.resolve(seen);
          }
          return new Promise((done, fail) => {
            const t = setTimeout(() => fail(new Error('timeout')), timeoutMs);
            waiters.push({ pred, done: (m) => (clearTimeout(t), done(m)) });
          });
        },
      }),
    );
  });
}

const state =
  (cause?: string): Pred =>
  (m) =>
    m.type === 'state' && (!cause || m.cause === cause);
const sessionOf = (m: ServerMessage): Session => {
  if (m.type !== 'state') throw new Error(`ожидали state, пришло ${m.type}`);
  return m.session;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('общая сессия по WS', () => {
  it('начальное состояние: первая серия, пауза, 0, 1x', async () => {
    const { url } = await start();
    const a = await connect(url);
    expect(sessionOf(await a.next(state('join')))).toMatchObject({
      alias: 'tokyo-revengers',
      episodeId: release.episodes[0]!.id,
      paused: true,
      position: 0,
      rate: 1,
    });
    a.close();
  });

  it('пауза от A приходит B, viewers = 2', async () => {
    const { url } = await start();
    const a = await connect(url);
    const b = await connect(url);
    await b.next((m) => m.type === 'viewers' && m.count === 2);
    a.send({ type: 'play' });
    await b.next(state('play'));
    a.send({ type: 'pause', position: 0.4 });
    const s = sessionOf(await b.next(state('pause')));
    expect(s.paused).toBe(true);
    expect(s.position).toBeCloseTo(0.4, 1);
    a.close();
    b.close();
  });

  it('перемотка, скорость и смена серии рассылаются всем', async () => {
    const { url } = await start();
    const a = await connect(url);
    const b = await connect(url);
    a.send({ type: 'seek', position: 900 });
    expect(sessionOf(await b.next(state('seek'))).position).toBe(900);
    b.send({ type: 'rate', rate: 2 });
    expect(sessionOf(await a.next(state('rate'))).rate).toBe(2);
    const ep5 = release.episodes[4]!.id;
    a.send({ type: 'episode', episodeId: ep5 });
    expect(sessionOf(await b.next(state('episode')))).toMatchObject({
      episodeId: ep5,
      position: 0,
      paused: true,
      rate: 2,
    });
    a.close();
    b.close();
  });

  it('двойной ended переключает серию один раз и запускает её', async () => {
    const { url, app } = await start();
    const a = await connect(url);
    const b = await connect(url);
    a.send({ type: 'episode', episodeId: release.episodes[2]!.id });
    await a.next(state('episode'));
    a.send({ type: 'play' });
    await a.next(state('play'));
    const { episodeId, version } = app.hub.session;
    a.send({ type: 'ended', episodeId: episodeId!, version });
    b.send({ type: 'ended', episodeId: episodeId!, version });
    expect(sessionOf(await b.next(state('next')))).toMatchObject({
      episodeId: release.episodes[3]!.id,
      paused: false,
      position: 0,
    });
    await sleep(100);
    expect(b.log.filter(state('next'))).toHaveLength(0);
    expect(app.hub.session.episodeId).toBe(release.episodes[3]!.id);
    a.close();
    b.close();
  });

  it('конец последней серии — пауза', async () => {
    const { url, app } = await start();
    const a = await connect(url);
    a.send({ type: 'episode', episodeId: release.episodes.at(-1)!.id });
    await a.next(state('episode'));
    a.send({ type: 'play' });
    await a.next(state('play'));
    a.send({ type: 'ended', episodeId: app.hub.session.episodeId!, version: app.hub.session.version });
    expect(sessionOf(await a.next(state('end'))).paused).toBe(true);
    a.close();
  });

  it('смена релиза ссылкой; неизвестный релиз — ошибка только отправителю', async () => {
    const { url } = await start();
    const a = await connect(url);
    const b = await connect(url);
    a.send({ type: 'release', input: 'https://anilibria.tv/release/nope.html' });
    expect(await a.next((m) => m.type === 'error')).toMatchObject({
      code: 'not_found',
      message: 'Релиз не найден',
    });
    b.send({ type: 'release', input: 'https://anilibria.tv/release/other.html' });
    expect(sessionOf(await a.next(state('release')))).toMatchObject({
      alias: 'other',
      paused: true,
      position: 0,
    });
    expect(b.log.some((m) => m.type === 'error')).toBe(false);
    a.close();
    b.close();
  });

  it('все ушли во время игры — сессия встаёт на паузу', async () => {
    const { url, app } = await start();
    const a = await connect(url);
    a.send({ type: 'play' });
    await a.next(state('play'));
    a.close();
    await sleep(100);
    expect(app.hub.session.paused).toBe(true);
  });

  it('ping → pong с часами сервера', async () => {
    const { url } = await start();
    const a = await connect(url);
    a.send({ type: 'ping', t0: 123 });
    expect(await a.next((m) => m.type === 'pong')).toMatchObject({ t0: 123 });
    a.close();
  });

  it('AniLibria недоступна на старте: сервер жив, команды управления игнорируются', async () => {
    const { url, http } = await start({
      get: async () => {
        throw new CatalogError('unavailable', 'AniLibria не отвечает');
      },
    });
    expect(await (await fetch(`${http}/healthz`)).json()).toEqual({ ok: true });
    expect((await fetch(`${http}/api/release/tokyo-revengers`)).status).toBe(502);
    const a = await connect(url);
    expect(sessionOf(await a.next(state('join'))).episodeId).toBeNull();
    a.send({ type: 'play' });
    await sleep(100);
    expect(a.log.filter(state('play'))).toHaveLength(0);
    a.close();
  });
});
