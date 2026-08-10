import { describe, expect, it } from 'vitest';
import { installViewportTracking } from '../../src/ui/viewport';

describe('live viewport tracking', () => {
  it('publishes initial, resize, orientation, and visual viewport dimensions', () => {
    const host = new FakeEventTarget();
    const visualViewport = new FakeEventTarget();
    const element = new FakeElement();
    const updates: Array<{ x: number; y: number }> = [];

    const dispose = installViewportTracking({
      element: element as unknown as HTMLElement,
      host,
      visualViewport,
      onViewport: viewport => updates.push(viewport),
    });
    element.width = 390;
    element.height = 844;
    host.emit('orientationchange');
    element.width = 852;
    element.height = 393;
    visualViewport.emit('resize');
    dispose();
    element.width = 1;
    host.emit('resize');

    expect(updates).toEqual([
      { x: 844, y: 390 },
      { x: 390, y: 844 },
      { x: 852, y: 393 },
    ]);
  });
});

class FakeEventTarget {
  private readonly listeners = new Map<string, Set<() => void>>();

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener as () => void);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners.get(type)?.delete(listener as () => void);
  }

  emit(type: string): void {
    this.listeners.get(type)?.forEach(listener => listener());
  }
}

class FakeElement {
  width = 844;
  height = 390;

  getBoundingClientRect(): DOMRect {
    return { left: 0, top: 0, width: this.width, height: this.height } as DOMRect;
  }
}
