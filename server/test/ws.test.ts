import { mkdtempSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { ClientMessage, ServerMessage, Session } from '@wtgt/shared';
import { CatalogError, normalizeRelease, type Catalog } from '../src/anilibria';
import { buildApp, WS_CLOSE_NO_ROOM } from '../src/app';

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

async function start(catalog = okCatalog, opts: Partial<Parameters<typeof buildApp>[0]> = {}) {
  const app = await buildApp({ catalog, defaultRelease: 'tokyo-revengers', ...opts });
  apps.push(app);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as AddressInfo;
  const http = `http://127.0.0.1:${port}`;
  const room = async () => {
    const { code } = (await (await fetch(`${http}/api/rooms`, { method: 'POST' })).json()) as {
      code: string;
    };
    await app.rooms.hub(code)!.ensureEpisode();
    return code;
  };
  return { app, http, room, url: (code: string) => `ws://127.0.0.1:${port}/ws?room=${code}` };
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
const names =
  (...expected: string[]): Pred =>
  (m) =>
    m.type === 'members' && m.members.map((x) => x.name).join(',') === expected.join(',');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('комната по WS', () => {
  it('новая комната: первая серия, пауза, 0, 1x', async () => {
    const { url, room } = await start();
    const a = await connect(url(await room()));
    expect(sessionOf(await a.next(state('join')))).toMatchObject({
      alias: 'tokyo-revengers',
      episodeId: release.episodes[0]!.id,
      paused: true,
      position: 0,
      rate: 1,
    });
    a.close();
  });

  it('ники: в members только представившиеся, смена ника видна всем', async () => {
    const { url, room } = await start();
    const code = await room();
    const a = await connect(url(code));
    const b = await connect(url(code));
    await a.next(names());
    a.send({ type: 'hello', name: '  Витя ' });
    await b.next(names('Витя'));
    b.send({ type: 'hello', name: 'Вика' });
    await a.next(names('Витя', 'Вика'));
    b.send({ type: 'hello', name: 'Виктория' });
    await a.next(names('Витя', 'Виктория'));
    b.close();
    await a.next(names('Витя'));
    a.close();
  });

  it('чат: только представившимся, рассылается всем, история новым, не чаще 5 за 5 с', async () => {
    const { url, room } = await start();
    const code = await room();
    const a = await connect(url(code));
    expect(await a.next((m) => m.type === 'chat')).toMatchObject({ messages: [], history: true });
    a.send({ type: 'chat', text: 'привет' });
    expect(await a.next((m) => m.type === 'error')).toMatchObject({ code: 'bad_request' });

    a.send({ type: 'hello', name: 'Витя' });
    await a.next(names('Витя'));
    a.send({ type: 'chat', text: '  привет  ' });
    const sent = await a.next((m) => m.type === 'chat');
    expect(sent).toMatchObject({ history: false, messages: [{ from: 'Витя', text: 'привет' }] });

    const b = await connect(url(code));
    const history = await b.next((m) => m.type === 'chat');
    expect(history).toMatchObject({ history: true, messages: [{ from: 'Витя', text: 'привет' }] });

    for (let i = 0; i < 5; i++) a.send({ type: 'chat', text: `${i}` });
    expect(await a.next((m) => m.type === 'error')).toMatchObject({ code: 'too_fast' });
    const got = [];
    for (let i = 0; i < 4; i++) got.push(await b.next((m) => m.type === 'chat'));
    expect(got.map((m) => m.type === 'chat' && m.messages[0]!.text)).toEqual(['0', '1', '2', '3']);
    a.close();
    b.close();
  });

  it('пауза от B приходит A с автором', async () => {
    const { url, room } = await start();
    const code = await room();
    const a = await connect(url(code));
    const b = await connect(url(code));
    b.send({ type: 'hello', name: 'Вика' });
    b.send({ type: 'play' });
    expect(await a.next(state('play'))).toMatchObject({ by: 'Вика' });
    b.send({ type: 'pause', position: 0.4 });
    const m = await a.next(state('pause'));
    expect(m).toMatchObject({ by: 'Вика' });
    expect(sessionOf(m).position).toBeCloseTo(0.4, 1);
    a.close();
    b.close();
  });

  it('комнаты изолированы', async () => {
    const { url, room, app } = await start();
    const [c1, c2] = [await room(), await room()];
    expect(c1).not.toBe(c2);
    const a = await connect(url(c1));
    const b = await connect(url(c2));
    a.send({ type: 'play' });
    await a.next(state('play'));
    await sleep(100);
    expect(b.log.filter(state('play'))).toHaveLength(0);
    expect(app.rooms.hub(c2)!.session.paused).toBe(true);
    a.close();
    b.close();
  });

  it('перемотка, скорость и смена серии рассылаются всем', async () => {
    const { url, room } = await start();
    const code = await room();
    const a = await connect(url(code));
    const b = await connect(url(code));
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
    const { url, room, app } = await start();
    const code = await room();
    const hub = app.rooms.hub(code)!;
    const a = await connect(url(code));
    const b = await connect(url(code));
    a.send({ type: 'episode', episodeId: release.episodes[2]!.id });
    await a.next(state('episode'));
    a.send({ type: 'play' });
    await a.next(state('play'));
    const { episodeId, version } = hub.session;
    a.send({ type: 'ended', episodeId: episodeId!, version });
    b.send({ type: 'ended', episodeId: episodeId!, version });
    expect(await b.next(state('next'))).toMatchObject({
      by: null,
      session: { episodeId: release.episodes[3]!.id, paused: false, position: 0 },
    });
    await sleep(100);
    expect(b.log.filter(state('next'))).toHaveLength(0);
    a.close();
    b.close();
  });

  it('конец последней серии — пауза', async () => {
    const { url, room, app } = await start();
    const code = await room();
    const hub = app.rooms.hub(code)!;
    const a = await connect(url(code));
    a.send({ type: 'episode', episodeId: release.episodes.at(-1)!.id });
    await a.next(state('episode'));
    a.send({ type: 'play' });
    await a.next(state('play'));
    a.send({ type: 'ended', episodeId: hub.session.episodeId!, version: hub.session.version });
    expect(sessionOf(await a.next(state('end'))).paused).toBe(true);
    a.close();
  });

  it('смена релиза ссылкой; неизвестный релиз — ошибка только отправителю', async () => {
    const { url, room } = await start();
    const code = await room();
    const a = await connect(url(code));
    const b = await connect(url(code));
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

  it('неизвестный код создаёт комнату заново; неверный код — закрытие', async () => {
    const { url, app } = await start();
    const a = await connect(url('zzzzzz'));
    await a.next(state('join'));
    expect(app.rooms.has('zzzzzz')).toBe(true);
    a.close();
    const closed = await new Promise<number>((resolve) => {
      const ws = new WebSocket(url('NOPE'));
      ws.on('close', (code) => resolve(code));
    });
    expect(closed).toBe(WS_CLOSE_NO_ROOM);
  });

  it('restore: пересозданная комната продолжает с сохранённых серии и времени, только пока её не трогали', async () => {
    const { url, app } = await start();
    const a = await connect(url('zzzzzz'));
    await a.next(state('join'));
    await app.rooms.hub('zzzzzz')!.ensureEpisode();
    const ep5 = release.episodes[4]!.id;
    a.send({ type: 'restore', alias: 'other', episodeId: ep5, position: 600, rate: 1.5 });
    expect(await a.next(state('restore'))).toMatchObject({
      by: null,
      session: { alias: 'other', episodeId: ep5, position: 600, paused: true, rate: 1.5 },
    });
    // второй зритель со своим сохранённым временем ничего не перебивает
    const b = await connect(url('zzzzzz'));
    b.send({ type: 'restore', alias: 'tokyo-revengers', episodeId: ep5, position: 10, rate: 1 });
    await sleep(100);
    expect(b.log.filter(state('restore'))).toHaveLength(0);
    expect(app.rooms.hub('zzzzzz')!.session).toMatchObject({ alias: 'other', position: 600 });
    a.close();
    b.close();
  });

  it('restore после действий зрителей игнорируется', async () => {
    const { url, room, app } = await start();
    const code = await room();
    const a = await connect(url(code));
    a.send({ type: 'seek', position: 30 });
    await a.next(state('seek'));
    a.send({ type: 'restore', alias: 'other', episodeId: release.episodes[4]!.id, position: 600, rate: 1 });
    await sleep(100);
    expect(a.log.filter(state('restore'))).toHaveLength(0);
    expect(app.rooms.hub(code)!.session).toMatchObject({ alias: 'tokyo-revengers', position: 30 });
    a.close();
  });

  it('все ушли во время игры — пауза; пустая комната удаляется по таймауту', async () => {
    const { url, room, app } = await start(okCatalog, { rooms: { emptyTtlMs: 150 } });
    const code = await room();
    const a = await connect(url(code));
    a.send({ type: 'play' });
    await a.next(state('play'));
    a.close();
    await sleep(60);
    expect(app.rooms.hub(code)!.session.paused).toBe(true);
    await sleep(200);
    expect(app.rooms.has(code)).toBe(false);
  });

  it('ping → pong с часами сервера', async () => {
    const { url, room } = await start();
    const a = await connect(url(await room()));
    a.send({ type: 'ping', t0: 123 });
    expect(await a.next((m) => m.type === 'pong')).toMatchObject({ t0: 123 });
    a.close();
  });

  it('AniLibria недоступна: сервер жив, команды управления игнорируются', async () => {
    const { url, room, http } = await start({
      get: async () => {
        throw new CatalogError('unavailable', 'AniLibria не отвечает');
      },
    });
    expect(await (await fetch(`${http}/healthz`)).json()).toEqual({ ok: true });
    expect((await fetch(`${http}/api/release/tokyo-revengers`)).status).toBe(502);
    const a = await connect(url(await room()));
    expect(sessionOf(await a.next(state('join'))).episodeId).toBeNull();
    a.send({ type: 'play' });
    await sleep(100);
    expect(a.log.filter(state('play'))).toHaveLength(0);
    a.close();
  });
});

describe('страницы', () => {
  it('/r/<код> отдаёт index.html, неизвестный /api — 404', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'wtgt-dist-'));
    writeFileSync(join(dist, 'index.html'), '<div id="root"></div>');
    const { http } = await start(okCatalog, { webDist: dist });
    const page = await fetch(`${http}/r/abcdef`);
    expect(page.status).toBe(200);
    expect(page.headers.get('cache-control')).toBe('no-cache');
    expect(await page.text()).toContain('id="root"');
    expect((await fetch(`${http}/api/nope`)).status).toBe(404);
  });
});
