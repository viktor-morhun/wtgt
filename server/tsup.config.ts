import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node24',
  clean: true,
  sourcemap: true,
  // Общий пакет — исходники TS, поэтому вшиваем его в бандл; остальные зависимости остаются внешними.
  noExternal: ['@wtgt/shared'],
});
