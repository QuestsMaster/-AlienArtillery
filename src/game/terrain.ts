import type { Vec2 } from './types';

export interface TerrainSnapshot {
  readonly width: number;
  readonly height: number;
  readonly bytes: Uint8Array;
}

export interface TerrainProbe {
  hasSupport(position: Vec2, footRadius: number): boolean;
  isSolid(x: number, y: number): boolean;
}

export class TerrainMask {
  private constructor(
    public readonly width: number,
    public readonly height: number,
    private readonly pixels: Uint8Array,
  ) {}

  static empty(width: number, height: number): TerrainMask {
    return new TerrainMask(width, height, createPixels(width, height));
  }

  static filled(width: number, height: number): TerrainMask {
    const pixels = createPixels(width, height);
    pixels.fill(1);
    return new TerrainMask(width, height, pixels);
  }

  static fromSnapshot(snapshot: TerrainSnapshot): TerrainMask {
    const pixels = createPixels(snapshot.width, snapshot.height);
    if (snapshot.bytes.length !== pixels.length) {
      throw new RangeError('Terrain snapshot dimensions do not match its bytes');
    }
    pixels.set(snapshot.bytes);
    return new TerrainMask(snapshot.width, snapshot.height, pixels);
  }

  isSolid(x: number, y: number): boolean {
    if (!this.contains(x, y)) return false;
    return this.pixels[this.index(x, y)] !== 0;
  }

  setSolid(x: number, y: number, solid: boolean): void {
    if (!this.contains(x, y)) return;
    this.pixels[this.index(x, y)] = solid ? 1 : 0;
  }

  carveCircle(center: Vec2, radius: number): number {
    if (!Number.isFinite(radius) || radius < 0) {
      throw new RangeError('Terrain carve radius must be non-negative and finite');
    }

    const radiusSquared = radius * radius;
    const minimumX = Math.max(0, Math.ceil(center.x - radius));
    const maximumX = Math.min(this.width - 1, Math.floor(center.x + radius));
    const minimumY = Math.max(0, Math.ceil(center.y - radius));
    const maximumY = Math.min(this.height - 1, Math.floor(center.y + radius));
    let removed = 0;

    for (let y = minimumY; y <= maximumY; y += 1) {
      for (let x = minimumX; x <= maximumX; x += 1) {
        const distanceSquared = (x - center.x) ** 2 + (y - center.y) ** 2;
        if (distanceSquared <= radiusSquared && this.isSolid(x, y)) {
          this.setSolid(x, y, false);
          removed += 1;
        }
      }
    }
    return removed;
  }

  hasSupport(position: Vec2, footRadius: number): boolean {
    if (!Number.isFinite(footRadius) || footRadius < 0) return false;
    const y = Math.round(position.y + footRadius);
    return [-0.65, 0, 0.65].some(offset => this.isSolid(
      Math.round(position.x + offset * footRadius),
      y,
    ));
  }

  findSurfaceBelow(position: Vec2, maxDistance: number): Vec2 | null {
    if (!Number.isFinite(maxDistance) || maxDistance < 0) return null;
    const x = Math.round(position.x);
    const startY = Math.ceil(position.y);
    const endY = Math.floor(position.y + maxDistance);

    for (let y = startY; y <= endY; y += 1) {
      if (this.isSolid(x, y)) return { x, y };
    }
    return null;
  }

  snapshot(): TerrainSnapshot {
    return { width: this.width, height: this.height, bytes: new Uint8Array(this.pixels) };
  }

  private contains(x: number, y: number): boolean {
    return Number.isInteger(x) && Number.isInteger(y)
      && x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  private index(x: number, y: number): number {
    return y * this.width + x;
  }
}

function createPixels(width: number, height: number): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError('Terrain dimensions must be positive integers');
  }
  return new Uint8Array(width * height);
}
