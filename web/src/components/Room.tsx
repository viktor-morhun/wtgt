import { useCallback, useEffect, useRef, useState } from 'react';
import * as cmd from '../commands';
import { Icon } from '../icons';
import { enterRoom, hello, leaveRoom, useNet } from '../net';
import { usePlayback } from '../playback';
import { useRelease } from '../release';
import { navigate, roomPath } from '../route';
import { getSettings, setSettings, useSettings } from '../settings';
import { Avatars } from './Avatars';
import { Episodes } from './Episodes';
import { CREATED_KEY } from './Home';
import { NameSheet } from './NameSheet';
import { ReleaseSheet } from './ReleaseSheet';
import { episodeLabel, Stage } from './Stage';

const TOAST_MS = 2_000;

/** Только что создал эту комнату на главной — входим сразу под сохранённым ником. */
function takeCreated(code: string): boolean {
  try {
    if (sessionStorage.getItem(CREATED_KEY) !== code) return false;
    sessionStorage.removeItem(CREATED_KEY);
    return !!getSettings().name.trim();
  } catch {
    return false;
  }
}

/** Комната: видео и серии, шапка с участниками и приглашением (spec rooms). */
export function Room({ code }: { code: string }) {
  const net = useNet();
  const { quality, name } = useSettings();
  const session = net.session;
  const { release, error: releaseError, reload } = useRelease(session?.alias ?? null);
  const episode = release?.episodes.find((e) => e.id === session?.episodeId) ?? null;
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [joined, setJoined] = useState(() => takeCreated(code));
  const joinedRef = useRef(joined);
  joinedRef.current = joined;
  const [sheet, setSheet] = useState<'release' | 'name' | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const onStale = useCallback(() => reload(true), [reload]);
  const playback = usePlayback({ video: videoRef, session, episode, quality, joined, onStale });
  const playing = !!session && !session.paused;

  // соединение с комнатой живёт, пока открыта её страница
  useEffect(() => {
    enterRoom(code);
    // создатель комнаты уже «присоединился» — представляемся сразу
    if (joinedRef.current) hello(getSettings().name.trim());
    return () => leaveRoom();
  }, [code]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => {
    document.title = release
      ? `${release.title}${episode ? ` · ${episodeLabel(episode)}` : ''}`
      : 'Смотрим вместе';
  }, [release, episode]);

  // горячие клавиши (spec player-ui); в полях ввода не работают
  useEffect(() => {
    if (!joined) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t?.closest('input:not([type=range]), textarea, [contenteditable]') ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey
      )
        return;
      const v = videoRef.current;
      const duration = v && Number.isFinite(v.duration) ? v.duration : (episode?.duration ?? 0);
      const s = net.session;
      const handled = (() => {
        switch (e.code) {
          case 'Space':
          case 'KeyK':
            cmd.togglePlay(v);
            return true;
          case 'ArrowLeft':
            cmd.seekBy(-10, v, duration);
            return true;
          case 'ArrowRight':
            cmd.seekBy(10, v, duration);
            return true;
          case 'Period':
            if (!e.shiftKey) return false;
            cmd.stepRate(1);
            return true;
          case 'Comma':
            if (!e.shiftKey) return false;
            cmd.stepRate(-1);
            return true;
          case 'KeyF':
            cmd.toggleFullscreen(stageRef.current, v);
            return true;
          case 'KeyM':
            setSettings({ muted: !getSettings().muted });
            return true;
          case 'KeyN':
            cmd.playEpisode(cmd.neighbour(release, s?.episodeId ?? null, 1));
            return true;
          case 'KeyP':
            cmd.playEpisode(cmd.neighbour(release, s?.episodeId ?? null, -1));
            return true;
        }
        return false;
      })();
      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [joined, release, episode, net.session]);

  const join = (nick: string) => {
    setSettings({ name: nick });
    hello(nick);
    setJoined(true);
    // в обработчике нажатия: браузер разрешает звук этому видео; пауза, если сессия на паузе, — по сверке
    void videoRef.current?.play().catch(() => {});
  };

  const invite = async () => {
    const url = new URL(roomPath(code), location.origin).href;
    if (navigator.share && matchMedia('(hover: none)').matches) {
      try {
        await navigator.share({ title: 'Смотрим вместе', url });
        return;
      } catch (e) {
        if ((e as DOMException).name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setToast('Ссылка скопирована');
    } catch {
      setToast(url);
    }
  };

  return (
    <div className="app">
      <main className="d-center">
        <header className="topbar">
          <button
            className="back rp"
            onClick={() => navigate('/')}
            aria-label="На главную"
            title="На главную"
          >
            {Icon.back}
          </button>
          <div className="topbar-title">
            <h1>{release?.title ?? 'Смотрим вместе'}</h1>
            {episode && (
              <div className="row-sub">
                {episodeLabel(episode)}
                {episode.name ? ` · ${episode.name}` : ''}
              </div>
            )}
          </div>
          {net.online ? (
            <button
              className="topbar-members"
              onClick={() => joined && setSheet('name')}
              title={joined ? 'Сменить ник' : undefined}
            >
              <Avatars members={net.members} you={net.you} />
            </button>
          ) : (
            <span className="presence">нет связи</span>
          )}
          <button
            className="btn btn-small rp"
            onClick={() => void invite()}
            title="Скопировать ссылку на комнату"
          >
            {Icon.share}
            <span className="topbar-btn-text">Пригласить</span>
          </button>
          <button
            className="btn btn-small btn-tonal rp"
            onClick={() => setSheet('release')}
            title="Сменить тайтл"
            aria-label="Сменить тайтл"
          >
            {Icon.link}
          </button>
        </header>
        <Stage
          stageRef={stageRef}
          videoRef={videoRef}
          release={release}
          releaseError={releaseError}
          onReloadRelease={() => reload(true)}
          session={session}
          episode={episode}
          playback={playback}
          joined={joined}
          onJoin={join}
          fullscreen={fullscreen}
        />
      </main>
      <aside className="d-right">
        <div className="d-right-head">
          <h3>серии</h3>
          {release && <span className="hint small">{release.episodes.length}</span>}
        </div>
        {release ? (
          <Episodes release={release} currentId={session?.episodeId ?? null} playing={playing} />
        ) : (
          <div className="empty">{releaseError ?? <span className="spinner" />}</div>
        )}
      </aside>
      {sheet === 'release' && session && (
        <ReleaseSheet currentAlias={session.alias} onClose={() => setSheet(null)} />
      )}
      {sheet === 'name' && (
        <NameSheet
          current={name}
          onSave={(nick) => {
            setSettings({ name: nick });
            hello(nick);
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {toast && (
        <div className="toasts">
          <div className="toast">{toast}</div>
        </div>
      )}
    </div>
  );
}
