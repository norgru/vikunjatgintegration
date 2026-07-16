import type { TaskComment } from './domain.js';

export interface VikunjaGateway {
  checkProject(projectId: number): Promise<void>;
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
    const response = await fetch(`${this.apiUrl}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.apiToken}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      const body = (await response.text()).slice(0, 500);
      throw new Error(`Vikunja ${init.method ?? 'GET'} ${path} failed with ${response.status}: ${body}`);
    }
    return response;
  }

  async checkProject(projectId: number): Promise<void> {
    await this.request(`/projects/${projectId}`);
  }

  async listComments(taskId: number): Promise<TaskComment[]> {
    const response = await this.request(`/tasks/${taskId}/comments`);
    const body: unknown = await response.json();
    if (!Array.isArray(body)) throw new Error('Vikunja returned an invalid comments response');
    return body.flatMap((value): TaskComment[] => {
      if (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as { id?: unknown }).id === 'number' &&
        typeof (value as { comment?: unknown }).comment === 'string'
      ) {
        return [{ id: (value as { id: number }).id, comment: (value as { comment: string }).comment }];
      }
      return [];
    });
  }

  async createComment(taskId: number, comment: string): Promise<void> {
    await this.request(`/tasks/${taskId}/comments`, {
      method: 'PUT',
      body: JSON.stringify({ comment }),
    });
  }
}
