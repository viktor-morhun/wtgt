import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { parseClientMessage, type ServerMessage } from '@wtgt/shared';
import { CatalogError, type Catalog } from './anilibria';
import type { Client } from './hub';
import { Rooms } from './rooms';

type Options = {
  catalog: Catalog;
  defaultRelease: string;
  /** собранный web/dist; без него сервер отдаёт только API и /ws */
  webDist?: string;
  logger?: FastifyServerOptions['logger'];
  rooms?: ConstructorParameters<typeof Rooms>[2];
};

/** Ping по WS чаще таймаута простоя Traefik, заодно отсекает зависшие соединения. */
const HEARTBEAT_MS = 25_000;
/** Код закрытия WS: комнаты нет и создать нельзя (неверный код или лимит). */
export const WS_CLOSE_NO_ROOM = 4404;

export async function buildApp({
  catalog,
  defaultRelease,
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
        const err = e instanceof CatalogError ? e : new CatalogError('unavailable', 'AniLibria не отвечает');
        return reply
          .code(err.code === 'not_found' ? 404 : 502)
          .send({ code: err.code, message: err.message });
      }
    },
  );

  app.post('/api/rooms', async (_req, reply) => {
    const code = rooms.create();
    if (!code) return reply.code(503).send({ code: 'unavailable', message: 'Слишком много комнат' });
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
