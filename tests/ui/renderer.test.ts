import { describe, expect, it } from 'vitest';
import { CanvasRenderer, recoveryHudTop, rosterLayout } from '../../src/ui/renderer';
import { matchFixture } from '../helpers/fixtures';

describe('CanvasRenderer effects', () => {
  it('rebuilds the retained terrain canvas only when the snapshot identity changes', () => {
    const { canvas } = recordingCanvas();
    const offscreen = recordingCanvas();
    const renderer = new CanvasRenderer(canvas, { createTerrainCanvas: () => offscreen.canvas });
    const first = { width: 2, height: 1, bytes: new Uint8Array([1, 0]) };

    renderer.render(
      matchFixture(), first,
      { center: { x: 800, y: 450 }, zoom: 1, viewport: { x: 844, y: 390 } },
    );
    const initialDraws = offscreen.calls.filter(call => call.method === 'fillRect').length;
    renderer.render(
      matchFixture(), first,
      { center: { x: 800, y: 450 }, zoom: 1, viewport: { x: 844, y: 390 } },
    );
    renderer.render(
      matchFixture(), { ...first, bytes: new Uint8Array([0, 1]) },
      { center: { x: 800, y: 450 }, zoom: 1, viewport: { x: 844, y: 390 } },
    );

    expect(initialDraws).toBeGreaterThan(0);
    expect(offscreen.calls.filter(call => call.method === 'fillRect')).toHaveLength(initialDraws + 1);
  });
  it('draws a shot muzzle effect at the active alien', () => {
    const { canvas, calls } = recordingCanvas();
    const match = matchFixture({ events: [{
      type: 'shot',
      projectileId: 'projectile-0',
      position: { x: 180, y: 720 },
      aimRadians: 0,
    }] });
    const renderer = new CanvasRenderer(canvas);

    renderer.render(
      match,
      { width: 1, height: 1, bytes: new Uint8Array([0]) },
      { center: { x: 800, y: 450 }, zoom: 1, viewport: { x: 844, y: 390 } },
    );

    expect(calls).toContainEqual({ method: 'arc', args: [202, 720, 8, 0, Math.PI * 2] });
  });

  it('keeps a queued shot effect at its original muzzle after the turn changes', () => {
    const { canvas, calls } = recordingCanvas();
    const match = matchFixture({
      activeTeam: 'cpu',
      events: [{
        type: 'shot',
        projectileId: 'projectile-0',
        position: { x: 50, y: 60 },
        aimRadians: 0,
      }],
    });
    const renderer = new CanvasRenderer(canvas);

    renderer.render(
      match,
      { width: 1, height: 1, bytes: new Uint8Array([0]) },
      { center: { x: 800, y: 450 }, zoom: 1, viewport: { x: 844, y: 390 } },
    );

    expect(calls).toContainEqual({ method: 'arc', args: [72, 60, 8, 0, Math.PI * 2] });
  });

  it('retains an explosion long enough to survive the controller event handoff', () => {
    const { canvas, calls } = recordingCanvas();
    let now = 0;
    const renderer = new CanvasRenderer(canvas, { nowMilliseconds: () => now });
    const event = { type: 'explosion', position: { x: 90, y: 80 }, radius: 54 } as const;

    renderer.render(
      matchFixture({ events: [event] }),
      { width: 1, height: 1, bytes: new Uint8Array([0]) },
      { center: { x: 800, y: 450 }, zoom: 1, viewport: { x: 844, y: 390 } },
    );
    calls.splice(0);
    now = 100;
    renderer.render(
      matchFixture({ events: [] }),
      { width: 1, height: 1, bytes: new Uint8Array([0]) },
      { center: { x: 800, y: 450 }, zoom: 1, viewport: { x: 844, y: 390 } },
    );

    expect(calls).toContainEqual({ method: 'arc', args: [90, 80, 54, 0, Math.PI * 2] });
  });

  it.each([
    { width: 844, height: 390, safeArea: { left: 47, right: 0, top: 0, bottom: 0 } },
    { width: 852, height: 393, safeArea: { left: 0, right: 47, top: 0, bottom: 0 } },
  ])('keeps six portrait cells visible below the persistent status-panel band at $width×$height', ({ width, height, safeArea }) => {
    const cells = rosterLayout({ x: width, y: height }, safeArea);

    expect(cells).toHaveLength(6);
    expect(cells.every(cell => cell.x >= safeArea.left && cell.x + cell.size <= width - safeArea.right)).toBe(true);
    expect(cells.every(cell => cell.y >= safeArea.top + 64)).toBe(true);
    expect(cells.every((cell, index) => index === 0 || cells[index - 1].x + cells[index - 1].size < cell.x)).toBe(true);
  });

  it.each([
    { width: 844, height: 390, safeArea: { left: 47, right: 0, top: 0, bottom: 0 } },
    { width: 852, height: 393, safeArea: { left: 0, right: 47, top: 0, bottom: 0 } },
  ])('places a non-empty recovery panel below all six readable portraits', ({ width, height, safeArea }) => {
    const cells = rosterLayout({ x: width, y: height }, safeArea);
    const recoveryPanel = {
      x: safeArea.left,
      y: recoveryHudTop({ x: width, y: height }, safeArea),
      width: Math.min(544, width - safeArea.left - safeArea.right - 16),
      height: 82,
    };

    expect(cells).toHaveLength(6);
    expect(cells.every(cell => (
      cell.x + cell.size <= recoveryPanel.x
      || recoveryPanel.x + recoveryPanel.width <= cell.x
      || cell.y + cell.size <= recoveryPanel.y
      || recoveryPanel.y + recoveryPanel.height <= cell.y
    ))).toBe(true);
    expect(cells.every(cell => cell.x >= safeArea.left && cell.x + cell.size <= width - safeArea.right)).toBe(true);
    expect(cells.every((cell, index) => index === 0 || cells[index - 1].x + cells[index - 1].size < cell.x)).toBe(true);
  });

  it('renders six recognizable portrait calls with active, defeated, and health states', () => {
    const { canvas, calls } = recordingCanvas();
    const base = matchFixture();
    const match = matchFixture({
      activeAlienIndex: { human: 1, cpu: 0 },
      aliens: base.aliens.map(candidate => candidate.id === 'cpu-1'
        ? { ...candidate, health: 0 }
        : candidate),
    });
    const renderer = new CanvasRenderer(canvas);

    renderer.render(
      match,
      { width: 1, height: 1, bytes: new Uint8Array([0]) },
      { center: { x: 800, y: 450 }, zoom: 1, viewport: { x: 844, y: 390 } },
    );

    const portraitHeads = calls.filter(call => call.method === 'arc' && call.args[2] === 12);
    const labels = calls.filter(call => call.method === 'fillText').map(call => call.args[0]);
    expect(portraitHeads).toHaveLength(6);
    expect(labels).toEqual(expect.arrayContaining(['ACTIVE', 'DEFEATED', '100', '0']));
  });

  it.each([
    ['human', 'HUMAN WINS'],
    ['cpu', 'CPU WINS'],
    ['draw', 'DRAW'],
  ] as const)('renders the terminal %s presentation', (winner, label) => {
    const { canvas, calls } = recordingCanvas();
    const renderer = new CanvasRenderer(canvas);

    renderer.render(
      matchFixture({ phase: 'complete', winner }),
      { width: 1, height: 1, bytes: new Uint8Array([0]) },
      { center: { x: 800, y: 450 }, zoom: 1, viewport: { x: 844, y: 390 } },
    );

    expect(calls).toContainEqual(expect.objectContaining({ method: 'fillText', args: expect.arrayContaining([label]) }));
  });
});

interface RecordedCall {
  readonly method: string;
  readonly args: unknown[];
}

function recordingCanvas(): { canvas: HTMLCanvasElement; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const context = new Proxy<Record<string, unknown>>({}, {
    get: (_target, property) => {
      if (property === 'createLinearGradient') {
        return () => ({ addColorStop: () => undefined });
      }
      return (...args: unknown[]) => calls.push({ method: String(property), args });
    },
  });
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
  } as unknown as HTMLCanvasElement;
  return { canvas, calls };
}
