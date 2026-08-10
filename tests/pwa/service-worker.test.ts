import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

describe('generated service-worker lifecycle', () => {
  it('completes every precache request before the first install resolves', async () => {
    const runtime = loadWorker({ failPrecache: false });

    await runtime.dispatchInstall();

    expect(runtime.precachedUrls).toEqual(runtime.assetUrls);
    expect(runtime.cacheDeletes).not.toHaveBeenCalled();
  });

  it('keeps the old cache when the replacement precache fails', async () => {
    const runtime = loadWorker({ failPrecache: true });

    await expect(runtime.dispatchInstall()).rejects.toThrow('precache failed');
    expect(runtime.cacheNames).toContain('alien-artillery-old');
    expect(runtime.cacheDeletes).not.toHaveBeenCalled();
  });

  it('precaches the changed same-size manifest under its new cache identity', async () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), 'alien-artillery-worker-'));
    const manifestPath = join(outputDirectory, 'manifest.webmanifest');
    const originalManifest = readFileSync(join('public', 'manifest.webmanifest'), 'utf8');
    const changedManifest = originalManifest.replace('Alien Artillery', 'Alien Artillerx');
    expect(changedManifest).toHaveLength(originalManifest.length);

    try {
      writeFileSync(manifestPath, originalManifest, 'utf8');
      generateWorker(outputDirectory);
      const before = loadWorker({ failPrecache: false, outputDirectory });
      await before.dispatchInstall();

      writeFileSync(manifestPath, changedManifest, 'utf8');
      generateWorker(outputDirectory);
      const after = loadWorker({ failPrecache: false, outputDirectory });
      await after.dispatchInstall();

      expect(after.cacheName).not.toBe(before.cacheName);
      expect(after.cachedAsset('./manifest.webmanifest')).toBe(changedManifest);
    } finally {
      rmSync(outputDirectory, { force: true, recursive: true });
    }
  });
});

function loadWorker({
  failPrecache,
  outputDirectory = 'dist',
}: { failPrecache: boolean; outputDirectory?: string }) {
  const handlers = new Map<string, (event: { waitUntil(promise: Promise<unknown>): void }) => void>();
  const cacheNames = ['alien-artillery-old'];
  const precachedUrls: string[] = [];
  const cachedAssets = new Map<string, string>();
  const cacheDeletes = vi.fn(async (name: string) => {
    const index = cacheNames.indexOf(name);
    if (index >= 0) cacheNames.splice(index, 1);
    return true;
  });
  const caches = {
    open: vi.fn(async (name: string) => {
      if (!cacheNames.includes(name)) cacheNames.push(name);
      return {
        addAll: async (urls: string[]) => {
          if (failPrecache) throw new Error('precache failed');
          precachedUrls.push(...urls);
          for (const url of urls) cachedAssets.set(url, readFileSync(join(outputDirectory, url.slice(2)), 'utf8'));
        },
      };
    }),
    keys: async () => [...cacheNames],
    delete: cacheDeletes,
  };
  const self = {
    location: { origin: 'https://example.test' },
    clients: { claim: vi.fn() },
    addEventListener: (type: string, handler: (event: { waitUntil(promise: Promise<unknown>): void }) => void) => {
      handlers.set(type, handler);
    },
    skipWaiting: vi.fn(),
  };
  const worker = readFileSync(join(outputDirectory, 'sw.js'), 'utf8');
  vm.runInNewContext(worker, { self, caches, URL, Promise });
  const assetUrls = JSON.parse(worker.match(/const ASSET_URLS = (\[[^;]+\]);/)![1]!) as string[];
  const cacheName = worker.match(/const CACHE_NAME = "([^"]+)"/)![1]!;

  return {
    assetUrls,
    cacheName,
    cacheDeletes,
    cacheNames,
    precachedUrls,
    cachedAsset(url: string): string | undefined {
      return cachedAssets.get(url);
    },
    async dispatchInstall(): Promise<void> {
      let pending: Promise<unknown> | undefined;
      handlers.get('install')!({ waitUntil: promise => { pending = promise; } });
      await pending;
    },
  };
}

function generateWorker(outputDirectory: string): void {
  execFileSync(process.execPath, ['scripts/generate-service-worker.mjs'], {
    env: { ...process.env, PWA_OUTPUT_DIRECTORY: outputDirectory },
  });
}
