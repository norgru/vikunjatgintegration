# Vikunja Telegram integration

A small, self-hosted bridge for one Vikunja project and one Telegram group. It posts a linked Telegram notification when a task is created. A group member can reply directly to that notification to add an attributed comment to the Vikunja task.

## Behaviour

- Accepts signed Vikunja `task.created` webhooks only for the configured project.
- Sends each accepted webhook directly to Telegram without a database, queue, or persistent volume.
- Links directly to `/tasks/{taskId}` in the Vikunja frontend.
- Uses Telegram long polling, so Telegram does not require a public callback URL.
- Validates that a reply targets this bot, extracts the task ID from the original notification's **Open ticket** button, and creates the Vikunja comment through one service account.
- Adds the Telegram sender and a stable message reference to each comment. The reference prevents duplicate comments after an ambiguous API timeout.
- Ignores other chats, unrelated replies, media, edited messages, and bot messages.

## Prerequisites

- A self-hosted Vikunja instance with webhooks enabled.
- Node.js 24 for local development, or Docker for deployment.
- A Telegram bot created with [BotFather](https://t.me/BotFather).
- A Vikunja account with write access to the selected project.

Keep BotFather privacy mode enabled. Telegram still delivers direct replies to the bot's own messages, while unrelated group conversation remains invisible to it.

## Configure Telegram

1. Create a bot with BotFather and copy its token into `TELEGRAM_BOT_TOKEN`.
2. Add the bot to the target group. It does not need administrator permissions.
3. Before starting this service, send a message in the group and inspect `https://api.telegram.org/bot<token>/getUpdates`. Copy `message.chat.id` into `TELEGRAM_CHAT_ID`. Supergroup IDs normally begin with `-100`.
4. If notifications belong in a forum topic, copy `message.message_thread_id` into `TELEGRAM_MESSAGE_THREAD_ID`; otherwise leave it unset.

## Configure Vikunja

1. Create a dedicated Vikunja integration account and give it write access only to the selected project.
2. Create an API token for that account with the minimum routes needed to:
   - read the configured project;
   - list task comments;
   - create task comments.
3. Copy `.env.example` to `.env` and fill in the Vikunja API URL, frontend URL, token, and numeric project ID.
4. Generate a random webhook secret, for example with `openssl rand -hex 32`, and put it in `VIKUNJA_WEBHOOK_SECRET`.
5. In the selected project's **Settings → Webhooks**, create a webhook with:
   - target URL: `http://vikunja-telegram:3000/webhooks/vikunja`;
   - event: `task.created`;
   - secret: exactly the value of `VIKUNJA_WEBHOOK_SECRET`.

Vikunja blocks private and other non-routable webhook targets by default as SSRF protection. For a trusted, single-organization installation using the private Docker target above, set this on the Vikunja service and restart it:

```dotenv
VIKUNJA_OUTGOINGREQUESTS_ALLOWNONROUTABLEIPS=true
```

Do not enable that option on an instance where untrusted users can create webhooks. Use Vikunja's outgoing-request proxy or expose this service through a controlled HTTPS reverse proxy instead.

## Run with Docker

The supplied Compose file joins an existing Docker network. Set `VIKUNJA_DOCKER_NETWORK` to the actual network containing Vikunja; `docker network ls` will show the available names.

```bash
cp .env.example .env
# Edit .env, then:
docker compose up --build -d
docker compose logs -f vikunja-telegram
```

No host port is published. Vikunja reaches the webhook over their shared Docker network, and the service makes outbound HTTPS requests to Telegram.
The container is stateless: it has no application volume to create, persist, or back up.

## Local development

```bash
npm install
npm run dev
```

For local webhook testing, Vikunja must be able to resolve and reach the configured webhook URL.

Quality checks:

```bash
npm test
npm run typecheck
npm run build
```

## Operations

- `GET /healthz` checks the HTTP process.
- `GET /readyz` returns success only after Telegram initialization and a successful Vikunja project check.
- Invalid signatures return `401`, malformed signed payloads return `400`, and Telegram delivery failures return `502`.
- Notification delivery is best-effort and has no local retry: Vikunja currently sends webhooks once and does not retry failures, so a Telegram outage or service restart at delivery time can lose a notification.
- Comment delivery retries three times in memory. Before creating a comment it searches for the Telegram message marker, making a replay after an ambiguous API timeout idempotent without local storage.
- Restarting the container discards only an in-progress retry delay; there is no stored application state to recover.
- Logs are structured JSON and redact authorization headers. Tokens and webhook secrets are never logged.

After deployment, create a test task in the configured project. Confirm that one Telegram notification appears with a working **Open ticket** button, then reply to it and verify the attributed comment in Vikunja.

## Deliberate limitations

This first version supports one project, one group, and optional single forum topic. It does not synchronize task updates, attachments, message edits/deletions, Telegram identities, commands, or replies to other users' replies.
