import { describe, expect, it } from 'vitest';
import { clampCamera, screenToWorld, worldToScreen } from '../../src/ui/camera';

describe('camera coordinates', () => {
  it('round-trips screen and world coordinates', () => {
    const camera = { center: { x: 500, y: 300 }, zoom: 1.5, viewport: { x: 844, y: 390 } };

    expect(screenToWorld(worldToScreen({ x: 610, y: 280 }, camera), camera))
      .toEqual({ x: 610, y: 280 });
  });

  it('clamps its zoom and center to padded world bounds', () => {
    expect(clampCamera(
      { center: { x: -100, y: 2_000 }, zoom: 8, viewport: { x: 400, y: 200 } },
      { width: 1_600, height: 900 },
      20,
    )).toEqual({ center: { x: 80, y: 870 }, zoom: 2, viewport: { x: 400, y: 200 } });
  });
});
