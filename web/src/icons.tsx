/** Иконки: back/play/pause/prev/next/volume/muted — как в listen-together, остальные — в том же стиле. */
export const Icon = {
  back: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M14.7 5.3a1 1 0 0 1 0 1.4L9.41 12l5.3 5.3a1 1 0 0 1-1.42 1.4l-6-6a1 1 0 0 1 0-1.4l6-6a1 1 0 0 1 1.42 0Z" />
    </svg>
  ),
  share: (
    <svg viewBox="0 0 24 24" aria-hidden className="stroke">
      <path d="M12 15V4M8 8l4-4 4 4" />
      <path d="M5 12v6.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V12" />
    </svg>
  ),
  play: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
    </svg>
  ),
  pause: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  ),
  prev: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M19 6.2v11.6a1 1 0 0 1-1.55.83l-8.2-5.8a1 1 0 0 1 0-1.66l8.2-5.8A1 1 0 0 1 19 6.2Z" />
      <rect x="5" y="5" width="2.5" height="14" rx="1" />
    </svg>
  ),
  next: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M5 6.2v11.6a1 1 0 0 0 1.55.83l8.2-5.8a1 1 0 0 0 0-1.66l-8.2-5.8A1 1 0 0 0 5 6.2Z" />
      <rect x="16.5" y="5" width="2.5" height="14" rx="1" />
    </svg>
  ),
  volume: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M4 9.5h3l4.5-4v13L7 14.5H4z" />
      <path d="M15.5 9a4 4 0 0 1 0 6" />
      <path d="M18 6.5a7.5 7.5 0 0 1 0 11" />
    </svg>
  ),
  muted: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M4 9.5h3l4.5-4v13L7 14.5H4z" />
      <path d="m16 9.5 5 5" />
      <path d="m21 9.5-5 5" />
    </svg>
  ),
  back10: (
    <svg viewBox="0 0 24 24" aria-hidden className="stroke">
      <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
      <path d="M4.5 3.5v3.7h3.7" />
      <text x="12" y="15.6" textAnchor="middle">
        10
      </text>
    </svg>
  ),
  fwd10: (
    <svg viewBox="0 0 24 24" aria-hidden className="stroke">
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
      <path d="M19.5 3.5v3.7h-3.7" />
      <text x="12" y="15.6" textAnchor="middle">
        10
      </text>
    </svg>
  ),
  fullscreen: (
    <svg viewBox="0 0 24 24" aria-hidden className="stroke">
      <path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" />
    </svg>
  ),
  exitFullscreen: (
    <svg viewBox="0 0 24 24" aria-hidden className="stroke">
      <path d="M9 4v3.5A1.5 1.5 0 0 1 7.5 9H4M20 9h-3.5A1.5 1.5 0 0 1 15 7.5V4M15 20v-3.5a1.5 1.5 0 0 1 1.5-1.5H20M4 15h3.5A1.5 1.5 0 0 1 9 16.5V20" />
    </svg>
  ),
  send: (
    <svg viewBox="0 0 24 24" aria-hidden className="stroke">
      <path d="M12 19V5M6 11l6-6 6 6" />
    </svg>
  ),
  link: (
    <svg viewBox="0 0 24 24" aria-hidden className="stroke">
      <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1" />
      <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" />
    </svg>
  ),
};
