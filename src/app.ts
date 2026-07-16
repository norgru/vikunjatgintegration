import { loadConfig } from './config.js';
import { StatelessIntegration } from './integration.js';
import { stopAndDrain, superviseTelegram, type PollingBot } from './lifecycle.js';
import type { AppLogger } from './logger.js';
import { buildServer, type ReadinessState } from './server.js';
import { TelegramBot } from './telegram.js';
import { VikunjaClient } from './vikunja.js';

type ShutdownSignal = 'SIGINT' | 'SIGTERM';

interface StartupServer {
  listen(options: { port: number; host: string }): Promise<unknown>;
  close(): Promise<void>;
  log: AppLogger;
}

interface SignalTarget {
  once(signal: ShutdownSignal, listener: () => void): void;
  removeListener(signal: ShutdownSignal, listener: () => void): void;
}

interface RepeatingTimer {
  clear(): void;
  unref(): void;
}

export interface ApplicationRuntime {
  server: StartupServer;
  telegram: PollingBot;
  readiness: ReadinessState;
  port: number;
  host: string;
  checkVikunja(): Promise<void>;
}

export interface StartupDependencies {
  signals?: SignalTarget;
  scheduleInterval?: (callback: () => void, delayMs: number) => RepeatingTimer;
}

export interface ApplicationHandle {
  shutdown(signal: string): Promise<void>;
}

const processSignals: SignalTarget = {
  once: (signal, listener) => {
    process.once(signal, listener);
  },
  removeListener: (signal, listener) => {
    process.removeListener(signal, listener);
  },
};

function scheduleInterval(callback: () => void, delayMs: number): RepeatingTimer {
  const timer = setInterval(callback, delayMs);
  return {
    clear: () => clearInterval(timer),
    unref: () => timer.unref(),
  };
}

export async function startApplication(
  runtime: ApplicationRuntime,
  dependencies: StartupDependencies = {},
): Promise<ApplicationHandle> {
  const signals = dependencies.signals ?? processSignals;
  const createTimer = dependencies.scheduleInterval ?? scheduleInterval;

  await runtime.server.listen({ port: runtime.port, host: runtime.host });
  let stopping = false;
  let vikunjaHealthTimer: RepeatingTimer | undefined;

  const telegramSupervisor = superviseTelegram(runtime.telegram, runtime.readiness, runtime.server.log, () => stopping);

  const removeSignalHandlers = (): void => {
    signals.removeListener('SIGINT', onSigint);
    signals.removeListener('SIGTERM', onSigterm);
  };

  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    removeSignalHandlers();
    runtime.server.log.info({ signal }, 'Shutting down');
    vikunjaHealthTimer?.clear();
    await stopAndDrain(runtime.telegram, telegramSupervisor, () => runtime.server.close());
  };

  const handleSignal = (signal: ShutdownSignal): void => {
    void shutdown(signal).catch((error: unknown) => {
      runtime.server.log.error({ err: error }, 'Graceful shutdown failed');
      process.exitCode = 1;
    });
  };
  const onSigint = (): void => handleSignal('SIGINT');
  const onSigterm = (): void => handleSignal('SIGTERM');

  signals.once('SIGINT', onSigint);
  signals.once('SIGTERM', onSigterm);

  await runtime.checkVikunja();
  if (!stopping) {
    vikunjaHealthTimer = createTimer(() => void runtime.checkVikunja(), 30_000);
    vikunjaHealthTimer.unref();
  }

  return { shutdown };
}

export async function main(): Promise<void> {
  const config = loadConfig();
  const readiness: ReadinessState = { telegram: false, vikunja: false };
  const runtime: { integration?: StatelessIntegration } = {};
  const server = buildServer(
    config,
    (payload) => {
      if (!runtime.integration) throw new Error('Integration is not initialized');
      return runtime.integration.sendTicketNotification(payload);
    },
    readiness,
  );
  const telegram = new TelegramBot(
    config.telegramBotToken,
    config.telegramChatId,
    config.telegramMessageThreadId,
    config.vikunjaFrontendUrl,
    server.log,
  );
  const vikunja = new VikunjaClient(config.vikunjaApiUrl, config.vikunjaApiToken);
  runtime.integration = new StatelessIntegration(
    telegram,
    vikunja,
    config.vikunjaFrontendUrl,
    config.vikunjaProjectId,
    server.log,
  );

  telegram.onReply((reply) => {
    if (!runtime.integration) throw new Error('Integration is not initialized');
    return runtime.integration.handleTelegramReply(reply);
  });

  const checkVikunja = async (): Promise<void> => {
    try {
      await vikunja.checkProject(config.vikunjaProjectId);
      readiness.vikunja = true;
    } catch (error) {
      readiness.vikunja = false;
      server.log.warn({ err: error }, 'Vikunja readiness check failed');
    }
  };

  await startApplication({
    server,
    telegram,
    readiness,
    port: config.port,
    host: config.host,
    checkVikunja,
  });
}
