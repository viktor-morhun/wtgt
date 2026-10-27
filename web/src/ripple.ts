/** Касание, которое ещё может оказаться прокруткой, — отклик ждёт столько. */
export const PRESS_DELAY_MS = 90;
/** Палец сдвинулся дальше — это прокрутка, не нажатие. */
export const PRESS_MOVE_PX = 8;
/** Быстрый тап: нажатие видно хотя бы столько. */
const TAP_HOLD_MS = 140;

function wave(el: HTMLElement, x: number, y: number): void {
  const rect = el.getBoundingClientRect();
  const size = Math.hypot(rect.width, rect.height) * 2;
  const w = document.createElement('span');
  w.className = 'rp-wave';
  w.style.width = w.style.height = `${size}px`;
  w.style.left = `${x - rect.left - size / 2}px`;
  w.style.top = `${y - rect.top - size / 2}px`;
  el.appendChild(w);
  w.addEventListener('animationend', () => w.remove(), { once: true });
}

/**
 * Material-рипплы и нажатие (`.is-pressed`) на любом элементе с классом `.rp`. Пальцем отклик
 * откладывается на {@link PRESS_DELAY_MS}: если касание стало прокруткой, строка под пальцем
 * не мигает и не сжимается — иначе список при прокрутке перерисовывается на каждое касание.
 */
export function installRipples(): void {
  let pending: { el: HTMLElement; x: number; y: number; timer: ReturnType<typeof setTimeout> | null } | null =
    null;
  let pressed: HTMLElement | null = null;

  const release = () => {
    pressed?.classList.remove('is-pressed');
    pressed = null;
  };
  const press = (el: HTMLElement, x: number, y: number) => {
    release();
    pressed = el;
    el.classList.add('is-pressed');
    wave(el, x, y);
  };
  const cancel = () => {
    if (pending?.timer) clearTimeout(pending.timer);
    pending = null;
    release();
  };

  document.addEventListener(
    'pointerdown',
    (e) => {
      cancel();
      const el = (e.target as Element | null)?.closest?.('.rp') as HTMLElement | null;
      if (!el || (el as HTMLButtonElement).disabled) return;
      if (e.pointerType === 'mouse') return press(el, e.clientX, e.clientY);
      const p = { el, x: e.clientX, y: e.clientY, timer: null as ReturnType<typeof setTimeout> | null };
      p.timer = setTimeout(() => {
        p.timer = null;
        press(el, p.x, p.y);
      }, PRESS_DELAY_MS);
      pending = p;
    },
    { passive: true },
  );
  document.addEventListener(
    'pointermove',
    (e) => {
      if (pending && Math.hypot(e.clientX - pending.x, e.clientY - pending.y) > PRESS_MOVE_PX) cancel();
    },
    { passive: true },
  );
  document.addEventListener(
    'pointerup',
    () => {
      const p = pending;
      pending = null;
      if (p?.timer) {
        // быстрый тап: отклик всё равно показываем, коротко
        clearTimeout(p.timer);
        press(p.el, p.x, p.y);
        const el = p.el;
        setTimeout(() => {
          if (pressed === el) release();
        }, TAP_HOLD_MS);
        return;
      }
      release();
    },
    { passive: true },
  );
  // прокрутка забрала касание
  document.addEventListener('pointercancel', cancel, { passive: true });
  document.addEventListener('scroll', cancel, { passive: true, capture: true });
}
