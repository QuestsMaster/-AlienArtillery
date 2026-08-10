import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('PWA manifest', () => {
  it('declares a standalone landscape application', () => {
    const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8')) as Record<string, unknown>;

    expect(manifest.display).toBe('standalone');
    expect(manifest.orientation).toBe('landscape');
    expect(manifest.start_url).toBe('./');
  });
});
