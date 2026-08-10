import { describe, expect, it } from 'vitest';
import { add, clamp, distance, scale, vec2 } from '../../src/game/math';

describe('vector math', () => {
  it('adds two coordinate pairs', () => {
    expect(add({ x: 4, y: -3 }, { x: -7, y: 11 })).toEqual({ x: -3, y: 8 });
  });

  it('scales each coordinate by a scalar', () => {
    expect(scale({ x: -6, y: 2.5 }, 4)).toEqual({ x: -24, y: 10 });
  });

  it('measures a three-four-five separation', () => {
    expect(distance({ x: 2, y: 8 }, { x: 5, y: 12 })).toBe(5);
  });

  it('limits values to inclusive bounds', () => {
    expect(clamp(-9, -2, 4)).toBe(-2);
    expect(clamp(1.5, -2, 4)).toBe(1.5);
    expect(clamp(12, -2, 4)).toBe(4);
  });

  it('rejects a vector with a non-finite component', () => {
    expect(() => vec2(Number.POSITIVE_INFINITY, 0)).toThrow('Vector components must be finite');
    expect(() => vec2(0, Number.NaN)).toThrow('Vector components must be finite');
  });
});
