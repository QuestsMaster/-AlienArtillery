import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('offline-ready status placement', () => {
  it('anchors the offline status inside the visible safe area above the canvas', () => {
    const stylesheet = readFileSync('src/styles.css', 'utf8');
    const rules = [...stylesheet.matchAll(/#offline-status\s*\{([^}]*)}/gs)];
    const rule = rules.at(-1)?.[1] ?? '';

    expect(rule).toMatch(/right:\s*max\(/);
    expect(rule).toMatch(/top:\s*max\(/);
    expect(rule).toMatch(/z-index:\s*[1-9]/);
    expect(rule).toMatch(/background:/);
  });
});
