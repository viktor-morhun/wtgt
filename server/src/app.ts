import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyServerOptions } from 'fastify';
import {
  createRoomSchema,
  isPlayable,
  parseAlias,
  parseClientMessage,
  type ServerMessage,
} from '@wtgt/shared';
import { CatalogError, type Catalog } from './anilibria';
import type { Client } from './hub';
import { Rooms } from './rooms';
import type { Finder } from './search';

type Options = {
  catalog: Catalog;
  /** поиск тайтлов и «новое»; без него /api/search и /api/latest отвечают 404 */
  finder?: Finder;
  /** тайтл новой комнаты; null — комната начинается без тайтла */
  defaultRelease?: string | null;
  /** собранный web/dist; без него сервер отдаёт только API и /ws */
  webDist?: string;
  logger?: FastifyServerOptions['logger'];
  rooms?: ConstructorParameters<typeof Rooms>[2];
};

/** Ping по WS чаще таймаута простоя Traefik, заодно отсекает зависшие соединения. */
const HEARTBEAT_MS = 25_000;
/** Код закрытия WS: комнаты нет и создать нельзя (неверный код или лимит). */
export const WS_CLOSE_NO_ROOM = 4404;
/** Столько тайтлов за один запрос /api/counts. */
const COUNTS_MAX = 20;

export async function buildApp({
  catalog,
  finder,
  defaultRelease = null,
  webDist,
  logger = false,
  rooms: roomOpts,
}: Options) {
  const app = Fastify({ logger });
  const rooms = new Rooms(catalog, defaultRelease, roomOpts);
  app.decorate('rooms', rooms);
  app.addHook('onClose', async () => rooms.close());

  await app.register(fastifyWebsocket, { options: { maxPayload: 4096 } });

  app.get('/healthz', async () => ({ ok: true }));

  app.get<{ Params: { alias: string }; Querystring: { fresh?: string } }>(
    '/api/release/:alias',
    async (req, reply) => {
      try {
        return await catalog.get(req.params.alias, { fresh: req.query.fresh === '1' });
      } catch (e) {
        const err = e instanceof CatalogError ? e : new CatalogError('unavailable', 'Источник не отвечает');
        return reply
          .code(err.code === 'not_found' ? 404 : 502)
          .send({ code: err.code, message: err.message });
      }
    },
  );

  const fail = (reply: { code(n: number): { send(b: unknown): unknown } }, e: unknown) => {
    const err = e instanceof CatalogError ? e : new CatalogError('unavailable', 'Источник не отвечает');
    return reply.code(err.code === 'not_found' ? 404 : 502).send({ code: err.code, message: err.message });
  };

  if (finder) {
    app.get<{ Querystring: { q?: string } }>('/api/search', async (req, reply) => {
      try {
        return await finder.search(req.query.q ?? '');
      } catch (e) {
        return fail(reply, e);
      }
    });
    app.get('/api/random', async (_req, reply) => {
      try {
        return await finder.random();
      } catch (e) {
        return fail(reply, e);
      }
    });
    app.get('/api/latest', async (_req, reply) => {
      try {
        return await finder.latest();
      } catch (e) {
        return fail(reply, e);
      }
    });
  }

  // сколько серий сейчас у тайтлов из истории зрителя — для метки «+1 серия» на главной
  app.get<{ Querystring: { alias?: string | string[] } }>('/api/counts', async (req) => {
    const list = [req.query.alias ?? []].flat().slice(0, COUNTS_MAX);
    const counts: Record<string, number> = {};
    await Promise.all(
      list.map(async (alias) => {
        try {
          counts[alias] = (await catalog.get(alias)).episodes.filter(isPlayable).length;
        } catch {
          // источник не ответил — метки просто не будет
        }
      }),
    );
    return counts;
  });

  // пустое тело — комната без тайтла; { alias, episodeId?, position? } — сразу с ним
  app.post('/api/rooms', async (req, reply) => {
    const body = createRoomSchema.safeParse(req.body ?? null);
    if (!body.success) return reply.code(400).send({ code: 'bad_request', message: 'Непонятный запрос' });
    let release = null;
    if (body.data?.alias) {
      const alias = parseAlias(body.data.alias);
      if (!alias) return reply.code(404).send({ code: 'not_found', message: 'Релиз не найден' });
      try {
        release = await catalog.get(alias);
      } catch (e) {
        return fail(reply, e);
      }
      if (!release.episodes.some(isPlayable)) {
        return reply.code(404).send({ code: 'not_found', message: 'В релизе нет доступных серий' });
      }
    }
    const code = rooms.create();
    if (!code) return reply.code(503).send({ code: 'unavailable', message: 'Слишком много комнат' });
    if (release) rooms.hub(code)!.start(release, body.data?.episodeId, body.data?.position);
    return { code };
  });

  app.get<{ Querystring: { room?: string } }>('/ws', { websocket: true }, (socket, req) => {
    const code = req.query.room ?? '';
    const client: Client = {
      send: (msg: ServerMessage) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
      },
    };
    const hub = rooms.join(code, client);
    if (!hub) return socket.close(WS_CLOSE_NO_ROOM, 'no room');

    let alive = true;
    socket.on('pong', () => (alive = true));
    const heartbeat = setInterval(() => {
      if (!alive) return socket.terminate();
      alive = false;
      socket.ping();
    }, HEARTBEAT_MS);

    socket.on('message', (data) => {
      const msg = parseClientMessage(String(data));
      if (!msg) return client.send({ type: 'error', code: 'bad_request', message: 'Непонятная команда' });
      hub.handle(client, msg).catch((err) => app.log.error({ err }, 'ws command failed'));
    });
    socket.on('close', () => {
      clearInterval(heartbeat);
      rooms.leave(code, client);
    });
  });

  if (webDist && existsSync(webDist)) {
    await app.register(fastifyStatic, {
      root: webDist,
      // свои заголовки кэша ниже; встроенный max-age=0 их перебивал бы
      cacheControl: false,
      setHeaders(res, path) {
        // index.html всегда свежий, файлы сборки с хэшем в имени — навсегда
        res.setHeader(
          'cache-control',
          /[\\/]assets[\\/]/.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache',
        );
      },
    });
    // SPA: /r/<код> и прочие адреса страниц — тот же index.html
    app.setNotFoundHandler((req, reply) => {
      if (req.method !== 'GET' || req.url.startsWith('/api/') || req.url.startsWith('/assets/')) {
        return reply.code(404).send({ code: 'not_found', message: 'Not found' });
      }
      return reply.header('cache-control', 'no-cache').sendFile('index.html');
    });
  }

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    rooms: Rooms;
  }
}
