# Смотрим вместе

Сайт для совместного просмотра аниме с AniLibria: открываете одну ссылку, жмёте «Присоединиться», и у всех одно и то же видео. Пуск, пауза, перемотка, скорость (0.5–2x) и смена серии — у всех сразу, кто бы ни нажал. Комнат и входа нет: одна общая сессия на весь сайт.

Адрес: **https://watch.umri.online**

- По умолчанию открыты «Токийские мстители»; «Сменить тайтл» — вставить ссылку на любой релиз AniLibria (`https://anilibria.tv/release/<алиас>.html`) или алиас.
- Серия закончилась — у всех включается следующая.
- Качество (480/720/1080) и громкость у каждого свои.
- Клавиши: пробел/K — пауза, ← → — 10 с, Shift + < > — скорость, F — полный экран (или двойной клик), M — звук, N / P — серии.

Спецификации и решения: [openspec/changes/add-anime-watch-together](openspec/changes/add-anime-watch-together/).

## Как устроено

```
server/  Fastify: статика web/dist, GET /healthz, GET /api/release/:alias, WebSocket /ws
web/     React + Vite + hls.js; стиль — из listen-together (монохром, тёмная тема)
shared/  протокол WebSocket (zod), расчёт позиции и сверка часов, разбор ссылок AniLibria
```

- **Видео** играет напрямую с CDN AniLibria (HLS, CORS открыт); сервер видео не трогает. Список серий и ссылки на потоки сервер берёт из `https://anilibria.top/api/v1/anime/releases/<алиас>` и кэширует на 10 минут.
- **Синхронизация.** Источник правды — сервер: серия, пауза/игра, позиция на момент последнего изменения (`anchor` по часам сервера), скорость, `version`. Клиент сверяет часы с сервером (медиана ping/pong) и раз в 500 мс считает ожидаемую позицию `position + (сейчас − anchor) × rate`. Расхождение больше 1 с (на паузе — 0,3 с) — перемотка. Кто отстал из-за загрузки — догоняет, остальные не ждут.
- Команды уходят только от кнопок и клавиш, события `<video>` на сервер не отправляются — поэтому нет эха. Исключение — нативный полный экран на iPhone.
- Состояние в памяти: после перезапуска — первая серия, пауза. Если все закрыли вкладки во время просмотра — сессия встаёт на паузу.

## Разработка

Нужны Node 24+ и pnpm 10.

```bash
pnpm install
pnpm dev          # сервер на :3000 + vite на :5173 (проксирует /ws и /api)
```

Открыть http://localhost:5173 в двух вкладках.

Проверки (то же запускает CI):

```bash
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build
```

Прод локально: `pnpm build && pnpm start` → http://localhost:3000.

Переменные окружения (все необязательные, см. `.env.example`): `PORT` (3000), `DEFAULT_RELEASE` (`tokyo-revengers`), `WEB_DIST`, `LOG_LEVEL`.

## Деплой в Coolify

Приложение — один контейнер из `Dockerfile`, без volume и секретов.

1. DNS: A-запись `watch.umri.online` → IP VPS.
2. Coolify → проект → **New Resource → Public Repository** → `https://github.com/viktor-morhun/wtgt`, ветка `main`.
3. **Build Pack:** Dockerfile. **Ports Exposes:** `3000`.
4. **Domains:** `https://watch.umri.online` — Traefik сам выпустит сертификат Let's Encrypt.
5. **Health Check:** путь `/healthz`, порт `3000` (в образе есть и свой `HEALTHCHECK`).
6. Deploy. Проверка: `curl https://watch.umri.online/healthz` → `{"ok":true}`.
7. Автодеплой: включить **Auto Deploy** и добавить webhook GitHub по инструкции Coolify (Webhooks → GitHub), либо жать Redeploy.

WebSocket идёт через тот же домен (`/ws`), отдельных настроек Traefik не нужно. При редеплое общая сессия начинается заново.

GitHub Actions ([ci.yml](.github/workflows/ci.yml)) на каждый push проверяет код и что Docker-образ собирается и отвечает на `/healthz`.
