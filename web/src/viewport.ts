import { useEffect } from 'react';

/**
 * Видимая часть окна без экранной клавиатуры — в CSS-переменные `--vvh` (высота) и `--vvtop` (сдвиг).
 * На телефоне комната прижата к ним: при открытой клавиатуре видео и поле ввода остаются на экране.
 */
export function useVisualViewport(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const update = () => {
      // пальцами приблизили страницу — раскладку не трогаем
      if (vv.scale > 1.01) return;
      root.style.setProperty('--vvh', `${vv.height}px`);
      root.style.setProperty('--vvtop', `${vv.offsetTop}px`);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      root.style.removeProperty('--vvh');
      root.style.removeProperty('--vvtop');
    };
  }, []);
}
