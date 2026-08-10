import { GAME_CONFIG } from '../game/config';
import { clamp } from '../game/math';
import type { CameraState, Vec2 } from '../game/types';

export interface Camera extends CameraState {}

export interface WorldBounds {
  readonly width: number;
  readonly height: number;
}

export function worldToScreen(point: Vec2, camera: Camera): Vec2 {
  return {
    x: camera.viewport.x / 2 + (point.x - camera.center.x) * camera.zoom,
    y: camera.viewport.y / 2 + (point.y - camera.center.y) * camera.zoom,
  };
}

export function screenToWorld(point: Vec2, camera: Camera): Vec2 {
  return {
    x: camera.center.x + (point.x - camera.viewport.x / 2) / camera.zoom,
    y: camera.center.y + (point.y - camera.viewport.y / 2) / camera.zoom,
  };
}

export function clampCamera(camera: Camera, world: WorldBounds, padding: number = 24): Camera {
  assertPositiveFinite('World width', world.width);
  assertPositiveFinite('World height', world.height);
  assertNonNegativeFinite('Camera padding', padding);
  assertPositiveFinite('Viewport width', camera.viewport.x);
  assertPositiveFinite('Viewport height', camera.viewport.y);

  const zoom = clamp(camera.zoom, GAME_CONFIG.minZoom, GAME_CONFIG.maxZoom);
  const halfWidth = camera.viewport.x / (zoom * 2);
  const halfHeight = camera.viewport.y / (zoom * 2);

  return {
    center: {
      x: clampToVisibleBounds(camera.center.x, halfWidth, world.width, padding),
      y: clampToVisibleBounds(camera.center.y, halfHeight, world.height, padding),
    },
    zoom,
    viewport: { x: camera.viewport.x, y: camera.viewport.y },
  };
}

function clampToVisibleBounds(value: number, halfViewport: number, worldSize: number, padding: number): number {
  assertFinite('Camera center', value);
  const minimum = halfViewport - padding;
  const maximum = worldSize - halfViewport + padding;
  return minimum > maximum ? worldSize / 2 : clamp(value, minimum, maximum);
}

function assertPositiveFinite(name: string, value: number): void {
  assertFinite(name, value);
  if (value <= 0) throw new RangeError(`${name} must be positive`);
}

function assertNonNegativeFinite(name: string, value: number): void {
  assertFinite(name, value);
  if (value < 0) throw new RangeError(`${name} must be non-negative`);
}

function assertFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
}
