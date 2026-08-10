import { describe, expect, it, vi } from 'vitest';
import { registerPwa } from '../../src/pwa/register';

describe('PWA registration lifecycle', () => {
  it('registers under a deployed repository subpath', async () => {
    const status = { textContent: 'Preparing' };
    const registration = registrationWithNoWaitingWorker();
    const register = vi.fn().mockResolvedValue(registration);
    installBrowserFakes(status, register, Promise.resolve(registration));

    registerPwa({ canActivatePwaUpdate: () => true }, '/alien-artillery/');
    await flushMicrotasks();

    expect(register).toHaveBeenCalledWith('/alien-artillery/sw.js');
  });

  it('shows cache readiness only after the first worker becomes ready', async () => {
    const status = { textContent: 'Preparing' };
    const registration = registrationWithNoWaitingWorker();
    let resolveReady!: (value: ServiceWorkerRegistration) => void;
    const ready = new Promise<ServiceWorkerRegistration>(resolve => { resolveReady = resolve; });
    installBrowserFakes(status, vi.fn().mockResolvedValue(registration), ready);

    registerPwa({ canActivatePwaUpdate: () => true }, '/alien-artillery/');
    await flushMicrotasks();
    expect(status.textContent).toBe('Preparing');

    resolveReady(registration);
    await flushMicrotasks();
    expect(status.textContent).toBe('Готово к офлайн-игре');
  });

  it('withholds a waiting update through a recovered active match until it completes', async () => {
    vi.useFakeTimers();
    const status = { textContent: 'Preparing' };
    const waiting = { postMessage: vi.fn() } as unknown as ServiceWorker;
    const registration = registrationWithNoWaitingWorker();
    Object.defineProperty(registration, 'waiting', { value: waiting });
    let canActivate = false;
    installBrowserFakes(status, vi.fn().mockResolvedValue(registration), Promise.resolve(registration));

    registerPwa({ canActivatePwaUpdate: () => canActivate }, '/alien-artillery/');
    await flushMicrotasks();
    expect(waiting.postMessage).not.toHaveBeenCalled();
    expect(status.textContent).toBe('Обновление будет применено после матча.');

    canActivate = true;
    await vi.advanceTimersByTimeAsync(1000);
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'ACTIVATE_UPDATE' });
    vi.useRealTimers();
  });
});

function registrationWithNoWaitingWorker(): ServiceWorkerRegistration {
  return {
    waiting: null,
    installing: null,
    addEventListener: vi.fn(),
  } as unknown as ServiceWorkerRegistration;
}

function installBrowserFakes(
  status: { textContent: string },
  register: ReturnType<typeof vi.fn>,
  ready: Promise<ServiceWorkerRegistration>,
): void {
  vi.stubGlobal('document', { querySelector: vi.fn(() => status) });
  vi.stubGlobal('navigator', { serviceWorker: { register, ready } });
  vi.stubGlobal('window', { setInterval, clearInterval });
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
