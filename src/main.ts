import './styles.css';
import { GameController } from './game/game';
import { MatchRepository } from './game/storage';
import { TouchControls } from './ui/controls';
import { CanvasRenderer, recoveryHudTop } from './ui/renderer';
import { terminalActionFor } from './ui/terminal-actions';
import { installViewportTracking, viewportFor } from './ui/viewport';
import { registerPwa } from './pwa/register';

const canvas = document.querySelector<HTMLCanvasElement>('#game');
const hud = document.querySelector<HTMLElement>('#hud');

if (canvas === null || hud === null) {
  throw new Error('Missing game canvas or HUD');
}
const hudElement = hud;
const gameCanvas = canvas;
const EMPTY_SAFE_AREA = { top: 0, right: 0, bottom: 0, left: 0 };

function positionHudBelowRoster(viewport = viewportFor(gameCanvas)): void {
  const canvasBounds = gameCanvas.getBoundingClientRect();
  hudElement.style.top = `${Math.ceil(canvasBounds.top + recoveryHudTop(viewport, EMPTY_SAFE_AREA))}px`;
}

positionHudBelowRoster();

const controller = GameController.create({
  repository: new MatchRepository(),
  clock: { nowMilliseconds: () => performance.now() },
  isVisible: () => document.visibilityState === 'visible',
  renderer: new CanvasRenderer(canvas),
  viewport: viewportFor(canvas),
  yieldToBrowser: () => new Promise(resolve => window.setTimeout(resolve, 0)),
  onPersistenceError: operation => showStorageWarning(`Local ${operation} failed. The match remains playable.`),
});

const controls = new TouchControls({
  element: canvas,
  world: { width: 1600, height: 900 },
  getCamera: () => controller.state?.camera ?? { center: { x: 800, y: 450 }, zoom: 1, viewport: viewportFor(canvas) },
  onCameraChange: camera => {
    const current = controller.state?.camera;
    if (current === undefined) return;
    controller.dispatch({
      type: 'camera-pan',
      delta: { x: camera.center.x - current.center.x, y: camera.center.y - current.center.y },
    });
    controller.dispatch({ type: 'camera-zoom', factor: camera.zoom / current.zoom });
  },
  onCommand: command => controller.dispatch(command),
});

installViewportTracking({
  element: canvas,
  host: window,
  visualViewport: window.visualViewport ?? undefined,
  onViewport: viewport => {
    positionHudBelowRoster(viewport);
    controller.setViewport(viewport);
    if (viewport.x <= viewport.y) controls.cancelGameplayPointers();
  },
});

let lastFrame = performance.now();
function frame(now: number): void {
  const elapsedSeconds = Math.max(0, (now - lastFrame) / 1000);
  lastFrame = now;
  void controller.tick(elapsedSeconds).then(() => {
    controller.render();
    syncTerminalAction();
  });
  requestAnimationFrame(frame);
}

void restoreMatch().finally(() => registerPwa(controller));
requestAnimationFrame(frame);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    controls.cancelGameplayPointers();
    void controller.pause();
  }
  lastFrame = performance.now();
});
window.addEventListener('pagehide', () => { void controller.pause(); });

async function restoreMatch(): Promise<void> {
  const result = await controller.resume();
  if (result.status === 'loaded') return;
  if (result.status === 'empty') {
    controller.startNewMatch(Date.now());
    return;
  }
  if (result.status === 'error') {
    controller.startNewMatch(Date.now());
    showStorageWarning('Local storage is unavailable. A new playable match was started.');
    return;
  }
  showRecovery();
}

function showRecovery(): void {
  hudElement.className = 'recovery-panel';
  hudElement.replaceChildren(document.createTextNode('Saved match could not be recovered. '));
  hudElement.append(
    recoveryButton('New match', () => {
      controller.startNewMatch(Date.now());
      hudElement.className = '';
      hudElement.replaceChildren();
    }),
    recoveryButton('Clear damaged save', () => {
      void controller.clearDamagedSave().then(() => {
        controller.startNewMatch(Date.now());
        if (hudElement.className === 'recovery-panel') {
          hudElement.className = '';
          hudElement.replaceChildren();
        }
      });
    }),
  );
}

function showStorageWarning(message: string): void {
  hudElement.className = 'storage-warning';
  const dismiss = recoveryButton('Dismiss', () => {
    hudElement.className = '';
    hudElement.replaceChildren();
  });
  hudElement.replaceChildren(document.createTextNode(message), dismiss);
}

function syncTerminalAction(): void {
  const action = terminalActionFor(controller.state?.phase ?? 'ready');
  if (action === null) {
    if (hudElement.className === 'terminal-actions') {
      hudElement.className = '';
      hudElement.replaceChildren();
    }
    return;
  }
  if (hudElement.className === 'terminal-actions') return;

  hudElement.className = 'terminal-actions';
  hudElement.replaceChildren(recoveryButton(action.label, () => {
    controller.startNewMatch(Date.now());
    void controller.clearDamagedSave();
    hudElement.className = '';
    hudElement.replaceChildren();
  }));
}

function recoveryButton(label: string, action: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', action);
  return button;
}
