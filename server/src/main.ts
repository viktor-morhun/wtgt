import { fileURLToPath } from 'node:url';
import { createCatalog } from './anilibria';
import { buildApp } from './app';

const port = Number(process.env.PORT ?? 3000);
const defaultRelease = process.env.DEFAULT_RELEASE ?? 'tokyo-revengers';
const webDist = process.env.WEB_DIST ?? fileURLToPath(new URL('../../web/dist', import.meta.url));

const app = await buildApp({
  catalog: createCatalog(),
  defaultRelease,
  webDist,
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
});

// релиз по умолчанию подгружаем сразу; если AniLibria лежит — подгрузится при первом подключении
void app.hub.ensureEpisode();

const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ port, host: '0.0.0.0' });
