import { z } from 'zod';

const urlWithoutTrailingSlash = z.url().transform((value) => value.replace(/\/+$/, ''));

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_CHAT_ID: z.coerce.number().int().safe(),
  TELEGRAM_MESSAGE_THREAD_ID: z.coerce.number().int().positive().optional(),
  VIKUNJA_API_URL: urlWithoutTrailingSlash,
  VIKUNJA_FRONTEND_URL: urlWithoutTrailingSlash,
  VIKUNJA_API_TOKEN: z.string().min(1),
  VIKUNJA_PROJECT_ID: z.coerce.number().int().positive(),
  VIKUNJA_WEBHOOK_SECRET: z.string().min(16),
});

export type Config = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  host: string;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  telegramBotToken: string;
  telegramChatId: number;
  telegramMessageThreadId?: number;
  vikunjaApiUrl: string;
  vikunjaFrontendUrl: string;
  vikunjaApiToken: string;
  vikunjaProjectId: number;
  vikunjaWebhookSecret: string;
};

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): Config {
  const parsed = configSchema.safeParse(environment);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }

  const value = parsed.data;
  return {
    nodeEnv: value.NODE_ENV,
    port: value.PORT,
    host: value.HOST,
    logLevel: value.LOG_LEVEL,
    telegramBotToken: value.TELEGRAM_BOT_TOKEN,
    telegramChatId: value.TELEGRAM_CHAT_ID,
    ...(value.TELEGRAM_MESSAGE_THREAD_ID === undefined
      ? {}
      : { telegramMessageThreadId: value.TELEGRAM_MESSAGE_THREAD_ID }),
    vikunjaApiUrl: value.VIKUNJA_API_URL,
    vikunjaFrontendUrl: value.VIKUNJA_FRONTEND_URL,
    vikunjaApiToken: value.VIKUNJA_API_TOKEN,
    vikunjaProjectId: value.VIKUNJA_PROJECT_ID,
    vikunjaWebhookSecret: value.VIKUNJA_WEBHOOK_SECRET,
  };
}
