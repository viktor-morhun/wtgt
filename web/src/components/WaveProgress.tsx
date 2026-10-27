import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { formatTime } from '@wtgt/shared';

const WAVELENGTH = 24;
/** Половина толщины линии: скругление в начале волны не срезается. */
const CAP = 1.5;
const AMPLITUDE = 3.5;
const MID = 16;
/** Скорость бега волны: одна длина волны за 1.4 с. */
const SPEED = WAVELENGTH / 1400;
/** Как быстро амплитуда догоняет цель (1/мс). */
const EASE = 0.008;
/** Пока сессия не подтвердила перемотку — держим новую позицию, но не дольше этого. */
const SEEK_HOLD_MS = 2_000;
const SEEK_MATCH_S = 1.5;

/** Волна со сдвигом `phase` и амплитудой `amp`; почти нулевая амплитуда — просто прямая. */
function wavePath(width: number, amp: number, phase: number): string {
  if (amp < 0.05) return `M 0 ${MID} H ${width}`;
  let d = `M ${-WAVELENGTH - phase} ${MID}`;
  let i = 0;
  for (let x = -WAVELENGTH - phase; x < width + WAVELENGTH; x += WAVELENGTH / 2, i++) {
    const dir = i % 2 === 0 ? -1 : 1;
    d += ` q ${WAVELENGTH / 4} ${dir * amp * 2} ${WAVELENGTH / 2} 0`;
  }
  return d;
}

interface Props {
  /** секунды */
  value: number;
  max: number;
  /** до куда загружено, секунды */
  buffered: number;
  playing: boolean;
  onSeek(sec: number): void;
}

/**
 * Волнистый прогресс из listen-together: просмотренная часть — бегущая волна, на паузе волна
 * выпрямляется. Загруженное — светлее остатка; над курсором — время, куда перемотает.
 */
export function WaveProgress({ value, max, buffered, playing, onSeek }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const clipId = `wave-clip-${useId().replace(/:/g, '')}`;
  const anim = useRef({ amp: 0, phase: 0 });
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const wavy = playing && drag === null;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const path = pathRef.current;
    if (!path) return;
    const a = anim.current;
    const target = wavy ? AMPLITUDE : 0;
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      a.amp += (target - a.amp) * Math.min(1, dt * EASE);
      a.phase = (a.phase + dt * SPEED) % WAVELENGTH;
      const settled = !wavy && a.amp < 0.05;
      if (settled) a.amp = 0;
      path.setAttribute('d', wavePath(width, a.amp, a.phase));
      if (!settled) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [wavy, width]);

  useEffect(() => {
    if (pending !== null && Math.abs(value - pending) < SEEK_MATCH_S) setPending(null);
  }, [value, pending]);
  useEffect(() => {
    if (pending === null) return;
    const t = setTimeout(() => setPending(null), SEEK_HOLD_MS);
    return () => clearTimeout(t);
  }, [pending]);

  const shown = drag ?? pending ?? value;
  const at = (sec: number) => (max ? Math.min(1, Math.max(0, sec / max)) : 0) * width;
  const x = at(shown);
  const bx = Math.max(x, at(buffered));
  const gap = 6;

  const commit = () => {
    if (drag !== null) {
      setPending(drag);
      onSeek(drag);
    }
    setDrag(null);
  };
  const tip = drag ?? hover;

  return (
    <div
      ref={ref}
      className={`wave${drag !== null ? ' dragging' : ''}`}
      onPointerMove={(e) => {
        if (e.pointerType !== 'mouse' || !max) return;
        const r = e.currentTarget.getBoundingClientRect();
        setHover(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * max);
      }}
      onPointerLeave={() => setHover(null)}
    >
      <svg aria-hidden>
        <defs>
          <clipPath id={clipId}>
            <rect x={-CAP} y={0} width={Math.max(0, x - gap + CAP)} height={32} />
          </clipPath>
        </defs>
        {x + gap < width && <line className="wave-rest" x1={x + gap} y1={MID} x2={width} y2={MID} />}
        {x + gap < bx && <line className="wave-buffered" x1={x + gap} y1={MID} x2={bx} y2={MID} />}
        <path
          ref={pathRef}
          className="wave-line"
          clipPath={`url(#${clipId})`}
          d={wavePath(width, anim.current.amp, anim.current.phase)}
        />
        <rect className="wave-thumb" x={x - 2.5} y={6} width={5} height={20} rx={2.5} />
      </svg>
      {tip !== null && max > 0 && (
        <span className="wave-tip" style={{ left: at(tip) }}>
          {formatTime(tip)}
        </span>
      )}
      <input
        type="range"
        min={0}
        max={max || 0}
        step={0.1}
        value={Math.min(shown, max || 0)}
        disabled={!max}
        onChange={(e) => setDrag(Number(e.target.value))}
        onPointerUp={(e) => {
          commit();
          // стрелки дальше — горячие клавиши плеера, а не ползунок
          e.currentTarget.blur();
        }}
        onKeyUp={commit}
        onBlur={commit}
        aria-label="Позиция"
      />
    </div>
  );
}
