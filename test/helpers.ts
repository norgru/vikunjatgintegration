import { createHmac } from 'node:crypto';
import pino from 'pino';
import type { Config } from '../src/config.js';
import type { TelegramGateway } from '../src/telegram.js';
import type { TaskComment, TicketNotification } from '../src/domain.js';
import { VikunjaError, type VikunjaGateway } from '../src/vikunja.js';

export const logger = pino({ level: 'silent' });

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    nodeEnv: 'test',
    port: 3000,
    host: '127.0.0.1',
    logLevel: 'silent',
    telegramBotToken: 'test-token',
    telegramChatId: -1001234567890,
    vikunjaApiUrl: 'https://vikunja.example/api/v1',
    vikunjaFrontendUrl: 'https://vikunja.example',
    vikunjaApiToken: 'test-api-token',
    vikunjaProjectId: 42,
    vikunjaWebhookSecret: 'a-test-secret-longer-than-16-characters',
    ...overrides,
  };
}

export function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

export function webhookPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_name: 'task.created',
    time: new Date().toISOString(),
    data: {
      task: {
        id: 123,
        project_id: 42,
        identifier: 'OPS-17',
        title: 'Repair <irrigation> & notify',
        due_date: '2026-07-15T09:30:00Z',
        assignees: [{ name: 'Ada Lovelace', username: 'ada' }],
      },
      doer: { name: 'Grace Hopper', username: 'grace' },
    },
    ...overrides,
  };
}

export class FakeTelegram implements TelegramGateway {
  readonly tickets: TicketNotification[] = [];
  readonly acknowledgements: Array<{ chatId: number; messageId: number }> = [];
  readonly failures: Array<{ chatId: number; messageId: number; messageThreadId?: number }> = [];
  failTicket = false;
  failAcknowledgement = false;
  failFailureReport = false;

  async sendTicketNotification(ticket: TicketNotification): Promise<void> {
    if (this.failTicket) throw new Error('Telegram unavailable');
    this.tickets.push(ticket);
  }

  async acknowledgeComment(chatId: number, messageId: number): Promise<void> {
    if (this.failAcknowledgement) throw new Error('Reaction unavailable');
    this.acknowledgements.push({ chatId, messageId });
  }

  async reportCommentFailure(chatId: number, messageId: number, messageThreadId?: number): Promise<void> {
    if (this.failFailureReport) throw new Error('Failure report unavailable');
    this.failures.push({
      chatId,
      messageId,
      ...(messageThreadId === undefined ? {} : { messageThreadId }),
    });
  }
}

export class FakeVikunja implements VikunjaGateway {
  comments: TaskComment[] = [];
  created: Array<{ taskId: number; comment: string }> = [];
  createAttempts = 0;
  failCreate = false;
  createError: Error | undefined;
  ambiguousCreateOnce = false;
  projectId = 42;

  async checkProject(): Promise<void> {}

  async getTaskProjectId(): Promise<number> {
    return this.projectId;
  }

  async listComments(): Promise<TaskComment[]> {
    return this.comments;
  }

  async createComment(taskId: number, comment: string): Promise<void> {
    this.createAttempts += 1;
    if (this.createError) throw this.createError;
    if (this.failCreate) throw new VikunjaError('Vikunja unavailable', 503, true);
    this.created.push({ taskId, comment });
    if (this.ambiguousCreateOnce) {
      this.ambiguousCreateOnce = false;
      this.comments.push({ id: 999, comment });
      throw new VikunjaError('Response lost', undefined, true);
    }
  }
}
