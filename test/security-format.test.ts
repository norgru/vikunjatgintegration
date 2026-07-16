import { describe, expect, it } from 'vitest';
import {
  formatTicketNotification,
  formatVikunjaComment,
  taskIdFromTicketUrl,
  telegramCommentMarker,
  ticketNotificationFromWebhook,
} from '../src/format.js';
import { verifyVikunjaSignature } from '../src/security.js';
import { taskIdFromReplyMarkup } from '../src/telegram.js';
import { vikunjaWebhookSchema } from '../src/domain.js';
import { sign, webhookPayload } from './helpers.js';

describe('Vikunja webhook security', () => {
  it('accepts a valid hex signature with or without the sha256 prefix', () => {
    const body = Buffer.from('{"event":"task.created"}');
    const secret = 'correct horse battery staple';
    const signature = sign(body.toString(), secret);
    expect(verifyVikunjaSignature(body, signature, secret)).toBe(true);
    expect(verifyVikunjaSignature(body, `sha256=${signature}`, secret)).toBe(true);
  });

  it('rejects missing, malformed, and incorrect signatures', () => {
    const body = Buffer.from('{}');
    expect(verifyVikunjaSignature(body, undefined, 'secret')).toBe(false);
    expect(verifyVikunjaSignature(body, 'not-hex', 'secret')).toBe(false);
    expect(verifyVikunjaSignature(body, '0'.repeat(64), 'secret')).toBe(false);
  });

});

describe('message formatting', () => {
  it('creates a linked, escaped ticket notification', () => {
    const payload = vikunjaWebhookSchema.parse(webhookPayload());
    const ticket = ticketNotificationFromWebhook(payload, 'https://vikunja.example');
    expect(ticket.ticketUrl).toBe('https://vikunja.example/tasks/123');
    expect(formatTicketNotification(ticket)).toContain('Repair &lt;irrigation&gt; &amp; notify');
    expect(formatTicketNotification(ticket)).toContain('OPS-17');
    expect(formatTicketNotification(ticket)).toContain('Ada Lovelace');
  });

  it('adds human attribution and a deterministic marker to comments', () => {
    const reply = {
      updateId: 1,
      taskId: 123,
      chatId: -100123,
      messageId: 55,
      text: 'Please inspect the pump.',
      authorName: 'Norman Example',
      authorUsername: 'norman',
    };
    expect(formatVikunjaComment(reply)).toContain('Telegram: Norman Example (@norman)');
    expect(formatVikunjaComment(reply)).toContain(telegramCommentMarker(reply));
  });

  it('extracts task IDs only from the configured Vikunja frontend', () => {
    expect(taskIdFromTicketUrl('https://vikunja.example/tasks/123', 'https://vikunja.example')).toBe(123);
    expect(taskIdFromTicketUrl('https://vikunja.example/base/tasks/456', 'https://vikunja.example/base')).toBe(456);
    expect(taskIdFromTicketUrl('https://attacker.example/tasks/123', 'https://vikunja.example')).toBeUndefined();
    expect(taskIdFromTicketUrl('https://vikunja.example/tasks/not-a-number', 'https://vikunja.example')).toBeUndefined();
    expect(taskIdFromTicketUrl('https://vikunja.example/tasks/123/extra', 'https://vikunja.example')).toBeUndefined();
  });

  it('extracts a task ID from the replied-to notification button', () => {
    const replyMarkup = {
      inline_keyboard: [
        [{ text: 'Unrelated', callback_data: 'noop' }],
        [{ text: 'Open ticket', url: 'https://vikunja.example/tasks/789' }],
      ],
    };
    expect(taskIdFromReplyMarkup(replyMarkup, 'https://vikunja.example')).toBe(789);
    expect(
      taskIdFromReplyMarkup(
        { inline_keyboard: [[{ text: 'Fake ticket', url: 'https://attacker.example/tasks/789' }]] },
        'https://vikunja.example',
      ),
    ).toBeUndefined();
    expect(taskIdFromReplyMarkup({ inline_keyboard: 'invalid' }, 'https://vikunja.example')).toBeUndefined();
  });
});
