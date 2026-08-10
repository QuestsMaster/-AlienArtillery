import { describe, expect, it } from 'vitest';
import { TerrainMask } from '../../src/game/terrain';

describe('TerrainMask', () => {
  it('carves a circular hole without changing outside pixels', () => {
    const mask = TerrainMask.filled(20, 20);

    const removed = mask.carveCircle({ x: 10, y: 10 }, 3);

    expect(removed).toBeGreaterThan(20);
    expect(mask.isSolid(10, 10)).toBe(false);
    expect(mask.isSolid(0, 0)).toBe(true);
  });

  it('clips an edge carve to the terrain bounds', () => {
    const mask = TerrainMask.filled(6, 6);

    const removed = mask.carveCircle({ x: 0, y: 0 }, 2);

    expect(removed).toBe(6);
    expect(mask.isSolid(0, 0)).toBe(false);
    expect(mask.isSolid(5, 5)).toBe(true);
  });

  it('reports zero removed pixels when carving an already empty cavity', () => {
    const mask = TerrainMask.filled(20, 20);

    mask.carveCircle({ x: 10, y: 10 }, 3);

    expect(mask.carveCircle({ x: 10, y: 10 }, 3)).toBe(0);
  });

  it('recognizes support below a position and ignores unsupported positions', () => {
    const mask = TerrainMask.empty(12, 12);
    for (let x = 3; x <= 8; x += 1) mask.setSolid(x, 8, true);

    expect(mask.hasSupport({ x: 5, y: 6 }, 2)).toBe(true);
    expect(mask.hasSupport({ x: 1, y: 6 }, 2)).toBe(false);
    expect(mask.findSurfaceBelow({ x: 5, y: 2 }, 8)).toEqual({ x: 5, y: 8 });
    expect(mask.findSurfaceBelow({ x: 1, y: 2 }, 8)).toBeNull();
  });

  it('restores an independent copy from a snapshot', () => {
    const original = TerrainMask.filled(8, 8);
    original.carveCircle({ x: 4, y: 4 }, 2);

    const restored = TerrainMask.fromSnapshot(original.snapshot());
    restored.setSolid(0, 0, false);

    expect(restored.isSolid(4, 4)).toBe(false);
    expect(original.isSolid(0, 0)).toBe(true);
  });
});
