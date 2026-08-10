import type { Vec2 } from '../game/types';

export interface ViewportEventSource {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

export interface ViewportTrackingOptions {
  readonly element: HTMLElement;
  readonly host: ViewportEventSource;
  readonly visualViewport?: ViewportEventSource;
  readonly onViewport: (viewport: Vec2) => void;
}

export function installViewportTracking(options: ViewportTrackingOptions): () => void {
  const update: EventListener = () => options.onViewport(viewportFor(options.element));
  options.host.addEventListener('resize', update);
  options.host.addEventListener('orientationchange', update);
  options.visualViewport?.addEventListener('resize', update);
  update(new Event('resize'));

  return () => {
    options.host.removeEventListener('resize', update);
    options.host.removeEventListener('orientationchange', update);
    options.visualViewport?.removeEventListener('resize', update);
  };
}

export function viewportFor(element: HTMLElement): Vec2 {
  const bounds = element.getBoundingClientRect();
  return { x: Math.max(1, bounds.width), y: Math.max(1, bounds.height) };
}
