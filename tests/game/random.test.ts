import { describe, expect, it } from 'vitest';
import { SeededRandom } from '../../src/game/random';

describe('SeededRandom', () => {
  it('repeats the first three values for the same seed', () => {
    const first = new SeededRandom(42);
    const second = new SeededRandom(42);

    expect([first.next(), first.next(), first.next()]).toEqual([
      second.next(), second.next(), second.next(),
    ]);
  });

  it('changes the sequence for a different seed', () => {
    const first = new SeededRandom(42);
    const second = new SeededRandom(43);

    expect([first.next(), first.next(), first.next()]).not.toEqual([
      second.next(), second.next(), second.next(),
    ]);
  });

  it('generates one thousand unit-interval values', () => {
    const random = new SeededRandom(7);

    for (let index = 0; index < 1_000; index += 1) {
      const value = random.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('persists the state as uint32 after incrementing across the boundary', () => {
    const random = new SeededRandom(0xffff_ffff);

    random.next();

    expect(random.currentState).toBe(0x6d2b79f4);
  });
});
