/**
 * Плеер Kodik в iframe под видом <video> — чтобы сверка с сессией, полоса перемотки и команды
 * работали с ним так же, как с HLS. Управление — postMessage-API Kodik:
 * play / pause / seek / speed / volume / mute / get_time; в ответ — события kodik_player_*.
 */

/** То, что от видео нужно сверке, полосе перемотки и командам; <video> подходит как есть. */
export interface Media extends EventTarget {
  currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  readonly ended: boolean;
  readonly seeking: boolean;
  readonly readyState: number;
  readonly buffered: { readonly length: number; start(i: number): number; end(i: number): number };
  playbackRate: number;
  defaultPlaybackRate: number;
  volume: number;
  muted: boolean;
  play(): Promise<void>;
  pause(): void;
}

/** Как часто спрашиваем точное время: time_update у Kodik — целые секунды и только вперёд. */
const POLL_MS = 250;
/** Перемотка считается законченной, когда плеер оказался в пределах этого от цели… */
const SEEK_NEAR_S = 1.5;
/** …или по таймауту. */
const SEEK_TIMEOUT_MS = 3_000;
/** Плеер не начал играть за это время — браузер не дал (или идёт реклама): нужен клик в самом плеере. */
const PLAY_TIMEOUT_MS = 4_000;

const NO_RANGES = { length: 0, start: () => 0, end: () => 0 };

type Msg = { key?: unknown; value?: unknown };

export class KodikMedia extends EventTarget implements Media {
  private time = 0;
  private timeAt = performance.now();
  private loaded = false;
  private _paused = true;
  private _ended = false;
  private _duration = NaN;
  private seekTarget: number | null = null;
  private seekTimer: ReturnType<typeof setTimeout> | undefined;
  private playWait: { promise: Promise<void>; resolve(): void } | null = null;
  private rate = 1;
  private _volume = 1;
  private _muted = false;
  private readonly poll: ReturnType<typeof setInterval>;

  readonly buffered = NO_RANGES;
  /** Состояние сверки: «есть метаданные» сразу — первая команда play и загружает плеер. */
  readonly readyState = 1;

  constructor(private readonly frame: HTMLIFrameElement) {
    super();
    window.addEventListener('message', this.onMessage);
    this.poll = setInterval(() => this.post('get_time'), POLL_MS);
  }

  destroy(): void {
    window.removeEventListener('message', this.onMessage);
    clearInterval(this.poll);
    clearTimeout(this.seekTimer);
  }

  get currentTime(): number {
    if (this.seekTarget !== null) return this.seekTarget;
    if (this._paused || this._ended) return this.time;
    return this.time + ((performance.now() - this.timeAt) / 1000) * this.rate;
  }

  set currentTime(t: number) {
    this.setTime(t);
    this._ended = false;
    // до загрузки плеер команд не слушает; сверка повторит перемотку, когда он оживёт
    if (!this.loaded) return;
    this.post('seek', { seconds: t });
    this.seekTarget = t;
    clearTimeout(this.seekTimer);
    this.seekTimer = setTimeout(() => this.seeked(), SEEK_TIMEOUT_MS);
  }

  get duration(): number {
    return this._duration;
  }
  get paused(): boolean {
    return this._paused;
  }
  get ended(): boolean {
    return this._ended;
  }
  get seeking(): boolean {
    return this.seekTarget !== null;
  }

  get playbackRate(): number {
    return this.rate;
  }
  set playbackRate(r: number) {
    this.setTime(this.currentTime);
    this.rate = r;
    this.post('speed', { speed: r });
  }
  get defaultPlaybackRate(): number {
    return this.rate;
  }
  set defaultPlaybackRate(_: number) {}

  get volume(): number {
    return this._volume;
  }
  set volume(v: number) {
    this._volume = v;
    this.post('volume', { volume: v });
  }
  get muted(): boolean {
    return this._muted;
  }
  set muted(m: boolean) {
    this._muted = m;
    this.post(m ? 'mute' : 'unmute');
  }

  /** Резолвится, когда плеер сообщил о пуске; не дождались — NotAllowedError, как у <video>. */
  play(): Promise<void> {
    this.post('play');
    if (!this._paused) return Promise.resolve();
    if (!this.playWait) {
      let resolve!: () => void;
      let reject!: (e: unknown) => void;
      const promise = new Promise<void>((res, rej) => ((resolve = res), (reject = rej)));
      const timer = setTimeout(() => {
        this.playWait = null;
        reject(new DOMException('Kodik не начал играть', 'NotAllowedError'));
      }, PLAY_TIMEOUT_MS);
      this.playWait = {
        promise,
        resolve: () => {
          clearTimeout(timer);
          this.playWait = null;
          resolve();
        },
      };
    }
    return this.playWait.promise;
  }

  pause(): void {
    this.post('pause');
  }

  private post(method: string, args: Record<string, number> = {}): void {
    this.frame.contentWindow?.postMessage({ key: 'kodik_player_api', value: { method, ...args } }, '*');
  }

  private setTime(t: number): void {
    this.time = t;
    this.timeAt = performance.now();
  }

  private emit(...types: string[]): void {
    for (const t of types) this.dispatchEvent(new Event(t));
  }

  private seeked(): void {
    clearTimeout(this.seekTimer);
    if (this.seekTarget === null) return;
    this.seekTarget = null;
    this.emit('seeked', 'timeupdate');
  }

  /** Плеер ожил: применяем то, что выставили до загрузки. */
  private markLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    this.post('volume', { volume: this._volume });
    this.post(this._muted ? 'mute' : 'unmute');
    if (this.rate !== 1) this.post('speed', { speed: this.rate });
    this.emit('loadedmetadata');
  }

  private readonly onMessage = (e: MessageEvent): void => {
    if (e.source !== this.frame.contentWindow) return;
    const { key, value } = (e.data ?? {}) as Msg;
    if (typeof key !== 'string' || !key.startsWith('kodik_player_')) return;
    switch (key) {
      case 'kodik_player_time':
      case 'kodik_player_time_update': {
        if (typeof value !== 'number') return;
        this.markLoaded();
        if (this.seekTarget !== null) {
          if (Math.abs(value - this.seekTarget) > SEEK_NEAR_S) return; // ответ ещё до перемотки
          this.setTime(value);
          this.seeked();
          return;
        }
        // time_update — округлённые секунды: точное время из get_time не портим
        if (key === 'kodik_player_time_update' && Math.abs(value - this.currentTime) < 1) return;
        this.setTime(value);
        this.emit('timeupdate');
        return;
      }
      case 'kodik_player_duration_update':
        if (typeof value === 'number' && value > 0) {
          this._duration = value;
          this.markLoaded();
          this.emit('durationchange');
        }
        return;
      case 'kodik_player_video_started':
      case 'kodik_player_play':
        this.markLoaded();
        this.setTime(this.currentTime);
        this._paused = false;
        this._ended = false;
        this.playWait?.resolve();
        this.emit('play', 'playing');
        return;
      case 'kodik_player_pause':
        this.setTime(this.currentTime);
        this._paused = true;
        this.emit('pause');
        return;
      case 'kodik_player_seek':
        this.markLoaded();
        return;
      case 'kodik_player_video_ended':
        if (Number.isFinite(this._duration)) this.setTime(this._duration);
        this._ended = true;
        this._paused = true;
        this.emit('pause', 'ended');
        return;
    }
  };
}
