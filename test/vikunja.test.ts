import { afterEach, describe, expect, it, vi } from 'vitest';
import { VikunjaClient, VikunjaError } from '../src/vikunja.js';

describe('VikunjaClient', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends authenticated requests and validates task/comment responses', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ project_id: 42 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 1, comment: 'hello' }]), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new VikunjaClient('https://vikunja.example/api/v1', 'secret-token');

    expect(await client.getTaskProjectId(123)).toBe(42);
    expect(await client.listComments(123)).toEqual([{ id: 1, comment: 'hello' }]);
    await client.createComment(123, 'new comment');

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://vikunja.example/api/v1/tasks/123');
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: 'Bearer secret-token' });
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({
      method: 'PUT',
      body: JSON.stringify({ comment: 'new comment' }),
    });
  });

  it.each([
    [401, false],
    [429, true],
    [503, true],
  ])('classifies HTTP %i retryability as %s', async (status, retryable) => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response('failure', { status })));
    const client = new VikunjaClient('https://vikunja.example/api/v1', 'token');
    const error = await client.listComments(1).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(VikunjaError);
    expect(error).toMatchObject({ status, retryable });
  });

  it('classifies network failures as retryable', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new TypeError('network down')));
    const client = new VikunjaClient('https://vikunja.example/api/v1', 'token');
    await expect(client.listComments(1)).rejects.toMatchObject({ retryable: true, status: undefined });
  });

  it('rejects malformed Vikunja responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify([{ id: 'bad' }]), { status: 200 })),
    );
    const client = new VikunjaClient('https://vikunja.example/api/v1', 'token');
    await expect(client.listComments(1)).rejects.toThrow();
  });
});
