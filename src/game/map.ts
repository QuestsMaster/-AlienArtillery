import { GAME_CONFIG } from './config';
import { TerrainMask } from './terrain';
import type { Vec2 } from './types';

export interface FixedMap {
  readonly terrain: TerrainMask;
  readonly spawns: Readonly<{ human: readonly Vec2[]; cpu: readonly Vec2[] }>;
}

export function createFixedMap(): FixedMap {
  const terrain = TerrainMask.empty(GAME_CONFIG.worldWidth, GAME_CONFIG.worldHeight);
  fillEllipse(terrain, { x: 800, y: 735 }, 700, 150);
  fillEllipse(terrain, { x: 720, y: 665 }, 420, 110);
  fillEllipse(terrain, { x: 1_090, y: 680 }, 300, 100);
  terrain.carveCircle({ x: 630, y: 765 }, 45);
  terrain.carveCircle({ x: 960, y: 785 }, 52);
  terrain.carveCircle({ x: 800, y: 815 }, 30);

  return {
    terrain,
    spawns: {
      human: spawnPositions(terrain, [360, 520, 680]),
      cpu: spawnPositions(terrain, [960, 1_120, 1_280]),
    },
  };
}

function fillEllipse(terrain: TerrainMask, center: Vec2, radiusX: number, radiusY: number): void {
  const minimumX = Math.max(0, Math.ceil(center.x - radiusX));
  const maximumX = Math.min(terrain.width - 1, Math.floor(center.x + radiusX));
  const minimumY = Math.max(0, Math.ceil(center.y - radiusY));
  const maximumY = Math.min(terrain.height - 1, Math.floor(center.y + radiusY));

  for (let y = minimumY; y <= maximumY; y += 1) {
    for (let x = minimumX; x <= maximumX; x += 1) {
      if (((x - center.x) / radiusX) ** 2 + ((y - center.y) / radiusY) ** 2 <= 1) {
        terrain.setSolid(x, y, true);
      }
    }
  }
}

function spawnPositions(terrain: TerrainMask, xs: readonly number[]): Vec2[] {
  return xs.map(x => {
    const surface = terrain.findSurfaceBelow({ x, y: 0 }, terrain.height);
    if (surface === null) throw new Error(`Fixed map has no surface at ${x}`);
    return { x, y: surface.y - GAME_CONFIG.alienRadius };
  });
}
