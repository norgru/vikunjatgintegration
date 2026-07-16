import { Bot, GrammyError, HttpError, type Context } from 'grammy';
import type { TelegramReply, TicketNotification } from './domain.js';
import { formatTicketNotification, taskIdFromTicketUrl } from './format.js';
import type { AppLogger } from './logger.js';

export interface TelegramGateway {
  sendTicketNotification(ticket: TicketNotification): Promise<void>;
  acknowledgeComment(chatId: number, messageId: number): Promise<void>;
  reportCommentFailure(chatId: number, messageId: number): Promise<void>;
}

type ReplyHandler = (reply: TelegramReply) => Promise<void> | void;

export function taskIdFromReplyMarkup(replyMarkup: unknown, frontendUrl: string): number | undefined {
  if (typeof replyMarkup !== 'object' || replyMarkup === null || !('inline_keyboard' in replyMarkup)) return undefined;
  const keyboard = (replyMarkup as { inline_keyboard?: unknown }).inline_keyboard;
  if (!Array.isArray(keyboard)) return undefined;

  for (const row of keyboard) {
    if (!Array.isArray(row)) continue;
    for (const button of row) {
      if (typeof button !== 'object' || button === null || !('url' in button)) continue;
      const url = (button as { url?: unknown }).url;
      if (typeof url !== 'string') continue;
      const taskId = taskIdFromTicketUrl(url, frontendUrl);
      if (taskId !== undefined) return taskId;
    }
  }
  return undefined;
}

export class TelegramBot implements TelegramGateway {
  private readonly bot: Bot;
  private replyHandler: ReplyHandler = () => undefined;

  constructor(
    token: string,
    private readonly chatId: number,
    private readonly messageThreadId: number | undefined,
    private readonly frontendUrl: string,
    private readonly logger: AppLogger,
  ) {
    this.bot = new Bot(token, { client: { timeoutSeconds: 25 } });
    this.bot.on('message:text', async (context) => this.handleTextMessage(context));
    this.bot.catch((error) => {
      const context = error.ctx;
      if (error.error instanceof GrammyError) {
        this.logger.error({ updateId: context.update.update_id, description: error.error.description }, 'Telegram API error');
      } else if (error.error instanceof HttpError) {
        this.logger.error({ updateId: context.update.update_id, error: error.error }, 'Telegram network error');
      } else {
        this.logger.error({ updateId: context.update.update_id, error: error.error }, 'Telegram update failed');
      }
    });
  }

  onReply(handler: ReplyHandler): void {
    this.replyHandler = handler;
  }

  async initialize(): Promise<void> {
    await this.bot.init();
  }

  start(): Promise<void> {
    return this.bot.start({
      allowed_updates: ['message'],
      timeout: 20,
      onStart: (botInfo) => this.logger.info({ bot: botInfo.username }, 'Telegram long polling started'),
    });
  }

  async stop(): Promise<void> {
    if (this.bot.isRunning()) await this.bot.stop();
  }

  private async handleTextMessage(context: Context): Promise<void> {
    const message = context.message;
    if (!message?.text || !message.from || message.from.is_bot || !message.reply_to_message || message.forward_origin) return;
    if (message.chat.id !== this.chatId) return;
    if (this.messageThreadId !== undefined && message.message_thread_id !== this.messageThreadId) return;
    if (message.reply_to_message.from?.id !== context.me.id) return;

    const taskId = taskIdFromReplyMarkup(message.reply_to_message.reply_markup, this.frontendUrl);
    if (taskId === undefined) return;

    const authorName = [message.from.first_name, message.from.last_name].filter(Boolean).join(' ').trim();
    await this.replyHandler({
      updateId: context.update.update_id,
      taskId,
      chatId: message.chat.id,
      messageId: message.message_id,
      ...(message.message_thread_id === undefined ? {} : { messageThreadId: message.message_thread_id }),
      text: message.text,
      authorName: authorName || message.from.username || String(message.from.id),
      ...(message.from.username ? { authorUsername: message.from.username } : {}),
    });
  }

  async sendTicketNotification(ticket: TicketNotification): Promise<void> {
    await this.bot.api.sendMessage(this.chatId, formatTicketNotification(ticket), {
      parse_mode: 'HTML',
      ...(this.messageThreadId === undefined ? {} : { message_thread_id: this.messageThreadId }),
      reply_markup: {
        inline_keyboard: [[{ text: 'Open ticket', url: ticket.ticketUrl }]],
      },
    });
  }

  async acknowledgeComment(chatId: number, messageId: number): Promise<void> {
    try {
      await this.bot.api.setMessageReaction(chatId, messageId, [{ type: 'emoji', emoji: '👍' }]);
    } catch (error) {
      this.logger.debug({ error, chatId, messageId }, 'Could not add Telegram success reaction');
    }
  }

  async reportCommentFailure(chatId: number, messageId: number): Promise<void> {
    await this.bot.api.sendMessage(chatId, 'I could not add that comment to Vikunja. Please try replying again.', {
      reply_parameters: { message_id: messageId, allow_sending_without_reply: true },
      ...(this.messageThreadId === undefined ? {} : { message_thread_id: this.messageThreadId }),
    });
  }
}
