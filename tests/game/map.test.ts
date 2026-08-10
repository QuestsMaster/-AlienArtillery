import { describe, expect, it } from 'vitest';
import { createFixedMap } from '../../src/game/map';

describe('fixed map', () => {
  it('provides three valid spawns per team', () => {
    const map = createFixedMap();

    expect(map.spawns.human).toHaveLength(3);
    expect(map.spawns.cpu).toHaveLength(3);
    for (const position of [...map.spawns.human, ...map.spawns.cpu]) {
      expect(map.terrain.hasSupport(position, 18)).toBe(true);
    }
  });
});
