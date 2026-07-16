import type { ReadinessState } from './server.js';
import type { AppLogger } from './logger.js';

export interface PollingBot {
  start(onStarted: () => void): Promise<void>;
  stop(): Promise<void>;
}

export async function superviseTelegram(
  bot: PollingBot,
  readiness: ReadinessState,
  logger: AppLogger,
  isStopping: () => boolean,
  retryDelayMs = 5_000,
): Promise<void> {
  while (!isStopping()) {
    try {
      await bot.start(() => {
        readiness.telegram = true;
      });
      readiness.telegram = false;
    } catch (error) {
      readiness.telegram = false;
      if (!isStopping()) logger.error({ err: error }, `Telegram polling stopped; retrying in ${retryDelayMs}ms`);
    }
    if (!isStopping()) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
}

export async function stopAndDrain(
  bot: PollingBot,
  supervisor: Promise<void>,
  closeHttp: () => Promise<void>,
): Promise<void> {
  let shutdownError: unknown;
  try {
    await bot.stop();
  } catch (error) {
    shutdownError = error;
  }
  try {
    await supervisor;
  } catch (error) {
    shutdownError ??= error;
  } finally {
    await closeHttp();
  }
  if (shutdownError) {
    if (shutdownError instanceof Error) throw shutdownError;
    throw new Error(typeof shutdownError === 'string' ? shutdownError : 'Unknown shutdown failure');
  }
}
