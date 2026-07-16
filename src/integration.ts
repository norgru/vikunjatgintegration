import type { TelegramReply, VikunjaWebhook } from './domain.js';
import {
  formatVikunjaComment,
  hasTelegramCommentMarker,
  telegramCommentMarker,
  ticketNotificationFromWebhook,
} from './format.js';
import type { AppLogger } from './logger.js';
import type { TelegramGateway } from './telegram.js';
import { isRetryableVikunjaError, type VikunjaGateway } from './vikunja.js';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 1_000) : String(error).slice(0, 1_000);
}

export class StatelessIntegration {
  constructor(
    private readonly telegram: TelegramGateway,
    private readonly vikunja: VikunjaGateway,
    private readonly frontendUrl: string,
    private readonly projectId: number,
    private readonly logger: AppLogger,
    private readonly commentRetryDelaysMs: readonly number[] = [1_000, 2_000],
  ) {}

  async sendTicketNotification(payload: VikunjaWebhook): Promise<void> {
    const notification = ticketNotificationFromWebhook(payload, this.frontendUrl);
    await this.telegram.sendTicketNotification(notification);
    this.logger.info({ taskId: notification.taskId }, 'Ticket notification sent');
  }

  async handleTelegramReply(reply: TelegramReply): Promise<void> {
    const comment = formatVikunjaComment(reply);
    const marker = telegramCommentMarker(reply);
    const attempts = this.commentRetryDelaysMs.length + 1;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const taskProjectId = await this.vikunja.getTaskProjectId(reply.taskId);
        if (taskProjectId !== this.projectId) {
          throw new Error(`Task ${reply.taskId} does not belong to configured project ${this.projectId}`);
        }
        const comments = await this.vikunja.listComments(reply.taskId);
        if (!comments.some((existing) => hasTelegramCommentMarker(existing.comment, marker))) {
          await this.vikunja.createComment(reply.taskId, comment);
        }
        await this.acknowledgeComment(reply);
        this.logger.info(
          { taskId: reply.taskId, telegramMessageId: reply.messageId },
          'Telegram reply added to Vikunja',
        );
        return;
      } catch (error) {
        if (attempt === attempts || !isRetryableVikunjaError(error)) {
          await this.reportCommentFailure(reply, error);
          return;
        }
        const delay = this.commentRetryDelaysMs[attempt - 1] ?? 0;
        this.logger.warn(
          { taskId: reply.taskId, attempt, error: errorMessage(error) },
          `Vikunja comment failed; retrying in ${delay}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  private async acknowledgeComment(reply: TelegramReply): Promise<void> {
    try {
      await this.telegram.acknowledgeComment(reply.chatId, reply.messageId);
    } catch (error) {
      this.logger.debug(
        { error: errorMessage(error), updateId: reply.updateId },
        'Could not acknowledge Telegram comment',
      );
    }
  }

  private async reportCommentFailure(reply: TelegramReply, error: unknown): Promise<void> {
    this.logger.error(
      { taskId: reply.taskId, updateId: reply.updateId, error: errorMessage(error) },
      'Vikunja comment failed permanently',
    );
    try {
      await this.telegram.reportCommentFailure(reply.chatId, reply.messageId, reply.messageThreadId);
    } catch (telegramError) {
      this.logger.error(
        { updateId: reply.updateId, error: errorMessage(telegramError) },
        'Could not report comment failure',
      );
    }
  }
}
