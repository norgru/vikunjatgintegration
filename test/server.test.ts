import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { VikunjaWebhook } from '../src/domain.js';
import { buildServer } from '../src/server.js';
import { sign, testConfig, webhookPayload } from './helpers.js';

describe('webhook server', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) await app.close();
  });

  function setup() {
    const config = testConfig();
    const handleWebhook = vi.fn(async (_payload: VikunjaWebhook) => undefined);
    app = buildServer(config, handleWebhook, { telegram: true, vikunja: true });
    return { config, handleWebhook, app };
  }

  it('delivers a valid task.created event directly', async () => {
    const { config, handleWebhook, app } = setup();
    const body = JSON.stringify(webhookPayload());
    const headers = {
      'content-type': 'application/json',
      'x-vikunja-signature': sign(body, config.vikunjaWebhookSecret),
    };

    const first = await app.inject({ method: 'POST', url: '/webhooks/vikunja', headers, payload: body });
    expect(first.statusCode).toBe(202);
    expect(first.json()).toEqual({ accepted: true });
    expect(handleWebhook).toHaveBeenCalledOnce();
    expect(handleWebhook.mock.calls[0]?.[0]).toMatchObject({ event_name: 'task.created', data: { task: { id: 123 } } });
  });

  it('rejects invalid signatures and malformed payloads', async () => {
    const { config, app } = setup();
    const body = JSON.stringify(webhookPayload());
    const unauthorized = await app.inject({
      method: 'POST',
      url: '/webhooks/vikunja',
      headers: { 'content-type': 'application/json', 'x-vikunja-signature': '0'.repeat(64) },
      payload: body,
    });
    const malformedBody = '{}';
    const malformed = await app.inject({
      method: 'POST',
      url: '/webhooks/vikunja',
      headers: {
        'content-type': 'application/json',
        'x-vikunja-signature': sign(malformedBody, config.vikunjaWebhookSecret),
      },
      payload: malformedBody,
    });
    expect(unauthorized.statusCode).toBe(401);
    expect(malformed.statusCode).toBe(400);

    const invalidJson = '{';
    const invalidJsonResponse = await app.inject({
      method: 'POST',
      url: '/webhooks/vikunja',
      headers: {
        'content-type': 'application/json',
        'x-vikunja-signature': sign(invalidJson, config.vikunjaWebhookSecret),
      },
      payload: invalidJson,
    });
    expect(invalidJsonResponse.statusCode).toBe(400);
  });

  it('rejects stale and replayed signed webhooks', async () => {
    const { config, app } = setup();
    const body = JSON.stringify(webhookPayload());
    const headers = {
      'content-type': 'application/json',
      'x-vikunja-signature': sign(body, config.vikunjaWebhookSecret),
    };
    expect((await app.inject({ method: 'POST', url: '/webhooks/vikunja', headers, payload: body })).statusCode).toBe(
      202,
    );
    expect((await app.inject({ method: 'POST', url: '/webhooks/vikunja', headers, payload: body })).statusCode).toBe(
      409,
    );

    const staleBody = JSON.stringify(webhookPayload({ time: '2020-01-01T00:00:00Z' }));
    const stale = await app.inject({
      method: 'POST',
      url: '/webhooks/vikunja',
      headers: {
        'content-type': 'application/json',
        'x-vikunja-signature': sign(staleBody, config.vikunjaWebhookSecret),
      },
      payload: staleBody,
    });
    expect(stale.statusCode).toBe(400);
    expect(stale.json()).toEqual({ error: 'Stale webhook' });
  });

  it('rejects wrong projects and oversized bodies', async () => {
    const { config, handleWebhook, app } = setup();
    const wrongProjectPayload = webhookPayload();
    (wrongProjectPayload.data as { task: { project_id: number } }).task.project_id = 99;
    const wrongProjectBody = JSON.stringify(wrongProjectPayload);
    const wrongProject = await app.inject({
      method: 'POST',
      url: '/webhooks/vikunja',
      headers: {
        'content-type': 'application/json',
        'x-vikunja-signature': sign(wrongProjectBody, config.vikunjaWebhookSecret),
      },
      payload: wrongProjectBody,
    });
    expect(wrongProject.statusCode).toBe(202);
    expect(handleWebhook).not.toHaveBeenCalled();

    const oversized = JSON.stringify({ padding: 'x'.repeat(1_048_576) });
    const oversizedResponse = await app.inject({
      method: 'POST',
      url: '/webhooks/vikunja',
      headers: {
        'content-type': 'application/json',
        'x-vikunja-signature': sign(oversized, config.vikunjaWebhookSecret),
      },
      payload: oversized,
    });
    expect(oversizedResponse.statusCode).toBe(413);
  });

  it('acknowledges but ignores other projects and events', async () => {
    const { config, handleWebhook, app } = setup();
    const body = JSON.stringify(webhookPayload({ event_name: 'task.updated' }));
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/vikunja',
      headers: { 'content-type': 'application/json', 'x-vikunja-signature': sign(body, config.vikunjaWebhookSecret) },
      payload: body,
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ accepted: false, reason: 'Event not configured' });
    expect(handleWebhook).not.toHaveBeenCalled();
  });

  it('reports direct Telegram delivery failures', async () => {
    const config = testConfig();
    app = buildServer(config, async () => {
      throw new Error('Telegram unavailable');
    });
    const body = JSON.stringify(webhookPayload());
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/vikunja',
      headers: { 'content-type': 'application/json', 'x-vikunja-signature': sign(body, config.vikunjaWebhookSecret) },
      payload: body,
    });
    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: 'Telegram notification delivery failed' });
    const retry = await app.inject({
      method: 'POST',
      url: '/webhooks/vikunja',
      headers: {
        'content-type': 'application/json',
        'x-vikunja-signature': sign(body, config.vikunjaWebhookSecret),
      },
      payload: body,
    });
    expect(retry.statusCode).toBe(502);
  });

  it('reports liveness and readiness separately', async () => {
    const config = testConfig();
    const readiness = { telegram: false, vikunja: true };
    app = buildServer(config, async () => undefined, readiness);
    expect((await app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/readyz' })).statusCode).toBe(503);
    readiness.telegram = true;
    expect((await app.inject({ method: 'GET', url: '/readyz' })).statusCode).toBe(200);
  });
});
