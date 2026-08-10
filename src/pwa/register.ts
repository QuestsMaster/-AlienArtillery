export interface PwaUpdateGate {
  canActivatePwaUpdate(): boolean;
}

const OFFLINE_READY = 'Готово к офлайн-игре';
const UPDATE_AFTER_MATCH = 'Обновление будет применено после матча.';

/** Registers the offline shell without interrupting an active match. */
export function registerPwa(game: PwaUpdateGate, baseUrl = import.meta.env.BASE_URL): void {
  if (!('serviceWorker' in navigator)) return;

  const workerUrl = baseUrl + 'sw.js';
  void navigator.serviceWorker.register(workerUrl).then(async registration => {
    let updatePoll: number | undefined;
    const activateWhenSafe = (): void => {
      const waiting = registration.waiting;
      if (waiting === null) return;
      if (game.canActivatePwaUpdate()) {
        waiting.postMessage({ type: 'ACTIVATE_UPDATE' });
        if (updatePoll !== undefined) window.clearInterval(updatePoll);
      } else {
        setOfflineStatus(UPDATE_AFTER_MATCH);
        if (updatePoll === undefined) updatePoll = window.setInterval(activateWhenSafe, 1000);
      }
    };

    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      if (installing === null) return;
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed') activateWhenSafe();
      });
    });
    await navigator.serviceWorker.ready;
    setOfflineStatus(OFFLINE_READY);
    activateWhenSafe();
  }).catch(() => {
    setOfflineStatus('Офлайн-кэш недоступен');
  });
}

function setOfflineStatus(message: string): void {
  const status = document.querySelector<HTMLElement>('#offline-status');
  if (status !== null) status.textContent = message;
}
