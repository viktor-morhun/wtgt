import { useCallback, useEffect, useRef, useState } from 'react';
import * as cmd from './commands';
import { Episodes } from './components/Episodes';
import { ReleaseSheet } from './components/ReleaseSheet';
import { episodeLabel, Stage } from './components/Stage';
import { Icon } from './icons';
import { useNet } from './net';
import { usePlayback } from './playback';
import { useRelease } from './release';
import { getSettings, setSettings, useSettings } from './settings';

const viewersLabel = (n: number) => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} смотрит`;
  return `${n} смотрят`;
};

export function App() {
  const net = useNet();
  const { quality } = useSettings();
  const session = net.session;
  const { release, error: releaseError, reload } = useRelease(session?.alias ?? null);
  const episode = release?.episodes.find((e) => e.id === session?.episodeId) ?? null;
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [joined, setJoined] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const onStale = useCallback(() => reload(true), [reload]);
  const playback = usePlayback({ video: videoRef, session, episode, quality, joined, onStale });
  const playing = !!session && !session.paused;

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

  const join = () => {
    setJoined(true);
    // в обработчике нажатия: браузер разрешает звук этому видео; пауза, если сессия на паузе, — по сверке
    void videoRef.current?.play().catch(() => {});
  };

  return (
    <div className="app">
      <main className="d-center">
        <header className="topbar">
          <div className="topbar-title">
            <h1>{release?.title ?? 'Смотрим вместе'}</h1>
            {episode && (
              <div className="row-sub">
                {episodeLabel(episode)}
                {episode.name ? ` · ${episode.name}` : ''}
              </div>
            )}
          </div>
          <span
            className={`presence${net.online ? '' : ' offline'}`}
            title={net.online ? 'на связи' : 'нет связи'}
          >
            <i />
            {net.online ? viewersLabel(net.viewers) : 'нет связи'}
          </span>
          <button className="btn btn-small btn-tonal rp" onClick={() => setSheet(true)} title="Сменить тайтл">
            {Icon.link}
            <span className="topbar-btn-text">Сменить тайтл</span>
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
        <div className="hotkeys hint small">
          пробел — пауза · ← → — 10 с · Shift + &lt; &gt; — скорость · F — полный экран · N / P — серии
        </div>
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
      {sheet && session && <ReleaseSheet currentAlias={session.alias} onClose={() => setSheet(false)} />}
    </div>
  );
}
