import { describe, expect, it } from 'vitest';
import { clockOffset, formatTime, freeze, positionAt } from '../src';

const base = { paused: false, position: 100, anchor: 1_000_000, rate: 1 as const };

describe('positionAt', () => {
  it('на паузе позиция не меняется', () => {
    expect(positionAt({ ...base, paused: true }, base.anchor + 5000)).toBe(100);
  });
  it('при игре на 1x и 2x растёт со скоростью', () => {
    expect(positionAt(base, base.anchor + 5000)).toBe(105);
    expect(positionAt({ ...base, rate: 2 }, base.anchor + 5000)).toBe(110);
  });
  it('время до anchor не уводит позицию назад', () => {
    expect(positionAt(base, base.anchor - 3000)).toBe(100);
  });
  it('freeze переносит позицию на новый anchor', () => {
    expect(freeze({ ...base, rate: 2 }, base.anchor + 1000)).toMatchObject({
      position: 102,
      anchor: base.anchor + 1000,
    });
  });
});

describe('clockOffset', () => {
  it('медиана из 5 замеров игнорирует выброс', () => {
    // настоящее смещение +500 мс, RTT 40 мс; один замер с огромной задержкой
    const s = (t0: number, rtt: number) => ({ t0, server: t0 + rtt / 2 + 500, t1: t0 + rtt });
    const samples = [
      s(0, 40),
      s(100, 40),
      s(200, 40),
      s(300, 40),
      { t0: 400, server: 400 + 2000, t1: 400 + 40 },
    ];
    expect(clockOffset(samples)).toBe(500);
  });
  it('без замеров — 0', () => expect(clockOffset([])).toBe(0));
});

describe('formatTime', () => {
  it('форматирует минуты и часы', () => {
    expect(formatTime(75)).toBe('1:15');
    expect(formatTime(3725)).toBe('1:02:05');
  });
});
