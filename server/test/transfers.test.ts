import { describe, expect, it } from 'vitest';
import { Transfers } from '../src/transfers';

describe('Transfers', () => {
  it('данные живут ttl, потом код не находится; лимит одновременных переносов', () => {
    let now = 0;
    const t = new Transfers({ ttlMs: 1000, max: 2, now: () => now });
    const a = t.put({ x: 1 })!;
    expect(t.get(a)).toEqual({ x: 1 });
    expect(t.put({ x: 2 })).not.toBeNull();
    expect(t.put({ x: 3 })).toBeNull();
    now = 1000;
    expect(t.get(a)).toBeUndefined();
    expect(t.put({ x: 4 })).not.toBeNull();
  });
});
