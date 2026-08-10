import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

describe('offline production build', () => {
  it('lists every production asset in the generated worker', () => {
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? walk(path) : [path];
    });
    const files = walk('dist').filter(path => !path.endsWith('sw.js'));
    const worker = readFileSync('dist/sw.js', 'utf8');

    for (const file of files) {
      expect(worker).toContain(JSON.stringify('./' + relative('dist', file).replaceAll('\\', '/')));
    }
  });

  it('changes cache identity when a same-size precached file changes', () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), 'alien-artillery-pwa-'));
    const manifestPath = join(outputDirectory, 'manifest.webmanifest');
    const originalManifest = readFileSync(join('public', 'manifest.webmanifest'), 'utf8');
    const changedManifest = originalManifest.replace('Alien Artillery', 'Alien Artillerx');
    expect(changedManifest).toHaveLength(originalManifest.length);

    try {
      writeFileSync(manifestPath, originalManifest, 'utf8');
      generateWorker(outputDirectory);
      const firstCacheName = cacheName(readFileSync(join(outputDirectory, 'sw.js'), 'utf8'));
      writeFileSync(manifestPath, changedManifest, 'utf8');
      generateWorker(outputDirectory);
      const secondCacheName = cacheName(readFileSync(join(outputDirectory, 'sw.js'), 'utf8'));

      expect(secondCacheName).not.toBe(firstCacheName);
    } finally {
      rmSync(outputDirectory, { force: true, recursive: true });
    }
  });
});

function generateWorker(outputDirectory: string): void {
  execFileSync(process.execPath, ['scripts/generate-service-worker.mjs'], {
    env: { ...process.env, PWA_OUTPUT_DIRECTORY: outputDirectory },
  });
}

function cacheName(worker: string): string {
  const match = worker.match(/const CACHE_NAME = "([^"]+)"/);
  if (match === null) throw new Error('Generated worker did not declare a cache name');
  return match[1]!;
}
