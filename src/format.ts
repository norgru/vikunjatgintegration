import type { TelegramReply, TicketNotification, VikunjaWebhook } from './domain.js';

export function escapeTelegramHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function truncate(value: string, maximum: number): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`;
}

function displayName(
  user: { name?: string | null | undefined; username?: string | null | undefined } | null | undefined,
): string | undefined {
  const name = user?.name?.trim();
  if (name) return name;
  const username = user?.username?.trim();
  return username ? `@${username}` : undefined;
}

export function ticketNotificationFromWebhook(payload: VikunjaWebhook, frontendUrl: string): TicketNotification {
  const task = payload.data.task;
  const creator = displayName(payload.data.doer ?? task.created_by);
  const dueDate = task.due_date ? new Date(task.due_date) : undefined;
  const hasDueDate = dueDate && !Number.isNaN(dueDate.getTime()) && dueDate.getUTCFullYear() > 1;
  return {
    taskId: task.id,
    ...(task.identifier ? { identifier: task.identifier } : {}),
    title: task.title,
    ...(creator ? { creator } : {}),
    assignees: (task.assignees ?? []).map(displayName).filter((value): value is string => Boolean(value)),
    ...(hasDueDate ? { dueDate: task.due_date! } : {}),
    ticketUrl: `${frontendUrl}/tasks/${task.id}`,
  };
}

function formatDueDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return (
    new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(date) + ' UTC'
  );
}

export function formatTicketNotification(ticket: TicketNotification): string {
  const heading = ticket.identifier ? `New ticket · ${truncate(ticket.identifier, 100)}` : 'New ticket';
  const lines = [
    `🆕 <b>${escapeTelegramHtml(heading)}</b>`,
    `<b>${escapeTelegramHtml(truncate(ticket.title, 2_000))}</b>`,
  ];
  if (ticket.creator) lines.push(`Created by: ${escapeTelegramHtml(truncate(ticket.creator, 250))}`);
  if (ticket.assignees.length > 0) {
    lines.push(`Assigned to: ${escapeTelegramHtml(truncate(ticket.assignees.join(', '), 1_000))}`);
  }
  if (ticket.dueDate) lines.push(`Due: ${escapeTelegramHtml(formatDueDate(ticket.dueDate))}`);
  lines.push('', 'Reply to this message to add a comment.');
  return lines.join('\n');
}

export function taskIdFromTicketUrl(candidateUrl: string, frontendUrl: string): number | undefined {
  try {
    const candidate = new URL(candidateUrl);
    const frontend = new URL(frontendUrl);
    if (candidate.origin !== frontend.origin) return undefined;

    const frontendPath = frontend.pathname.replace(/\/+$/, '');
    const expectedPrefix = `${frontendPath}/tasks/`;
    if (!candidate.pathname.startsWith(expectedPrefix)) return undefined;
    const remainder = candidate.pathname.slice(expectedPrefix.length).replace(/\/+$/, '');
    if (!/^\d+$/.test(remainder)) return undefined;
    const taskId = Number(remainder);
    return Number.isSafeInteger(taskId) && taskId > 0 ? taskId : undefined;
  } catch {
    return undefined;
  }
}

export function telegramCommentMarker(reply: Pick<TelegramReply, 'chatId' | 'messageId'>): string {
  return `[[vikunja-telegram|${reply.chatId}|${reply.messageId}]]`;
}

export function hasTelegramCommentMarker(comment: string, marker: string): boolean {
  const finalLine = comment.trimEnd().split(/\r?\n/).at(-1);
  return finalLine === `Telegram reference: ${marker}`;
}

export function formatVikunjaComment(reply: TelegramReply): string {
  const username = reply.authorUsername ? ` (@${reply.authorUsername})` : '';
  return `${reply.text.trim()}\n\n— Telegram: ${reply.authorName}${username}\nTelegram reference: ${telegramCommentMarker(reply)}`;
}
