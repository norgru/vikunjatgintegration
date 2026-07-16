import Fastify, { type FastifyInstance } from 'fastify';
import type { LoggerOptions } from 'pino';
import type { Config } from './config.js';
import { vikunjaWebhookSchema, type VikunjaWebhook } from './domain.js';
import { verifyVikunjaSignature } from './security.js';

export type ReadinessState = {
  telegram: boolean;
  vikunja: boolean;
};

export type WebhookHandler = (payload: VikunjaWebhook) => Promise<void>;

export function buildServer(
  config: Config,
  handleWebhook: WebhookHandler,
  readiness: ReadinessState = { telegram: false, vikunja: false },
): FastifyInstance {
  const logger: LoggerOptions | boolean =
    config.logLevel === 'silent' ? false : { level: config.logLevel, redact: ['req.headers.authorization'] };
  const app = Fastify({ logger, bodyLimit: 1_048_576 });

  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));

  app.get('/healthz', async () => ({ status: 'ok' }));

  app.get('/readyz', async (_request, reply) => {
    const ready = readiness.telegram && readiness.vikunja;
    return reply.code(ready ? 200 : 503).send({ status: ready ? 'ready' : 'not-ready', ...readiness });
  });

  app.post('/webhooks/vikunja', async (request, reply) => {
    const rawBody = request.body;
    if (!Buffer.isBuffer(rawBody)) return reply.code(400).send({ error: 'Expected a JSON request body' });

    const signatureHeader = request.headers['x-vikunja-signature'];
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
    if (!verifyVikunjaSignature(rawBody, signature, config.vikunjaWebhookSecret)) {
      request.log.warn('Rejected Vikunja webhook with invalid signature');
      return reply.code(401).send({ error: 'Invalid webhook signature' });
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return reply.code(400).send({ error: 'Invalid JSON' });
    }
    const parsed = vikunjaWebhookSchema.safeParse(decoded);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid Vikunja webhook payload' });

    if (parsed.data.event_name !== 'task.created' || parsed.data.data.task.project_id !== config.vikunjaProjectId) {
      return reply.code(202).send({ accepted: false, reason: 'Event not configured' });
    }

    try {
      await handleWebhook(parsed.data);
      return reply.code(202).send({ accepted: true });
    } catch (error) {
      request.log.error({ error }, 'Telegram notification delivery failed');
      return reply.code(502).send({ error: 'Telegram notification delivery failed' });
    }
  });

  return app;
}
