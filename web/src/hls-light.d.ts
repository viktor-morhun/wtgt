// облегчённая сборка hls.js (без субтитров и альтернативных дорожек) — типы те же
declare module 'hls.js/light' {
  export * from 'hls.js';
  export { default } from 'hls.js';
}
