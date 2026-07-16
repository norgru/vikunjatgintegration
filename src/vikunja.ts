import { z } from 'zod';
import type { TaskComment } from './domain.js';

const commentSchema = z.object({ id: z.number().int(), comment: z.string() });
const commentsSchema = z.array(commentSchema);
const taskSchema = z.object({ project_id: z.number().int().positive() });

export class VikunjaError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'VikunjaError';
  }
}

export function isRetryableVikunjaError(error: unknown): boolean {
  return error instanceof VikunjaError && error.retryable;
}

export interface VikunjaGateway {
  checkProject(projectId: number): Promise<void>;
  getTaskProjectId(taskId: number): Promise<number>;
  listComments(taskId: number): Promise<TaskComment[]>;
  createComment(taskId: number, comment: string): Promise<void>;
}

export class VikunjaClient implements VikunjaGateway {
  constructor(
    private readonly apiUrl: string,
    private readonly apiToken: string,
    private readonly timeoutMs = 10_000,
  ) {}

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(`${this.apiUrl}${path}`, {
        ...init,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.apiToken}`,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...init.headers,
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new VikunjaError(
        `Vikunja ${init.method ?? 'GET'} ${path} failed before receiving a response`,
        undefined,
        true,
        {
          cause: error,
        },
      );
    }
    if (!response.ok) {
      const body = (await response.text()).slice(0, 500);
      const retryable = response.status === 429 || response.status >= 500;
      throw new VikunjaError(
        `Vikunja ${init.method ?? 'GET'} ${path} failed with ${response.status}: ${body}`,
        response.status,
        retryable,
      );
    }
    return response;
  }

  async checkProject(projectId: number): Promise<void> {
    await this.request(`/projects/${projectId}`);
  }

  async getTaskProjectId(taskId: number): Promise<number> {
    const response = await this.request(`/tasks/${taskId}`);
    return taskSchema.parse(await response.json()).project_id;
  }

  async listComments(taskId: number): Promise<TaskComment[]> {
    const response = await this.request(`/tasks/${taskId}/comments`);
    return commentsSchema.parse(await response.json());
  }

  async createComment(taskId: number, comment: string): Promise<void> {
    await this.request(`/tasks/${taskId}/comments`, {
      method: 'PUT',
      body: JSON.stringify({ comment }),
    });
  }
}
