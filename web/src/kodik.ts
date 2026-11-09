/**
 * Плеер Kodik в iframe под видом <video> — чтобы сверка с сессией работала с ним так же, как с HLS.
 * Управление — postMessage-API Kodik: play / pause / seek / speed / get_time; в ответ — события kodik_player_*.
 *
 * Кнопки у Kodik свои (качество, скорость, громкость, полный экран — всё в самом плеере), поэтому
 * его события делятся на два вида: ответы на наши команды (сверка) и нажатия зрителя. Вторые
 * выходят наружу событием «useraction» и превращаются в команды комнаты.
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
/** Перемотка к той же точке в пределах этого — ответ на нашу команду или повтор (Kodik шлёт события дважды). */
const SEEK_ECHO_MS = 3_000;

/** Что зритель нажал в самом плеере Kodik. */
export type UserAction =
  | { type: 'play' }
  | { type: 'pause'; position: number }
  | { type: 'seek'; position: number }
  | { type: 'rate'; rate: number };

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
  /** что мы последним велели плееру: пуск/пауза в ту же сторону — ответ, в другую — нажатие зрителя */
  private want: 'play' | 'pause' | null = null;
  /** последняя перемотка, о которой сообщил плеер, — чтобы отсеять повтор */
  private lastSeek = { time: NaN, at: 0 };
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
    this.lastSeek = { time: t, at: performance.now() };
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

  // громкость у Kodik своя, в его плеере: не трогаем
  get volume(): number {
    return this._volume;
  }
  set volume(v: number) {
    this._volume = v;
  }
  get muted(): boolean {
    return this._muted;
  }
  set muted(m: boolean) {
    this._muted = m;
  }

  /** Не дал браузер — зритель нажмёт пуск в самом плеере, это совпадёт с сессией. */
  play(): Promise<void> {
    this.want = 'play';
    this.post('play');
    return Promise.resolve();
  }

  pause(): void {
    this.want = 'pause';
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

  private user(action: UserAction): void {
    this.dispatchEvent(new CustomEvent<UserAction>('useraction', { detail: action }));
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
      // начало ролика (после рекламы) — только знак, что плеер ожил: пуск придёт отдельным kodik_player_play,
      // и если отметить игру уже здесь, пуск зрителя сойдёт за повтор
      case 'kodik_player_video_started':
        this.markLoaded();
        return;
      case 'kodik_player_play': {
        this.markLoaded();
        if (!this._paused) return; // повтор
        this.setTime(this.currentTime);
        this._paused = false;
        this._ended = false;
        this.emit('play', 'playing');
        if (this.want !== 'play') {
          // зритель нажал пуск: теперь «хотим» игру, иначе его следующая пауза сойдёт за ответ на нашу
          this.want = 'play';
          this.user({ type: 'play' });
        }
        return;
      }
      case 'kodik_player_pause':
        if (this._paused) return; // повтор или конец серии
        this.setTime(this.currentTime);
        this._paused = true;
        this.emit('pause');
        if (this.want !== 'pause') {
          this.want = 'pause';
          this.user({ type: 'pause', position: this.time });
        }
        return;
      case 'kodik_player_seek': {
        this.markLoaded();
        const time = (value as { time?: unknown } | null)?.time;
        if (typeof time !== 'number' || !Number.isFinite(time)) return;
        const now = performance.now();
        const repeat =
          Math.abs(time - this.lastSeek.time) < SEEK_NEAR_S && now - this.lastSeek.at < SEEK_ECHO_MS;
        this.lastSeek = { time, at: now };
        if (repeat) return; // наша перемотка или повтор
        clearTimeout(this.seekTimer);
        this.seekTarget = null;
        this.setTime(time);
        this._ended = false;
        this.emit('timeupdate');
        this.user({ type: 'seek', position: time });
        return;
      }
      case 'kodik_player_speed_change': {
        const speed = (value as { speed?: unknown } | null)?.speed;
        if (typeof speed !== 'number' || speed === this.rate) return; // наша скорость или повтор
        this.setTime(this.currentTime);
        this.rate = speed;
        this.user({ type: 'rate', rate: speed });
        return;
      }
      case 'kodik_player_video_ended':
        if (Number.isFinite(this._duration)) this.setTime(this._duration);
        this._ended = true;
        this._paused = true;
        this.emit('pause', 'ended');
        return;
    }
  };
}
