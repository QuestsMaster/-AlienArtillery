import { clampCamera } from './camera';
import type { Camera, WorldBounds } from './camera';
import type { GameCommand, Vec2 } from '../game/types';

export interface SafeAreaInsets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface ControlViewport {
  readonly width: number;
  readonly height: number;
  readonly safeArea?: Partial<SafeAreaInsets>;
}

export interface ControlRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type ControlId = 'move-left' | 'jump' | 'move-right' | 'bazooka' | 'grenade' | 'aim' | 'fire';

export interface ControlButton {
  readonly id: ControlId;
  readonly rect: ControlRect;
}

export interface ControlLayout {
  readonly buttons: readonly ControlButton[];
}

export interface TouchControlsOptions {
  readonly element: HTMLElement;
  readonly world: WorldBounds;
  readonly getCamera: () => Camera;
  readonly onCameraChange: (camera: Camera) => void;
  readonly onCommand: (command: GameCommand) => void;
  readonly getSafeArea?: () => Partial<SafeAreaInsets>;
  readonly isPortrait?: () => boolean;
  readonly nowMilliseconds?: () => number;
}

const EMPTY_SAFE_AREA: SafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const FIRE_CHARGE_MILLISECONDS = 1_500;

export function commandAt(point: Vec2, viewport: ControlViewport): GameCommand | null {
  const button = controlLayout(viewport)?.buttons.find(candidate => contains(candidate.rect, point));
  if (button === undefined) return null;

  switch (button.id) {
    case 'move-left': return { type: 'move', direction: -1 };
    case 'jump': return { type: 'jump' };
    case 'move-right': return { type: 'move', direction: 1 };
    case 'bazooka': return { type: 'select-weapon', weapon: 'bazooka' };
    case 'grenade': return { type: 'select-weapon', weapon: 'grenade' };
    case 'aim': return { type: 'aim', angleRadians: aimAngle(point, button.rect) };
    case 'fire': return null;
  }
}

export function controlLayout(viewport: ControlViewport): ControlLayout | null {
  if (viewport.width <= viewport.height) return null;

  const safe = safeAreaFor(viewport);
  const availableHeight = viewport.height - safe.top - safe.bottom;
  const top = viewport.height - safe.bottom - Math.min(144, availableHeight * 0.36);
  const availableWidth = viewport.width - safe.left - safe.right;
  const leftEnd = safe.left + availableWidth * 0.3;
  const movementWidth = (leftEnd - safe.left) / 3 - 12;
  const weaponStart = safe.left + availableWidth * 0.35;
  const weaponEnd = safe.left + availableWidth * 0.65;
  const weaponWidth = (weaponEnd - weaponStart) / 2 - 4;
  const aimStart = safe.left + availableWidth * 0.7;

  return { buttons: [
    { id: 'move-left', rect: { x: safe.left + 8, y: top + 8, width: movementWidth, height: 48 } },
    { id: 'jump', rect: { x: safe.left + (leftEnd - safe.left) / 3 + 2, y: top + 8, width: movementWidth, height: 48 } },
    { id: 'move-right', rect: { x: safe.left + (leftEnd - safe.left) * 2 / 3 - 4, y: top + 8, width: movementWidth, height: 48 } },
    { id: 'bazooka', rect: { x: weaponStart, y: top + 8, width: weaponWidth, height: 38 } },
    { id: 'grenade', rect: { x: (weaponStart + weaponEnd) / 2 + 4, y: top + 8, width: weaponWidth, height: 38 } },
    { id: 'aim', rect: { x: aimStart, y: top + 8, width: viewport.width - safe.right - aimStart, height: 38 } },
    { id: 'fire', rect: { x: aimStart, y: top + 52, width: viewport.width - safe.right - aimStart, height: 38 } },
  ] };
}

export class TouchControls {
  private readonly freePointers = new Map<number, Vec2>();
  private readonly gameplayPointers = new Map<number, GameplayPointer>();
  private pinchDistance: number | null = null;

  constructor(private readonly options: TouchControlsOptions) {
    options.element.addEventListener('pointerdown', this.onPointerDown);
    options.element.addEventListener('pointermove', this.onPointerMove);
    options.element.addEventListener('pointerup', this.onPointerEnd);
    options.element.addEventListener('pointercancel', this.onPointerCancel);
  }

  dispose(): void {
    const { element } = this.options;
    element.removeEventListener('pointerdown', this.onPointerDown);
    element.removeEventListener('pointermove', this.onPointerMove);
    element.removeEventListener('pointerup', this.onPointerEnd);
    element.removeEventListener('pointercancel', this.onPointerCancel);
    this.cancelGameplayPointers();
    this.freePointers.clear();
    this.pinchDistance = null;
  }

  cancelGameplayPointers(): void {
    if ([...this.gameplayPointers.values()].some(pointer => pointer.control === 'move-left' || pointer.control === 'move-right')) {
      this.options.onCommand({ type: 'move', direction: 0 });
    }
    this.gameplayPointers.clear();
    this.freePointers.clear();
    this.pinchDistance = null;
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    const viewport = this.viewport();
    const point = this.pointFor(event);
    if (this.portrait(viewport)) return;

    const button = controlAt(point, viewport);
    if (button !== undefined) {
      this.options.element.setPointerCapture(event.pointerId);
      this.gameplayPointers.set(event.pointerId, {
        control: button.id,
        startedAt: this.nowMilliseconds(),
      });
      switch (button.id) {
        case 'move-left':
          this.options.onCommand({ type: 'move', direction: -1 });
          return;
        case 'move-right':
          this.options.onCommand({ type: 'move', direction: 1 });
          return;
        case 'jump':
          this.options.onCommand({ type: 'jump' });
          return;
        case 'bazooka':
          this.options.onCommand({ type: 'select-weapon', weapon: 'bazooka' });
          return;
        case 'grenade':
          this.options.onCommand({ type: 'select-weapon', weapon: 'grenade' });
          return;
        case 'aim':
          this.options.onCommand({ type: 'aim', angleRadians: aimAngle(point, button.rect) });
          return;
        case 'fire':
          return;
      }
    }

    this.options.element.setPointerCapture(event.pointerId);
    this.freePointers.set(event.pointerId, point);
    this.pinchDistance = this.freePointers.size === 2 ? this.pointerDistance() : null;
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const gameplay = this.gameplayPointers.get(event.pointerId);
    if (gameplay !== undefined) {
      const viewport = this.viewport();
      if (this.portrait(viewport)) {
        this.cancelGameplayPointers();
        return;
      }
      if (gameplay.control === 'aim') {
        const button = controlLayout(viewport)?.buttons.find(candidate => candidate.id === 'aim');
        if (button !== undefined) {
          this.options.onCommand({ type: 'aim', angleRadians: aimAngle(this.pointFor(event), button.rect) });
        }
      }
      return;
    }
    const previous = this.freePointers.get(event.pointerId);
    if (previous === undefined) return;

    if (this.portrait(this.viewport())) {
      this.cancelGameplayPointers();
      return;
    }

    const point = this.pointFor(event);
    this.freePointers.set(event.pointerId, point);
    if (this.freePointers.size === 1) {
      const camera = this.options.getCamera();
      this.options.onCameraChange(clampCamera({
        ...camera,
        center: {
          x: camera.center.x - (point.x - previous.x) / camera.zoom,
          y: camera.center.y - (point.y - previous.y) / camera.zoom,
        },
      }, this.options.world));
      return;
    }

    const distance = this.pointerDistance();
    if (distance === 0 || this.pinchDistance === null) {
      this.pinchDistance = distance;
      return;
    }

    const camera = this.options.getCamera();
    this.options.onCameraChange(clampCamera({ ...camera, zoom: camera.zoom * distance / this.pinchDistance }, this.options.world));
    this.pinchDistance = distance;
  };

  private readonly onPointerEnd = (event: PointerEvent): void => {
    const gameplay = this.gameplayPointers.get(event.pointerId);
    if (gameplay !== undefined) {
      this.gameplayPointers.delete(event.pointerId);
      if (gameplay.control === 'move-left' || gameplay.control === 'move-right') {
        this.options.onCommand({ type: 'move', direction: 0 });
      } else if (gameplay.control === 'fire') {
        this.options.onCommand({
          type: 'fire',
          power: clampPower((this.nowMilliseconds() - gameplay.startedAt) / FIRE_CHARGE_MILLISECONDS),
        });
      }
      return;
    }
    this.freePointers.delete(event.pointerId);
    this.pinchDistance = this.freePointers.size === 2 ? this.pointerDistance() : null;
  };

  private readonly onPointerCancel = (event: PointerEvent): void => {
    const gameplay = this.gameplayPointers.get(event.pointerId);
    this.gameplayPointers.delete(event.pointerId);
    if (gameplay?.control === 'move-left' || gameplay?.control === 'move-right') {
      this.options.onCommand({ type: 'move', direction: 0 });
    }
    this.freePointers.delete(event.pointerId);
    this.pinchDistance = this.freePointers.size === 2 ? this.pointerDistance() : null;
  };

  private viewport(): ControlViewport {
    const bounds = this.options.element.getBoundingClientRect();
    return { width: bounds.width, height: bounds.height, safeArea: this.options.getSafeArea?.() };
  }

  private portrait(viewport: ControlViewport): boolean {
    return this.options.isPortrait?.() ?? viewport.width <= viewport.height;
  }

  private pointFor(event: PointerEvent): Vec2 {
    const bounds = this.options.element.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  private pointerDistance(): number {
    const points = [...this.freePointers.values()];
    return Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
  }

  private nowMilliseconds(): number {
    return this.options.nowMilliseconds?.() ?? performance.now();
  }
}

interface GameplayPointer {
  readonly control: ControlId;
  readonly startedAt: number;
}

function safeAreaFor(viewport: ControlViewport): SafeAreaInsets {
  return {
    top: viewport.safeArea?.top ?? EMPTY_SAFE_AREA.top,
    right: viewport.safeArea?.right ?? EMPTY_SAFE_AREA.right,
    bottom: viewport.safeArea?.bottom ?? EMPTY_SAFE_AREA.bottom,
    left: viewport.safeArea?.left ?? EMPTY_SAFE_AREA.left,
  };
}

function contains(rect: ControlRect, point: Vec2): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width
    && point.y >= rect.y && point.y <= rect.y + rect.height;
}

function controlAt(point: Vec2, viewport: ControlViewport): ControlButton | undefined {
  return controlLayout(viewport)?.buttons.find(candidate => contains(candidate.rect, point));
}

function aimAngle(point: Vec2, rect: ControlRect): number {
  return Math.atan2(
    point.y - (rect.y + rect.height / 2),
    point.x - (rect.x + rect.width / 2),
  );
}

function clampPower(power: number): number {
  return Math.min(Math.max(power, 0), 1);
}
