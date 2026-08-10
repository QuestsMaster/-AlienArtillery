import { describe, expect, it } from 'vitest';
import { MatchRepository } from '../../src/game/storage';
import { encodeMatch } from '../../src/game/storage-codec';
import { storedMatchFixture } from '../helpers/fixtures';

class DeterministicAdapter {
  readonly records = new Map<string, string>();

  async get(key: string): Promise<string | undefined> {
    return this.records.get(key);
  }

  async put(key: string, value: string): Promise<void> {
    this.records.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.records.delete(key);
  }
}

describe('match repository', () => {
  it('reports empty when no match has been saved', async () => {
    const repository = new MatchRepository(new DeterministicAdapter());

    await expect(repository.load()).resolves.toEqual({ status: 'empty' });
  });

  it('loads the complete match saved in its single current record', async () => {
    const adapter = new DeterministicAdapter();
    const repository = new MatchRepository(adapter);
    const match = storedMatchFixture();

    await repository.save(match);

    const loaded = await repository.load();
    expect(loaded.status).toBe('loaded');
    if (loaded.status !== 'loaded') throw new Error('Expected loaded match');
    expect({ ...loaded.match, terrainBytes: undefined }).toEqual({ ...match, terrainBytes: undefined });
    expect(loaded.match.terrainBytes.length).toBe(match.terrainBytes.length);
    expect(adapter.records).toEqual(new Map([['current', encodeMatch(match)]]));
  });

  it('atomically overwrites the current match', async () => {
    const repository = new MatchRepository(new DeterministicAdapter());
    const first = storedMatchFixture({ seed: 1 });
    const second = storedMatchFixture({ seed: 2 });

    await repository.save(first);
    await repository.save(second);

    const loaded = await repository.load();
    expect(loaded.status).toBe('loaded');
    if (loaded.status !== 'loaded') throw new Error('Expected loaded match');
    expect(loaded.match.seed).toBe(2);
    expect(loaded.match.terrainBytes.length).toBe(second.terrainBytes.length);
  });

  it('reports an invalid record without deleting it', async () => {
    const adapter = new DeterministicAdapter();
    adapter.records.set('current', '{"schemaVersion":99}');
    const repository = new MatchRepository(adapter);

    await expect(repository.load()).resolves.toEqual({ status: 'invalid' });
    expect(adapter.records.get('current')).toBe('{"schemaVersion":99}');
  });

  it('clears the current match only when explicitly asked', async () => {
    const adapter = new DeterministicAdapter();
    const repository = new MatchRepository(adapter);
    await repository.save(storedMatchFixture());

    await repository.clear();

    await expect(repository.load()).resolves.toEqual({ status: 'empty' });
  });
});
