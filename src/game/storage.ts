import { decodeMatch, encodeMatch } from './storage-codec';
import type { MatchState } from './types';

const DATABASE_NAME = 'alien-artillery';
const STORE_NAME = 'matches';
const CURRENT_MATCH_KEY = 'current';

export interface MatchStorageAdapter {
  get(key: string): Promise<unknown>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export type MatchLoadResult =
  | { status: 'empty' }
  | { status: 'loaded'; match: MatchState }
  | { status: 'invalid' }
  | { status: 'error' };

export class MatchRepository {
  constructor(private readonly adapter: MatchStorageAdapter = new IndexedDbMatchStorageAdapter()) {}

  async load(): Promise<MatchLoadResult> {
    const stored = await this.adapter.get(CURRENT_MATCH_KEY);
    if (stored === undefined) return { status: 'empty' };
    if (typeof stored !== 'string') return { status: 'invalid' };

    try {
      return { status: 'loaded', match: decodeMatch(stored) };
    } catch {
      return { status: 'invalid' };
    }
  }

  async save(match: MatchState): Promise<void> {
    await this.adapter.put(CURRENT_MATCH_KEY, encodeMatch(match));
  }

  async clear(): Promise<void> {
    await this.adapter.delete(CURRENT_MATCH_KEY);
  }
}

export class IndexedDbMatchStorageAdapter implements MatchStorageAdapter {
  private databasePromise: Promise<IDBDatabase> | undefined;

  async get(key: string): Promise<unknown> {
    const store = await this.store('readonly');
    return requestResult(store.get(key));
  }

  async put(key: string, value: string): Promise<void> {
    const store = await this.store('readwrite');
    await transactionResult(store.transaction, store.put(value, key));
  }

  async delete(key: string): Promise<void> {
    const store = await this.store('readwrite');
    await transactionResult(store.transaction, store.delete(key));
  }

  private async store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    const database = await this.database();
    return database.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
  }

  private database(): Promise<IDBDatabase> {
    if (this.databasePromise === undefined) {
      if (typeof indexedDB === 'undefined') {
        throw new Error('IndexedDB is unavailable');
      }
      this.databasePromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DATABASE_NAME, 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(STORE_NAME)) {
            request.result.createObjectStore(STORE_NAME);
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Unable to open match storage'));
      });
    }
    return this.databasePromise;
  }
}

function requestResult(request: IDBRequest): Promise<unknown> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Match storage request failed'));
  });
}

function transactionResult(transaction: IDBTransaction, request: IDBRequest): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? request.error ?? new Error('Match storage transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? request.error ?? new Error('Match storage transaction aborted'));
  });
}
