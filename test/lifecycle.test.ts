import { describe, expect, it, vi } from 'vitest';
import { stopAndDrain, superviseTelegram, type PollingBot } from '../src/lifecycle.js';
import { logger } from './helpers.js';

describe('Telegram lifecycle', () => {
  it('marks readiness only from the polling start callback', async () => {
    let stopping = false;
    const readiness = { telegram: false, vikunja: true };
    const bot: PollingBot = {
      start: async (onStarted) => {
        expect(readiness.telegram).toBe(false);
        onStarted();
        expect(readiness.telegram).toBe(true);
        stopping = true;
      },
      stop: async () => undefined,
    };
    await superviseTelegram(bot, readiness, logger, () => stopping, 0);
    expect(readiness.telegram).toBe(false);
  });

  it('waits for the polling promise before closing HTTP', async () => {
    let finishPolling!: () => void;
    const supervisor = new Promise<void>((resolve) => {
      finishPolling = resolve;
    });
    const closeHttp = vi.fn(async () => undefined);
    const bot: PollingBot = { start: async () => undefined, stop: async () => undefined };

    const shutdown = stopAndDrain(bot, supervisor, closeHttp);
    await Promise.resolve();
    expect(closeHttp).not.toHaveBeenCalled();
    finishPolling();
    await shutdown;
    expect(closeHttp).toHaveBeenCalledOnce();
  });

  it('closes HTTP even when polling shutdown rejects', async () => {
    const closeHttp = vi.fn(async () => undefined);
    const bot: PollingBot = {
      start: async () => undefined,
      stop: async () => Promise.reject(new Error('stop failed')),
    };
    await expect(stopAndDrain(bot, Promise.resolve(), closeHttp)).rejects.toThrow('stop failed');
    expect(closeHttp).toHaveBeenCalledOnce();
  });
});
