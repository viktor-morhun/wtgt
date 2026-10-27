import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { parseClientMessage, type ServerMessage } from '@wtgt/shared';
import { CatalogError, type Catalog } from './anilibria';
import { Hub, type Client } from './hub';

type Options = {
  catalog: Catalog;
  defaultRelease: string;
  /** собранный web/dist; без него сервер отдаёт только API и /ws */
  webDist?: string;
  logger?: FastifyServerOptions['logger'];
};

/** Ping по WS чаще таймаута простоя Traefik, заодно отсекает зависшие соединения. */
const HEARTBEAT_MS = 25_000;

export async function buildApp({ catalog, defaultRelease, webDist, logger = false }: Options) {
  const app = Fastify({ logger });
  const hub = new Hub(catalog, defaultRelease);
  app.decorate('hub', hub);

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

  app.get('/ws', { websocket: true }, (socket) => {
    const client: Client = {
      send: (msg: ServerMessage) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
      },
    };
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
      hub.leave(client);
    });
    hub.join(client);
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
  }

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    hub: Hub;
  }
}
