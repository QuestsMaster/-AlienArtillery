export class SeededRandom {
  private uint32State: number;

  constructor(seed: number) {
    if (!Number.isFinite(seed)) {
      throw new RangeError('Seed must be a finite number');
    }
    this.uint32State = seed >>> 0;
  }

  get currentState(): number {
    return this.uint32State;
  }

  next(): number {
    this.uint32State = (this.uint32State + 0x6d2b79f5) >>> 0;
    let value = this.uint32State;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  }
}
