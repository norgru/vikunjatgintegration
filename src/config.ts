import { z } from 'zod';

const normalizedHttpUrl = z
  .string()
  .trim()
  .min(1)
  .transform((value, context) => {
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol))
        context.addIssue({ code: 'custom', message: 'must use HTTP or HTTPS' });
      if (url.username || url.password) context.addIssue({ code: 'custom', message: 'must not contain credentials' });
      if (url.search) context.addIssue({ code: 'custom', message: 'must not contain a query string' });
      if (url.hash) context.addIssue({ code: 'custom', message: 'must not contain a fragment' });
      url.pathname = url.pathname.replace(/\/+$/, '');
      return url.toString().replace(/\/$/, '');
    } catch {
      context.addIssue({ code: 'custom', message: 'must be a valid URL' });
      return z.NEVER;
    }
  });

const requiredInteger = (message: string) =>
  z
    .string()
    .trim()
    .min(1, message)
    .transform((value, context) => {
      const number = Number(value);
      if (!Number.isSafeInteger(number)) {
        context.addIssue({ code: 'custom', message: 'must be a safe integer' });
        return z.NEVER;
      }
      return number;
    });

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    HOST: z.string().default('0.0.0.0'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    TELEGRAM_BOT_TOKEN: z.string().trim().min(1),
    TELEGRAM_CHAT_ID: requiredInteger('is required').pipe(z.number().negative('must be a negative group chat ID')),
    TELEGRAM_MESSAGE_THREAD_ID: z
      .union([z.literal(''), requiredInteger('must not be blank').pipe(z.number().positive())])
      .optional()
      .transform((value) => (value === '' ? undefined : value)),
    VIKUNJA_API_URL: normalizedHttpUrl,
    VIKUNJA_FRONTEND_URL: normalizedHttpUrl,
    VIKUNJA_API_TOKEN: z.string().trim().min(1),
    VIKUNJA_PROJECT_ID: requiredInteger('is required').pipe(z.number().positive()),
    VIKUNJA_WEBHOOK_SECRET: z.string().min(16),
  })
  .transform((value) => ({
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
  }));

export type Config = z.output<typeof environmentSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): Config {
  const parsed = environmentSchema.safeParse(environment);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  return parsed.data;
}
