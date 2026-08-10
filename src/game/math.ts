import type { Vec2 } from './types';

const VECTOR_FINITE_ERROR = 'Vector components must be finite';
const NUMBER_FINITE_ERROR = 'Number must be finite';

export function vec2(x: number, y: number): Vec2 {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new RangeError(VECTOR_FINITE_ERROR);
  }
  return { x, y };
}

export function assertFiniteVec2(vector: Vec2): Vec2 {
  if (!Number.isFinite(vector.x) || !Number.isFinite(vector.y)) {
    throw new RangeError(VECTOR_FINITE_ERROR);
  }
  return vector;
}

export function add(left: Vec2, right: Vec2): Vec2 {
  assertFiniteVec2(left);
  assertFiniteVec2(right);
  return vec2(left.x + right.x, left.y + right.y);
}

export function scale(vector: Vec2, scalar: number): Vec2 {
  assertFiniteVec2(vector);
  assertFiniteNumber(scalar);
  return vec2(vector.x * scalar, vector.y * scalar);
}

export function distance(left: Vec2, right: Vec2): number {
  assertFiniteVec2(left);
  assertFiniteVec2(right);
  return Math.hypot(right.x - left.x, right.y - left.y);
}

export function clamp(value: number, minimum: number, maximum: number): number {
  assertFiniteNumber(value);
  assertFiniteNumber(minimum);
  assertFiniteNumber(maximum);
  if (minimum > maximum) {
    throw new RangeError('Minimum cannot exceed maximum');
  }
  return Math.min(Math.max(value, minimum), maximum);
}

function assertFiniteNumber(value: number): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(NUMBER_FINITE_ERROR);
  }
}
