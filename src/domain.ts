import { z } from 'zod';

const userSchema = z.object({
  name: z.string().nullish(),
  username: z.string().nullish(),
});

const taskSchema = z.object({
  id: z.number().int().positive(),
  project_id: z.number().int().positive(),
  identifier: z.string().nullish(),
  title: z.string().min(1),
  due_date: z.string().nullish(),
  assignees: z.array(userSchema).nullish(),
  created_by: userSchema.nullish(),
});

export const vikunjaWebhookSchema = z.object({
  event_name: z.string(),
  time: z.string(),
  data: z.object({
    task: taskSchema,
    doer: userSchema.nullish(),
  }),
});

export type VikunjaWebhook = z.infer<typeof vikunjaWebhookSchema>;

export type TelegramReply = {
  updateId: number;
  taskId: number;
  chatId: number;
  messageId: number;
  messageThreadId?: number;
  text: string;
  authorName: string;
  authorUsername?: string;
};

export type TicketNotification = {
  taskId: number;
  identifier?: string;
  title: string;
  creator?: string;
  assignees: string[];
  dueDate?: string;
  ticketUrl: string;
};

export type TaskComment = {
  id: number;
  comment: string;
};
