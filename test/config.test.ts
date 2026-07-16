import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const validEnvironment = {
  NODE_ENV: 'test',
  TELEGRAM_BOT_TOKEN: 'bot-token',
  TELEGRAM_CHAT_ID: '-1001234567890',
  VIKUNJA_API_URL: 'https://vikunja.example/api/v1/',
  VIKUNJA_FRONTEND_URL: 'https://vikunja.example/base/',
  VIKUNJA_API_TOKEN: 'api-token',
  VIKUNJA_PROJECT_ID: '42',
  VIKUNJA_WEBHOOK_SECRET: 'secret-longer-than-sixteen-characters',
};

describe('configuration', () => {
  it('parses and normalizes valid environment values', () => {
    expect(loadConfig(validEnvironment)).toMatchObject({
      telegramChatId: -1001234567890,
      vikunjaApiUrl: 'https://vikunja.example/api/v1',
      vikunjaFrontendUrl: 'https://vikunja.example/base',
      vikunjaProjectId: 42,
    });
  });

  it.each(['', '0', '123'])('rejects an invalid group chat ID %j', (chatId) => {
    expect(() => loadConfig({ ...validEnvironment, TELEGRAM_CHAT_ID: chatId })).toThrow('TELEGRAM_CHAT_ID');
  });

  it.each([
    'ftp://vikunja.example/api/v1',
    'https://user:password@vikunja.example/api/v1',
    'https://vikunja.example/api/v1?token=secret',
    'https://vikunja.example/api/v1#fragment',
  ])('rejects unsafe URL %s', (url) => {
    expect(() => loadConfig({ ...validEnvironment, VIKUNJA_API_URL: url })).toThrow('VIKUNJA_API_URL');
  });

  it('treats an empty optional topic ID as unset', () => {
    expect(loadConfig({ ...validEnvironment, TELEGRAM_MESSAGE_THREAD_ID: '' }).telegramMessageThreadId).toBeUndefined();
  });
});
