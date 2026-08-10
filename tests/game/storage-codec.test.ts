import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '../../src/game/config';
import { decodeMatch, encodeMatch } from '../../src/game/storage-codec';
import { matchFixture, storedMatchFixture } from '../helpers/fixtures';

describe('versioned match codec', () => {
  it('round-trips a destroyed terrain snapshot', () => {
    const bytes = new Uint8Array(GAME_CONFIG.worldWidth * GAME_CONFIG.worldHeight);
    bytes.set([1, 0, 1]);
    const expected = storedMatchFixture({ terrainBytes: bytes });

    const encoded = encodeMatch(expected);
    const decoded = decodeMatch(encoded);

    expect({ ...decoded, terrainBytes: undefined }).toEqual({ ...expected, terrainBytes: undefined });
    expect(decoded.terrainBytes.length).toBe(GAME_CONFIG.worldWidth * GAME_CONFIG.worldHeight);
    expect([...decoded.terrainBytes.slice(0, 3)]).toEqual([1, 0, 1]);
    expect(decoded.terrainBytes.at(-1)).toBe(0);
  });

  it('writes terrain bytes as base64 rather than a numeric object', () => {
    const bytes = new Uint8Array(GAME_CONFIG.worldWidth * GAME_CONFIG.worldHeight);
    bytes.set([1, 0, 1]);
    const encoded = encodeMatch(storedMatchFixture({ terrainBytes: bytes }));

    expect(JSON.parse(encoded).terrainBytes).toMatch(/^AQAB/);
  });

  it('rejects an unknown schema', () => {
    expect(() => decodeMatch('{"schemaVersion":99}')).toThrow('Unsupported save schema');
  });

  it('rejects a state with an invalid team roster', () => {
    const match = storedMatchFixture({ aliens: matchFixture().aliens.slice(1) });

    expect(() => encodeMatch(match)).toThrow('Invalid save state');
  });

  it('rejects corrupted terrain dimensions', () => {
    const encoded = encodeMatch(storedMatchFixture());
    const corrupted = JSON.stringify({ ...JSON.parse(encoded), terrainWidth: 0 });

    expect(() => decodeMatch(corrupted)).toThrow('Invalid save state');
  });

  it.each([
    ['short', ''],
    ['long', 'AQAB'],
  ])('rejects a %s terrain mask for its dimensions', (_length, terrainBytes) => {
    const parsed = JSON.parse(encodeMatch(storedMatchFixture())) as Record<string, unknown>;

    expect(() => decodeMatch(JSON.stringify({ ...parsed, terrainBytes })))
      .toThrow('Invalid save state');
  });

  it('rejects terrain dimensions beyond the configured world contract', () => {
    const oversized = matchFixture({
      terrainBytes: new Uint8Array(GAME_CONFIG.worldWidth + 1),
      terrainWidth: GAME_CONFIG.worldWidth + 1,
      terrainHeight: 1,
    });

    expect(() => encodeMatch(oversized)).toThrow('Invalid save state');
  });

  it('rejects a null winner when exactly one team remains alive', () => {
    const parsed = JSON.parse(encodeMatch(storedMatchFixture())) as Record<string, unknown>;
    const aliens = (parsed.aliens as Array<Record<string, unknown>>).map(alien => ({
      ...alien,
      health: alien.team === 'human' ? 0 : alien.health,
    }));

    expect(() => decodeMatch(JSON.stringify({ ...parsed, aliens, phase: 'complete', winner: null })))
      .toThrow('Invalid save state');
  });

  it('rejects a non-null winner before the match is complete', () => {
    const match = matchFixture();
    const aliens = match.aliens.map(alien => ({
      ...alien,
      health: alien.team === 'human' ? 0 : alien.health,
    }));

    expect(() => encodeMatch(storedMatchFixture({ aliens, phase: 'ready', winner: 'cpu' })))
      .toThrow('Invalid save state');
  });

  it('rejects a declared winner when neither team remains alive', () => {
    const parsed = JSON.parse(encodeMatch(storedMatchFixture())) as Record<string, unknown>;
    const aliens = (parsed.aliens as Array<Record<string, unknown>>).map(alien => ({ ...alien, health: 0 }));

    expect(() => decodeMatch(JSON.stringify({ ...parsed, aliens, phase: 'complete', winner: 'human' })))
      .toThrow('Invalid save state');
  });

  it('accepts a completed draw outcome when neither team remains alive', () => {
    const match = matchFixture();
    const draw = storedMatchFixture({
      aliens: match.aliens.map(alien => ({ ...alien, health: 0 })),
      phase: 'complete',
      winner: 'draw',
    });

    const decoded = decodeMatch(encodeMatch(draw));
    expect(decoded.winner).toBe('draw');
    expect(decoded.phase).toBe('complete');
    expect(decoded.aliens.every(alien => alien.health === 0)).toBe(true);
    expect(decoded.terrainBytes.length).toBe(GAME_CONFIG.worldWidth * GAME_CONFIG.worldHeight);
  });

  it('rejects out-of-range health and invalid phase, weapon, IDs, and winner', () => {
    const encoded = encodeMatch(storedMatchFixture());
    const parsed = JSON.parse(encoded) as Record<string, unknown>;
    const corruptions = [
      { ...parsed, aliens: [{ ...(parsed.aliens as Array<Record<string, unknown>>)[0]!, health: 101 }, ...(parsed.aliens as Array<Record<string, unknown>>).slice(1)] },
      { ...parsed, phase: 'paused' },
      { ...parsed, selectedWeapon: 'laser' },
      { ...parsed, aliens: [{ ...(parsed.aliens as Array<Record<string, unknown>>)[0]!, id: 'other' }, ...(parsed.aliens as Array<Record<string, unknown>>).slice(1)] },
      { ...parsed, winner: 'nobody' },
    ];

    for (const corruption of corruptions) {
      expect(() => decodeMatch(JSON.stringify(corruption))).toThrow('Invalid save state');
    }
  });

  it.each([
    ['projectile phase without a projectile', storedMatchFixture({ phase: 'projectile', projectile: null })],
    ['ready phase with a projectile', storedMatchFixture({
      phase: 'ready',
      projectile: {
        id: 'projectile-0', ownerId: 'human-0', weapon: 'bazooka',
        position: { x: 10, y: 10 }, velocity: { x: 1, y: 1 }, fuseRemaining: 0, ageSeconds: 1,
      },
    })],
    ['inert complete match with both teams alive', storedMatchFixture({ phase: 'complete', winner: null })],
  ])('rejects %s', (_description, impossible) => {
    expect(() => encodeMatch(impossible)).toThrow('Invalid save state');
  });

  it('rejects a defeated active roster member while that team still has survivors', () => {
    const match = storedMatchFixture();
    const aliens = match.aliens.map(candidate => candidate.id === 'human-0'
      ? { ...candidate, health: 0 }
      : candidate);

    expect(() => encodeMatch(storedMatchFixture({ aliens }))).toThrow('Invalid save state');
  });

  it('rejects non-world terrain dimensions and non-binary terrain bytes', () => {
    const small = matchFixture();
    const nonBinary = storedMatchFixture();
    nonBinary.terrainBytes[10] = 2;

    expect(() => encodeMatch(small)).toThrow('Invalid save state');
    expect(() => encodeMatch(nonBinary)).toThrow('Invalid save state');
  });

  it('rejects out-of-contract wind and timers', () => {
    expect(() => encodeMatch(storedMatchFixture({ wind: GAME_CONFIG.windMaxPixelsPerSecondSquared + 1 })))
      .toThrow('Invalid save state');
    expect(() => encodeMatch(storedMatchFixture({ humanTurnSecondsRemaining: GAME_CONFIG.humanTurnSeconds + 1 })))
      .toThrow('Invalid save state');
    expect(() => encodeMatch(storedMatchFixture({ dynamicSecondsRemaining: GAME_CONFIG.dynamicTimeoutSeconds + 1 })))
      .toThrow('Invalid save state');
  });

  it('rejects invalid projectile owners, IDs, and queued shot references', () => {
    const projectile = {
      id: 'projectile-0', ownerId: 'human-0', weapon: 'bazooka' as const,
      position: { x: 10, y: 10 }, velocity: { x: 1, y: 1 }, fuseRemaining: 0, ageSeconds: 1,
    };
    const invalidId = storedMatchFixture({
      phase: 'projectile', projectile: { ...projectile, id: 'not-this-turn' },
    });
    const invalidOwner = storedMatchFixture({
      phase: 'projectile', projectile: { ...projectile, ownerId: 'missing-owner' },
    });
    const inactiveOwner = storedMatchFixture({
      phase: 'projectile', projectile: { ...projectile, ownerId: 'cpu-0' },
    });
    const invalidShot = storedMatchFixture({
      events: [{
        type: 'shot', projectileId: 'unknown-shot', position: { x: 10, y: 10 }, aimRadians: 0,
      }],
    });

    expect(() => encodeMatch(invalidId)).toThrow('Invalid save state');
    expect(() => encodeMatch(invalidOwner)).toThrow('Invalid save state');
    expect(() => encodeMatch(inactiveOwner)).toThrow('Invalid save state');
    expect(() => encodeMatch(invalidShot)).toThrow('Invalid save state');
  });
});
