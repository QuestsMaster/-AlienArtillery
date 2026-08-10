import { describe, expect, it } from 'vitest';
import { TouchControls, commandAt } from '../../src/ui/controls';
import type { Camera } from '../../src/ui/camera';

describe('touch command zones', () => {
  it('maps the visible bottom-left button to movement', () => {
    expect(commandAt({ x: 40, y: 282 }, { width: 844, height: 390 })).toEqual({ type: 'move', direction: -1 });
  });

  it('leaves blank space below the visible movement button unclaimed', () => {
    expect(commandAt({ x: 40, y: 340 }, { width: 844, height: 390 })).toBeNull();
  });

  it('keeps the safe-area inset outside of its controls', () => {
    expect(commandAt(
      { x: 10, y: 350 },
      { width: 844, height: 390, safeArea: { left: 24, right: 0, top: 0, bottom: 0 } },
    )).toBeNull();
  });

  it('suppresses game commands in portrait orientation', () => {
    expect(commandAt({ x: 40, y: 700 }, { width: 390, height: 844 })).toBeNull();
  });
});

describe('TouchControls pointer gestures', () => {
  it('captures a HUD pointer without turning its movement into a camera gesture', () => {
    const harness = controlsHarness();

    harness.element.pointer('pointerdown', 1, 40, 282);
    harness.element.pointer('pointermove', 1, 80, 200);

    expect(harness.element.capturedPointers).toEqual([1]);
    expect(harness.commands).toEqual([{ type: 'move', direction: -1 }]);
    expect(harness.cameraChanges).toEqual([]);
    harness.controls.dispose();
  });

  it('pans from a one-pointer drag in blank space below the buttons', () => {
    const harness = controlsHarness();

    harness.element.pointer('pointerdown', 2, 40, 340);
    harness.element.pointer('pointermove', 2, 60, 350);

    expect(harness.cameraChanges.at(-1)?.center).toEqual({ x: 480, y: 290 });
    harness.controls.dispose();
  });

  it('zooms from the changing distance between two free pointers', () => {
    const harness = controlsHarness();

    harness.element.pointer('pointerdown', 3, 300, 160);
    harness.element.pointer('pointerdown', 4, 500, 160);
    harness.element.pointer('pointermove', 4, 600, 160);

    expect(harness.cameraChanges.at(-1)?.zoom).toBe(1.5);
    harness.controls.dispose();
  });

  it('cancels an active camera gesture when the viewport becomes portrait', () => {
    const harness = controlsHarness();

    harness.element.pointer('pointerdown', 5, 300, 160);
    harness.element.bounds = { left: 0, top: 0, width: 390, height: 844 };
    harness.element.pointer('pointermove', 5, 320, 160);
    harness.element.pointer('pointerdown', 6, 40, 700);

    expect(harness.cameraChanges).toEqual([]);
    expect(harness.commands).toEqual([]);
    expect(harness.element.capturedPointers).toEqual([5]);
    harness.controls.dispose();
  });

  it('ends continuous walking only when the held movement pointer is released', () => {
    const harness = controlsHarness();

    harness.element.pointer('pointerdown', 7, 40, 282);
    harness.element.pointer('pointermove', 7, 80, 200);
    harness.element.pointer('pointerup', 7, 80, 200);

    expect(harness.commands).toEqual([
      { type: 'move', direction: -1 },
      { type: 'move', direction: 0 },
    ]);
    harness.controls.dispose();
  });

  it('drags the circular aim controller through live angles', () => {
    const harness = controlsHarness();

    harness.element.pointer('pointerdown', 8, 800, 277);
    harness.element.pointer('pointermove', 8, 717, 258);

    expect(harness.commands).toHaveLength(2);
    expect(harness.commands[0]).toMatchObject({ type: 'aim' });
    expect((harness.commands[0] as { angleRadians: number }).angleRadians).toBeCloseTo(0, 1);
    expect((harness.commands[1] as { angleRadians: number }).angleRadians).toBeCloseTo(-Math.PI / 2, 1);
    harness.controls.dispose();
  });

  it('charges fire while held and launches once on release', () => {
    const harness = controlsHarness();

    harness.element.pointer('pointerdown', 9, 760, 320);
    expect(harness.commands).toEqual([]);
    harness.advance(750);
    harness.element.pointer('pointerup', 9, 760, 320);

    expect(harness.commands).toEqual([{ type: 'fire', power: 0.5 }]);
    harness.controls.dispose();
  });

  it('cancels held gameplay pointers without firing when orientation is lost', () => {
    const harness = controlsHarness();

    harness.element.pointer('pointerdown', 10, 40, 282);
    harness.element.pointer('pointerdown', 11, 760, 320);
    harness.controls.cancelGameplayPointers();
    harness.element.pointer('pointerup', 11, 760, 320);

    expect(harness.commands).toEqual([
      { type: 'move', direction: -1 },
      { type: 'move', direction: 0 },
    ]);
    harness.controls.dispose();
  });
});

function controlsHarness(): {
  controls: TouchControls;
  element: FakePointerElement;
  commands: unknown[];
  cameraChanges: Camera[];
  advance(milliseconds: number): void;
} {
  const element = new FakePointerElement();
  const commands: unknown[] = [];
  const cameraChanges: Camera[] = [];
  let now = 0;
  let camera: Camera = {
    center: { x: 500, y: 300 },
    zoom: 1,
    viewport: { x: 844, y: 390 },
  };
  const controls = new TouchControls({
    element: element as unknown as HTMLElement,
    world: { width: 1_600, height: 900 },
    getCamera: () => camera,
    onCameraChange: next => {
      camera = next;
      cameraChanges.push(next);
    },
    onCommand: command => commands.push(command),
    nowMilliseconds: () => now,
  });
  return {
    controls,
    element,
    commands,
    cameraChanges,
    advance: milliseconds => { now += milliseconds; },
  };
}

type PointerListener = (event: PointerEvent) => void;

class FakePointerElement {
  bounds = { left: 0, top: 0, width: 844, height: 390 };
  readonly capturedPointers: number[] = [];
  private readonly listeners = new Map<string, Set<PointerListener>>();

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const listeners = this.listeners.get(type) ?? new Set<PointerListener>();
    listeners.add(listener as PointerListener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners.get(type)?.delete(listener as PointerListener);
  }

  setPointerCapture(pointerId: number): void {
    this.capturedPointers.push(pointerId);
  }

  getBoundingClientRect(): DOMRect {
    return this.bounds as DOMRect;
  }

  pointer(type: string, pointerId: number, clientX: number, clientY: number): void {
    const event = { pointerId, clientX, clientY } as PointerEvent;
    this.listeners.get(type)?.forEach(listener => listener(event));
  }
}
