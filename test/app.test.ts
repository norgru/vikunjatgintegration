import { describe, expect, it, vi } from 'vitest';
import { startApplication } from '../src/app.js';
import type { PollingBot } from '../src/lifecycle.js';
import { logger } from './helpers.js';

type ShutdownSignal = 'SIGINT' | 'SIGTERM';

class FakeSignals {
  private readonly listeners = new Map<ShutdownSignal, Set<() => void>>();

  once(signal: ShutdownSignal, listener: () => void): void {
    const listeners = this.listeners.get(signal) ?? new Set();
    listeners.add(listener);
    this.listeners.set(signal, listeners);
  }

  removeListener(signal: ShutdownSignal, listener: () => void): void {
    this.listeners.get(signal)?.delete(listener);
  }

  emit(signal: ShutdownSignal): void {
    const listeners = [...(this.listeners.get(signal) ?? [])];
    this.listeners.delete(signal);
    for (const listener of listeners) listener();
  }

  listenerCount(signal: ShutdownSignal): number {
    return this.listeners.get(signal)?.size ?? 0;
  }
}

describe('application startup', () => {
  it('drains an early signal and does not create a health timer after shutdown', async () => {
    let resolveVikunjaCheck!: () => void;
    const checkVikunja = vi.fn(
      async () =>
        new Promise<void>((resolve) => {
          resolveVikunjaCheck = resolve;
        }),
    );
    let finishPolling: (() => void) | undefined;
    const stopTelegram = vi.fn(async () => {
      finishPolling?.();
    });
    const telegram: PollingBot = {
      start: vi.fn(async (onStarted: () => void) => {
        onStarted();
        await new Promise<void>((resolve) => {
          finishPolling = resolve;
        });
      }),
      stop: stopTelegram,
    };
    const server = {
      listen: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      log: logger,
    };
    const signals = new FakeSignals();
    const scheduleInterval = vi.fn(() => ({ clear: vi.fn(), unref: vi.fn() }));

    const starting = startApplication(
      {
        server,
        telegram,
        readiness: { telegram: false, vikunja: false },
        port: 3000,
        host: '127.0.0.1',
        checkVikunja,
      },
      { signals, scheduleInterval },
    );

    await vi.waitFor(() => expect(checkVikunja).toHaveBeenCalledOnce());
    expect(signals.listenerCount('SIGINT')).toBe(1);
    expect(signals.listenerCount('SIGTERM')).toBe(1);

    signals.emit('SIGTERM');

    await vi.waitFor(() => expect(server.close).toHaveBeenCalledOnce());
    expect(stopTelegram).toHaveBeenCalledOnce();
    expect(signals.listenerCount('SIGINT')).toBe(0);
    expect(signals.listenerCount('SIGTERM')).toBe(0);

    resolveVikunjaCheck();
    await starting;
    expect(scheduleInterval).not.toHaveBeenCalled();
  });
});
