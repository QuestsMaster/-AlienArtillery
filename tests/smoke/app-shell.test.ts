import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('app shell', () => {
  it('contains the canvas and offline status', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).toContain('id="game"');
    expect(html).toContain('id="offline-status"');
  });
});
