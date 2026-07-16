import { describe, expect, it } from 'vitest';
import { vikunjaWebhookSchema, type TelegramReply } from '../src/domain.js';
import { formatVikunjaComment, telegramCommentMarker } from '../src/format.js';
import { StatelessIntegration } from '../src/integration.js';
import { FakeTelegram, FakeVikunja, logger, webhookPayload } from './helpers.js';
import { VikunjaError } from '../src/vikunja.js';

function setup() {
  const telegram = new FakeTelegram();
  const vikunja = new FakeVikunja();
  const integration = new StatelessIntegration(telegram, vikunja, 'https://vikunja.example', 42, logger, [0, 0]);
  return { telegram, vikunja, integration };
}

function reply(overrides: Partial<TelegramReply> = {}): TelegramReply {
  return {
    updateId: 88,
    taskId: 123,
    chatId: -1001234567890,
    messageId: 889,
    text: 'This has been inspected.',
    authorName: 'Norman',
    authorUsername: 'norman',
    ...overrides,
  };
}

describe('stateless integration', () => {
  it('delivers a ticket notification directly without persistence', async () => {
    const { telegram, integration } = setup();
    await integration.sendTicketNotification(vikunjaWebhookSchema.parse(webhookPayload()));
    expect(telegram.tickets).toHaveLength(1);
    expect(telegram.tickets[0]).toMatchObject({ taskId: 123, ticketUrl: 'https://vikunja.example/tasks/123' });
  });

  it('surfaces a Telegram delivery failure to the webhook route', async () => {
    const { telegram, integration } = setup();
    telegram.failTicket = true;
    await expect(integration.sendTicketNotification(vikunjaWebhookSchema.parse(webhookPayload()))).rejects.toThrow(
      'Telegram unavailable',
    );
  });

  it('creates one attributed comment for a Telegram reply', async () => {
    const { telegram, vikunja, integration } = setup();
    const telegramReply = reply();
    await integration.handleTelegramReply(telegramReply);

    expect(vikunja.created).toHaveLength(1);
    expect(vikunja.created[0]).toMatchObject({ taskId: 123 });
    expect(vikunja.created[0]?.comment).toContain(telegramCommentMarker(telegramReply));
    expect(telegram.acknowledgements).toEqual([{ chatId: telegramReply.chatId, messageId: telegramReply.messageId }]);
  });

  it('recognizes an already-created comment using its Telegram marker', async () => {
    const { vikunja, integration } = setup();
    const telegramReply = reply({ messageId: 991 });
    vikunja.comments = [{ id: 1, comment: formatVikunjaComment(telegramReply) }];

    await integration.handleTelegramReply(telegramReply);
    expect(vikunja.created).toHaveLength(0);
  });

  it('does not treat a longer marker prefix as the same comment', async () => {
    const { vikunja, integration } = setup();
    const telegramReply = reply({ messageId: 12 });
    vikunja.comments = [
      { id: 1, comment: 'Other comment\nTelegram reference: [[vikunja-telegram|-1001234567890|123]]' },
    ];
    await integration.handleTelegramReply(telegramReply);
    expect(vikunja.created).toHaveLength(1);
  });

  it('avoids duplication when creation succeeds but its response is lost', async () => {
    const { vikunja, integration } = setup();
    vikunja.ambiguousCreateOnce = true;
    await integration.handleTelegramReply(reply());
    expect(vikunja.created).toHaveLength(1);
    expect(vikunja.createAttempts).toBe(1);
  });

  it('rejects tasks outside the configured project without retrying', async () => {
    const { telegram, vikunja, integration } = setup();
    vikunja.projectId = 99;
    await integration.handleTelegramReply(reply());
    expect(vikunja.createAttempts).toBe(0);
    expect(telegram.failures).toHaveLength(1);
  });

  it('reports a comment failure after three in-memory attempts', async () => {
    const { telegram, vikunja, integration } = setup();
    const telegramReply = reply({ messageId: 992 });
    vikunja.failCreate = true;

    await integration.handleTelegramReply(telegramReply);
    expect(vikunja.createAttempts).toBe(3);
    expect(telegram.failures).toEqual([{ chatId: telegramReply.chatId, messageId: telegramReply.messageId }]);
  });

  it('does not retry permanent Vikunja failures', async () => {
    const { telegram, vikunja, integration } = setup();
    vikunja.createError = new VikunjaError('Forbidden', 403, false);
    await integration.handleTelegramReply(reply());
    expect(vikunja.createAttempts).toBe(1);
    expect(telegram.failures).toHaveLength(1);
  });

  it('tolerates acknowledgement failures after creating a comment', async () => {
    const { telegram, vikunja, integration } = setup();
    telegram.failAcknowledgement = true;
    await expect(integration.handleTelegramReply(reply())).resolves.toBeUndefined();
    expect(vikunja.created).toHaveLength(1);
    expect(telegram.failures).toHaveLength(0);
  });

  it('routes failures to the reply topic and tolerates Telegram reporting errors', async () => {
    const { telegram, vikunja, integration } = setup();
    vikunja.failCreate = true;
    const threadedReply = reply({ messageThreadId: 77 });
    await integration.handleTelegramReply(threadedReply);
    expect(telegram.failures).toEqual([
      { chatId: threadedReply.chatId, messageId: threadedReply.messageId, messageThreadId: 77 },
    ]);

    telegram.failFailureReport = true;
    await expect(integration.handleTelegramReply(reply({ messageId: 999 }))).resolves.toBeUndefined();
  });
});
