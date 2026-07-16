import { loadConfig } from './config.js';
import { StatelessIntegration } from './integration.js';
import { buildServer, type ReadinessState } from './server.js';
import { TelegramBot } from './telegram.js';
import { VikunjaClient } from './vikunja.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const readiness: ReadinessState = { telegram: false, vikunja: false };
  let integration: StatelessIntegration;
  const server = buildServer(config, (payload) => integration.sendTicketNotification(payload), readiness);
  const telegram = new TelegramBot(
    config.telegramBotToken,
    config.telegramChatId,
    config.telegramMessageThreadId,
    config.vikunjaFrontendUrl,
    server.log,
  );
  const vikunja = new VikunjaClient(config.vikunjaApiUrl, config.vikunjaApiToken);
  integration = new StatelessIntegration(telegram, vikunja, config.vikunjaFrontendUrl, server.log);

  telegram.onReply((reply) => integration.handleTelegramReply(reply));

  await server.listen({ port: config.port, host: config.host });
  let stopping = false;

  const runTelegram = async (): Promise<void> => {
    while (!stopping) {
      try {
        await telegram.initialize();
        if (stopping) return;
        readiness.telegram = true;
        await telegram.start();
        readiness.telegram = false;
      } catch (error) {
        readiness.telegram = false;
        if (!stopping) server.log.error({ error }, 'Telegram polling stopped; retrying in 5 seconds');
      }
      if (!stopping) await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  };
  void runTelegram().catch((error) => {
    if (!stopping) {
      readiness.telegram = false;
      server.log.error({ error }, 'Telegram supervisor failed');
    }
  });

  const checkVikunja = async (): Promise<void> => {
    try {
      await vikunja.checkProject(config.vikunjaProjectId);
      readiness.vikunja = true;
    } catch (error) {
      readiness.vikunja = false;
      server.log.warn({ error }, 'Vikunja readiness check failed');
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
    await telegram.stop();
    await server.close();
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
