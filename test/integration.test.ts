import { describe, expect, it } from 'vitest';
import { vikunjaWebhookSchema, type TelegramReply } from '../src/domain.js';
import { telegramCommentMarker } from '../src/format.js';
import { StatelessIntegration } from '../src/integration.js';
import { FakeTelegram, FakeVikunja, logger, webhookPayload } from './helpers.js';

function setup() {
  const telegram = new FakeTelegram();
  const vikunja = new FakeVikunja();
  const integration = new StatelessIntegration(telegram, vikunja, 'https://vikunja.example', logger, [0, 0]);
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
    expect(telegram.acknowledgements).toEqual([
      { chatId: telegramReply.chatId, messageId: telegramReply.messageId },
    ]);
  });

  it('recognizes an already-created comment using its Telegram marker', async () => {
    const { vikunja, integration } = setup();
    const telegramReply = reply({ messageId: 991 });
    vikunja.comments = [{ id: 1, comment: `Existing comment — ref ${telegramCommentMarker(telegramReply)}` }];

    await integration.handleTelegramReply(telegramReply);
    expect(vikunja.created).toHaveLength(0);
  });

  it('reports a comment failure after three in-memory attempts', async () => {
    const { telegram, vikunja, integration } = setup();
    const telegramReply = reply({ messageId: 992 });
    vikunja.failCreate = true;

    await integration.handleTelegramReply(telegramReply);
    expect(vikunja.createAttempts).toBe(3);
    expect(telegram.failures).toEqual([{ chatId: telegramReply.chatId, messageId: telegramReply.messageId }]);
  });
});
