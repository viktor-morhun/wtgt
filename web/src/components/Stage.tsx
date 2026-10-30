import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import {
  formatTime,
  NAME_MAX,
  QUALITIES,
  RATES,
  type Cause,
  type Episode,
  type Quality,
  type Release,
  type Session,
} from '@wtgt/shared';
import * as cmd from '../commands';
import { Icon } from '../icons';
import { useNet } from '../net';
import { pickQuality, useVideoClock, type Playback } from '../playback';
import { getSettings, setSettings, useSettings } from '../settings';
import { Avatars } from './Avatars';
import { ChatOverlay } from './Chat';
import { WaveProgress } from './WaveProgress';

/** Панель прячется через столько бездействия во время просмотра (spec player-ui). */
const IDLE_MS = 3_000;
const OSD_MS = 1_500;
const CLICK_DELAY_MS = 220;
const DOUBLE_TAP_MS = 300;

export const episodeLabel = (e: Episode) => `Серия ${e.ordinal}`;

interface Props {
  stageRef: RefObject<HTMLDivElement | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
  release: Release | null;
  releaseError: string | null;
  onReloadRelease(): void;
  session: Session | null;
  episode: Episode | null;
  playback: Playback;
  joined: boolean;
  onJoin(name: string): void;
  fullscreen: boolean;
}

/** Видео во всю сцену, поверх — управление, подсказки действий, вход и ошибки. */
export function Stage(props: Props) {
  const { stageRef, videoRef, release, session, episode, playback, joined, fullscreen } = props;
  const net = useNet();
  const settings = useSettings();
  const clock = useVideoClock(videoRef, episode?.duration ?? 0);
  const [active, setActive] = useState(true);
  const [menu, setMenu] = useState<'rate' | 'quality' | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const clickTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastTap = useRef(0);
  const playing = !!session && !session.paused;

  // громкость — своя у каждого зрителя
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = settings.volume;
    v.muted = settings.muted;
  }, [videoRef, settings.volume, settings.muted]);

  const wake = () => {
    setActive(true);
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setActive(false), IDLE_MS);
  };
  useEffect(() => {
    if (!playing) {
      clearTimeout(idleTimer.current);
      setActive(true);
    } else wake();
    return () => clearTimeout(idleTimer.current);
  }, [playing]);
  useEffect(() => {
    // набор сообщения в чате панель не будит
    const onKey = (e: KeyboardEvent) =>
      !(e.target as HTMLElement | null)?.closest('input, textarea') && wake();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const shown = active || !playing || menu !== null || !joined;
  const duration = clock.duration;

  const onSurface = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') {
      clearTimeout(clickTimer.current);
      clickTimer.current = setTimeout(() => cmd.togglePlay(videoRef.current), CLICK_DELAY_MS);
      return;
    }
    // палец: тап — показать или спрятать панель, двойной тап — полный экран
    const now = performance.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0;
      cmd.toggleFullscreen(stageRef.current, videoRef.current);
      return;
    }
    lastTap.current = now;
    if (shown && playing) {
      clearTimeout(idleTimer.current);
      setActive(false);
    } else wake();
  };

  let overlay: ReactNode = null;
  if (props.releaseError && !release) {
    overlay = <ErrorScreen text={props.releaseError} onRetry={props.onReloadRelease} />;
  } else if (playback.error) {
    overlay = (
      <ErrorScreen
        text={playback.error}
        onRetry={() => {
          props.onReloadRelease();
          playback.retry();
        }}
      />
    );
  } else if (!joined && release) {
    overlay = <Join release={release} episode={episode} onJoin={props.onJoin} />;
  } else if (playback.blocked) {
    overlay = (
      <div className="stage-cover">
        <button className="btn btn-wide rp" onClick={() => void videoRef.current?.play()}>
          {Icon.play} Смотреть
        </button>
      </div>
    );
  } else if (!release || !episode) {
    overlay = (
      <div className="stage-cover">
        <span className="spinner" />
      </div>
    );
  }

  return (
    <div
      ref={stageRef}
      className={`stage${shown ? '' : ' idle'}${fullscreen ? ' is-fullscreen' : ''}`}
      onPointerMove={(e) => e.pointerType === 'mouse' && wake()}
    >
      <video ref={videoRef} playsInline preload="auto" poster={release?.poster ?? undefined} />
      <div
        className="stage-hit"
        onPointerUp={onSurface}
        onDoubleClick={() => {
          clearTimeout(clickTimer.current);
          cmd.toggleFullscreen(stageRef.current, videoRef.current);
        }}
      />
      <Osd session={session} release={release} />
      {fullscreen && joined && <ChatOverlay />}
      {(playback.catchingUp || clock.waiting) && joined && !overlay && (
        <div className="stage-status">
          <span className="spinner" /> {playback.catchingUp ? 'догоняем…' : 'загрузка…'}
        </div>
      )}
      {!net.online && <div className="stage-status stage-offline">нет связи</div>}
      {overlay}
      {joined && release && episode && !playback.error && (
        <div className="vctl" onPointerDown={wake}>
          <WaveProgress
            value={clock.time}
            max={duration}
            buffered={clock.buffered}
            playing={playing && !clock.waiting}
            onSeek={(sec) => cmd.seekTo(sec, duration)}
          />
          <div className="vctl-row">
            <div className="vctl-side">
              <span className="vctl-time">
                {formatTime(clock.time)} <span className="vctl-dim">/ {formatTime(duration)}</span>
              </span>
            </div>
            <div className="vctl-main">
              <button
                className="ctrl ctrl-sm rp"
                disabled={!cmd.neighbour(release, session?.episodeId ?? null, -1)}
                onClick={() => cmd.playEpisode(cmd.neighbour(release, session?.episodeId ?? null, -1))}
                aria-label="Предыдущая серия"
                title="Предыдущая серия (P)"
              >
                {Icon.prev}
              </button>
              <button
                className="ctrl ctrl-sm ctrl-stroke rp"
                onClick={() => cmd.seekBy(-10, videoRef.current, duration)}
                aria-label="Назад 10 секунд"
                title="−10 с (←)"
              >
                {Icon.back10}
              </button>
              <button
                className={`ctrl ctrl-main rp${playing ? ' playing' : ''}`}
                onClick={() => cmd.togglePlay(videoRef.current)}
                aria-label={playing ? 'Пауза' : 'Смотреть'}
                title="Пуск/пауза (пробел)"
              >
                <span key={playing ? 'pause' : 'play'} className="ico">
                  {playing ? Icon.pause : Icon.play}
                </span>
              </button>
              <button
                className="ctrl ctrl-sm ctrl-stroke rp"
                onClick={() => cmd.seekBy(10, videoRef.current, duration)}
                aria-label="Вперёд 10 секунд"
                title="+10 с (→)"
              >
                {Icon.fwd10}
              </button>
              <button
                className="ctrl ctrl-sm rp"
                disabled={!cmd.neighbour(release, session?.episodeId ?? null, 1)}
                onClick={() => cmd.playEpisode(cmd.neighbour(release, session?.episodeId ?? null, 1))}
                aria-label="Следующая серия"
                title="Следующая серия (N)"
              >
                {Icon.next}
              </button>
            </div>
            <div className="vctl-side vctl-end">
              <Menu
                open={menu === 'rate'}
                onToggle={(o) => setMenu(o ? 'rate' : null)}
                label={`${session?.rate ?? 1}x`}
                title="Скорость (Shift + < / >)"
              >
                {RATES.map((r) => (
                  <button
                    key={r}
                    className={`chip rp${session?.rate === r ? ' active' : ''}`}
                    onClick={() => {
                      cmd.setRate(r);
                      setMenu(null);
                    }}
                  >
                    {r}x
                  </button>
                ))}
              </Menu>
              <Menu
                open={menu === 'quality'}
                onToggle={(o) => setMenu(o ? 'quality' : null)}
                label={`${pickQuality(episode, settings.quality) ?? settings.quality}p`}
                title="Качество — только у тебя"
              >
                {QUALITIES.filter((q) => episode.hls[q]).map((q: Quality) => (
                  <button
                    key={q}
                    className={`chip rp${pickQuality(episode, settings.quality) === q ? ' active' : ''}`}
                    onClick={() => {
                      setSettings({ quality: q });
                      setMenu(null);
                    }}
                  >
                    {q}p
                  </button>
                ))}
              </Menu>
              <Volume />
              <button
                className="icon-btn vctl-btn rp"
                onClick={() => cmd.toggleFullscreen(stageRef.current, videoRef.current)}
                aria-label={fullscreen ? 'Выйти из полного экрана' : 'Полный экран'}
                title="Полный экран (F)"
              >
                {fullscreen ? Icon.exitFullscreen : Icon.fullscreen}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Вход в комнату: ник и «Присоединиться» — нажатие заодно разрешает звук (spec rooms, player-ui). */
function Join({
  release,
  episode,
  onJoin,
}: {
  release: Release;
  episode: Episode | null;
  onJoin(name: string): void;
}) {
  const { members } = useNet();
  const [name, setName] = useState(() => getSettings().name);
  const valid = name.trim().length > 0;
  return (
    <form
      className="stage-cover join"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onJoin(name.trim());
      }}
    >
      {release.poster && <div className="ambient" style={{ backgroundImage: `url(${release.poster})` }} />}
      {release.poster && <img className="join-poster" src={release.poster} alt="" />}
      <div className="join-meta">
        <div className="title">{release.title}</div>
        {episode && <div className="subtitle">{episodeLabel(episode)}</div>}
        {members.length > 0 && (
          <div className="join-members">
            <Avatars members={members} />
          </div>
        )}
      </div>
      <div className="search-field join-name">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Твой ник"
          maxLength={NAME_MAX}
          autoFocus={!name}
          aria-label="Ник"
        />
      </div>
      <button className="btn btn-wide rp" disabled={!valid} autoFocus={!!name}>
        Присоединиться
      </button>
    </form>
  );
}

function ErrorScreen({ text, onRetry }: { text: string; onRetry(): void }) {
  return (
    <div className="stage-cover">
      <div className="title">{text}</div>
      <button className="btn btn-tonal rp" onClick={onRetry}>
        Повторить
      </button>
    </div>
  );
}

/** Короткая подсказка поверх видео: кто-то нажал паузу, перемотал, сменил скорость или серию. */
function Osd({ session, release }: { session: Session | null; release: Release | null }) {
  const { cause, by } = useNet();
  const { name: me } = useSettings();
  const [text, setText] = useState<{ key: number; text: string } | null>(null);
  const version = session?.version;

  useEffect(() => {
    if (!session || !cause || cause === 'join') return;
    const ep = release?.episodes.find((e) => e.id === session.episodeId);
    const t: Record<Cause, string> = {
      join: '',
      play: '▶',
      pause: 'Пауза',
      seek: `→ ${formatTime(session.position)}`,
      rate: `${session.rate}x`,
      episode: ep ? episodeLabel(ep) : 'Другая серия',
      next: ep ? episodeLabel(ep) : 'Следующая серия',
      release: release?.title ?? 'Другой тайтл',
      end: 'Конец',
      restore: `${ep ? `${episodeLabel(ep)} · ` : ''}${formatTime(session.position)}`,
    };
    // чужое действие — с автором, своё — без
    const text = by && by !== me ? `${by}: ${t[cause].toLowerCase()}` : t[cause];
    setText({ key: session.version, text });
    const timer = setTimeout(() => setText(null), OSD_MS);
    return () => clearTimeout(timer);
    // подсказка — на каждое новое изменение сессии
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  return text ? (
    <div key={text.key} className="osd toast">
      {text.text}
    </div>
  ) : null;
}

function Menu({
  open,
  onToggle,
  label,
  title,
  children,
}: {
  open: boolean;
  onToggle(open: boolean): void;
  label: string;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onToggle(false);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open, onToggle]);
  return (
    <div className="vmenu" ref={ref}>
      <button
        className={`chip vchip rp${open ? ' active' : ''}`}
        onClick={() => onToggle(!open)}
        title={title}
      >
        {label}
      </button>
      {open && <div className="vmenu-pop">{children}</div>}
    </div>
  );
}

/** Громкость как в listen-together: тусклый динамик и тонкая полоска. */
function Volume() {
  const { volume, muted } = useSettings();
  const shown = muted ? 0 : volume;
  return (
    <div className="volume">
      <button
        className="volume-mute"
        onClick={() =>
          shown === 0 ? setSettings({ muted: false, volume: volume || 0.5 }) : setSettings({ muted: true })
        }
        aria-label={shown === 0 ? 'Включить звук' : 'Без звука'}
        title="Звук (M)"
      >
        {shown === 0 ? Icon.muted : Icon.volume}
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={shown}
        onChange={(e) => setSettings({ volume: Number(e.target.value), muted: false })}
        aria-label="Громкость"
        style={{ '--vol': shown } as CSSProperties}
      />
    </div>
  );
}
