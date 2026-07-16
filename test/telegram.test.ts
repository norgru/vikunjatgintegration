import { describe, expect, it } from 'vitest';
import type { Context } from 'grammy';
import { telegramReplyFromContext } from '../src/telegram.js';

function context(overrides: Record<string, unknown> = {}): Context {
  return {
    update: { update_id: 7 },
    me: { id: 999 },
    message: {
      message_id: 20,
      message_thread_id: 77,
      text: 'A reply',
      chat: { id: -1001 },
      from: { id: 10, is_bot: false, first_name: 'Ada', username: 'ada' },
      reply_to_message: {
        message_id: 19,
        from: { id: 999, is_bot: true, first_name: 'Integration' },
        reply_markup: { inline_keyboard: [[{ text: 'Open ticket', url: 'https://vikunja.example/tasks/123' }]] },
      },
      ...overrides,
    },
  } as unknown as Context;
}

describe('Telegram reply filtering', () => {
  it('extracts a valid reply', () => {
    expect(telegramReplyFromContext(context(), -1001, 77, 'https://vikunja.example')).toMatchObject({
      taskId: 123,
      messageThreadId: 77,
      authorUsername: 'ada',
    });
  });

  it('rejects wrong chats, topics, forwards, bot senders, and non-bot originals', () => {
    expect(telegramReplyFromContext(context(), -2002, 77, 'https://vikunja.example')).toBeUndefined();
    expect(telegramReplyFromContext(context(), -1001, 88, 'https://vikunja.example')).toBeUndefined();
    expect(
      telegramReplyFromContext(
        context({ forward_origin: { type: 'hidden_user', sender_user_name: 'x', date: 1 } }),
        -1001,
        77,
        'https://vikunja.example',
      ),
    ).toBeUndefined();
    expect(
      telegramReplyFromContext(
        context({ from: { id: 10, is_bot: true, first_name: 'Bot' } }),
        -1001,
        77,
        'https://vikunja.example',
      ),
    ).toBeUndefined();
    expect(
      telegramReplyFromContext(
        context({
          reply_to_message: {
            message_id: 19,
            from: { id: 111, is_bot: true, first_name: 'Other bot' },
            reply_markup: { inline_keyboard: [[{ text: 'Open', url: 'https://vikunja.example/tasks/123' }]] },
          },
        }),
        -1001,
        77,
        'https://vikunja.example',
      ),
    ).toBeUndefined();
  });
});
