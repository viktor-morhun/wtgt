# syntax=docker/dockerfile:1

# ---------- Сборка: shared (typecheck) → web (vite) → server (tsup) ----------
FROM node:24-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY server/package.json server/
COPY web/package.json web/
COPY shared/package.json shared/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm -r build
# Только прод-зависимости сервера (shared вшит в бандл tsup)
RUN pnpm --filter @wtgt/server deploy --prod --legacy /out && cp -r server/dist /out/

# ---------- Рантайм ----------
FROM node:24-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app/server
COPY --from=build --chown=node:node /out ./
COPY --from=build --chown=node:node /app/web/dist /app/web

ENV NODE_ENV=production \
    PORT=3000 \
    WEB_DIST=/app/web

USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 CMD curl -fsS http://127.0.0.1:3000/healthz > /dev/null || exit 1
CMD ["node", "dist/main.js"]
