import { fileURLToPath } from 'node:url';
import { createCatalog } from './anilibria';
import { buildApp } from './app';
import { createFinder } from './search';

const port = Number(process.env.PORT ?? 3000);
/** тайтл новой комнаты; по умолчанию комната начинается без тайтла */
const defaultRelease = process.env.DEFAULT_RELEASE || null;
const webDist = process.env.WEB_DIST ?? fileURLToPath(new URL('../../web/dist', import.meta.url));

const app = await buildApp({
  catalog: createCatalog(),
  finder: createFinder(),
  defaultRelease,
  webDist,
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
});

const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ port, host: '0.0.0.0' });
