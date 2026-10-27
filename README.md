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

Приложение — один контейнер из `Dockerfile`, без volume и секретов. Развёрнуто так:

- Coolify → проект **wtgt** → environment `production` → приложение **wtgt** из публичного репозитория `https://github.com/viktor-morhun/wtgt`, ветка `main`.
- Build Pack: Dockerfile, порт `3000`, health check `/healthz`.
- Домен `https://watch.umri.online` (A-запись на VPS) — сертификат выпускает Traefik (Let's Encrypt).
- Автодеплой: webhook GitHub (push) → `http://79.76.37.180:8000/webhooks/source/github/events/manual` с секретом из настроек приложения (Webhooks → GitHub). Push в `main` — новый деплой.

WebSocket идёт через тот же домен (`/ws`), отдельных настроек Traefik не нужно. При редеплое общая сессия начинается заново. Проверка: `curl https://watch.umri.online/healthz` → `{"ok":true}`.

GitHub Actions ([ci.yml](.github/workflows/ci.yml)) на каждый push проверяет код и что Docker-образ собирается и отвечает на `/healthz`.
