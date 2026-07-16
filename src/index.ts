import { loadConfig } from './config.js';
import { StatelessIntegration } from './integration.js';
import { stopAndDrain, superviseTelegram } from './lifecycle.js';
import { buildServer, type ReadinessState } from './server.js';
import { TelegramBot } from './telegram.js';
import { VikunjaClient } from './vikunja.js';

async function main(): Promise<void> {
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

  await server.listen({ port: config.port, host: config.host });
  let stopping = false;

  const telegramSupervisor = superviseTelegram(telegram, readiness, server.log, () => stopping);

  const checkVikunja = async (): Promise<void> => {
    try {
      await vikunja.checkProject(config.vikunjaProjectId);
      readiness.vikunja = true;
    } catch (error) {
      readiness.vikunja = false;
      server.log.warn({ err: error }, 'Vikunja readiness check failed');
    }
  };
  await checkVikunja();
  const vikunjaHealthTimer = setInterval(() => void checkVikunja(), 30_000);
  vikunjaHealthTimer.unref();

  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    server.log.info({ signal }, 'Shutting down');
    clearInterval(vikunjaHealthTimer);
    await stopAndDrain(telegram, telegramSupervisor, () => server.close());
  };

  const handleSignal = (signal: string): void => {
    void shutdown(signal).catch((error) => {
      server.log.error({ err: error }, 'Graceful shutdown failed');
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', () => handleSignal('SIGINT'));
  process.once('SIGTERM', () => handleSignal('SIGTERM'));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
