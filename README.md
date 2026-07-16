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
3. Before starting this service, send `/start@<bot_username>` in the group. No visible reply is expected; the command only queues an update for the bot.
4. Retrieve that update with `getUpdates`, keeping the token in a private shell variable rather than pasting it into documentation or chat. Copy the negative `message.chat.id` into `TELEGRAM_CHAT_ID`. See the [manual end-to-end test](docs/e2emanualtest.md#4-create-the-telegram-test-bot-and-group) for copy-pasteable commands.
5. If notifications belong in a forum topic, copy `message.message_thread_id` into `TELEGRAM_MESSAGE_THREAD_ID`; otherwise leave it unset.

## Configure Vikunja

1. Create a dedicated Vikunja integration account and give it write access only to the selected project.
2. Create an API token for that account with exactly these permissions:
   - **projects** → `read one`;
   - **tasks** → `read one`;
   - **tasks comments** → `read all`;
   - **tasks comments** → `create`.
3. Copy `.env.example` to `.env` and fill in the Vikunja API URL, frontend URL, token, and numeric project ID.
4. Generate a random webhook secret, for example with `openssl rand -hex 32`, and put it in `VIKUNJA_WEBHOOK_SECRET`.
5. In the selected project's **Settings → Webhooks**, create a webhook with:
   - target URL: `http://vikunja-telegram:3000/webhooks/vikunja`;
   - event: `task.created`;
   - secret: exactly the value of `VIKUNJA_WEBHOOK_SECRET`.

Use the project's settings, not the account-level webhook screen. User webhooks only offer reminder and overdue events; `task.created` is a project webhook event.

Vikunja blocks private and other non-routable webhook targets by default as SSRF protection. For a trusted, single-organization installation using the private Docker target above, set this on the Vikunja service and restart it:

```dotenv
VIKUNJA_OUTGOINGREQUESTS_ALLOWNONROUTABLEIPS=true
```

Do not enable that option on an instance where untrusted users can create webhooks. Use Vikunja's outgoing-request proxy or expose this service through a controlled HTTPS reverse proxy instead.

Configuration URLs must use HTTP or HTTPS and cannot contain credentials, query strings, or fragments. `VIKUNJA_FRONTEND_URL` becomes the Telegram **Open ticket** button URL, so it must be reachable by group members and must not use `localhost`; use the production Vikunja URL, or a reachable LAN address for a disposable local test. Use a dedicated Telegram bot and a least-privilege Vikunja token restricted to the configured project; replies are rejected if their task has moved to another project.

## Run with Docker

Deploy from the complete repository, not from the `Dockerfile` alone: the image build copies the package files, TypeScript configuration, build script, and `src/`. Node.js is not required on the deployment host because the multi-stage Docker build installs dependencies and compiles the application inside the build container.

The supplied Compose file joins an existing Docker network. Set `VIKUNJA_DOCKER_NETWORK` to the actual network containing Vikunja; `docker network ls` will show the available names. Keep `PORT=3000`: the supplied Compose healthcheck and the documented Vikunja webhook target both use that port. Transfer secrets separately from the repository and create `.env` directly on the deployment host.

```bash
cp .env.example .env
# Edit .env, then validate and deploy:
docker compose config --quiet
docker compose config --environment | grep '^VIKUNJA_DOCKER_NETWORK='
docker compose build --pull
docker compose up -d
docker compose ps
docker compose logs -f vikunja-telegram
```

If the container exits immediately, inspect `docker compose logs vikunja-telegram` for an `Invalid configuration: ...` message and correct the reported `.env` values.

No host port is published. Vikunja reaches the webhook over their shared Docker network, and the service makes outbound HTTPS requests to Telegram.
The container is stateless: it has no application volume to create, persist, or back up.

After startup, check readiness from inside the container:

```bash
docker compose exec vikunja-telegram node -e \
  "fetch('http://127.0.0.1:3000/readyz').then(async r => console.log(r.status, await r.text()))"
```

A ready service returns HTTP `200`. A `503` response includes the Telegram and Vikunja readiness states to help identify which dependency is unavailable. The Compose healthcheck intentionally uses `/healthz`, not `/readyz`, so Docker checks whether the HTTP process is alive while temporary Telegram or Vikunja outages are reported separately through readiness.

## Update a Docker deployment

Replace or pull the complete repository source while preserving the host's `.env`, then rebuild and replace the container:

```bash
docker compose config --quiet
docker compose build --pull
docker compose up -d
docker compose ps
docker compose logs --tail=100 vikunja-telegram
```

There is no application data migration or volume backup step because the service does not persist local state.

To roll back, restore the previous known-good commit, tag, or source archive without replacing the host's `.env`, then run the same validation, build, and deployment commands above. Confirm readiness and the expected version's behavior before discarding the newer source.

## Local development

```bash
npm install
npm run dev
```

For local webhook testing, Vikunja must be able to resolve and reach the configured webhook URL.

For a complete disposable Vikunja → Telegram → Vikunja verification, follow the [manual end-to-end test](docs/e2emanualtest.md).

Quality checks:

```bash
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build
```

## Operations

- `GET /healthz` checks the HTTP process.
- `GET /readyz` succeeds after grammY establishes its polling loop and a Vikunja project check passes. It represents startup readiness, not continuous Telegram reachability.
- `network ... declared as external, but could not be found` means `VIKUNJA_DOCKER_NETWORK` does not exactly match an existing Docker network; hyphens and underscores are different characters.
- A `Restarting (1)` container is crashing; inspect `docker compose logs --tail=100 --no-color vikunja-telegram`. `Up ... (healthy)` confirms HTTP liveness, after which `/readyz` must still confirm both dependencies.
- Invalid signatures return `401`, malformed signed payloads return `400`, and Telegram delivery failures return `502`.
- Signed webhooks must be no more than five minutes old. A bounded in-memory digest cache rejects replays during that window; restarting the process resets this cache.
- Notification delivery is best-effort and has no local retry: Vikunja currently sends webhooks once and does not retry failures, so a Telegram outage or service restart at delivery time can lose a notification.
- Comment delivery retries three times in memory. Before creating a comment it searches for the Telegram message marker, making a replay after an ambiguous API timeout idempotent without local storage.
- Restarting the container discards only an in-progress retry delay; there is no stored application state to recover.
- Shutdown stops polling, waits for in-flight Telegram reply middleware, and then closes HTTP.
- Logs are structured JSON and redact authorization headers. Tokens and webhook secrets are never logged.

After deployment, create a test task in the configured project. Confirm that one Telegram notification appears with a working **Open ticket** button, then reply to it and verify the attributed comment in Vikunja. The comment ends with visible Telegram attribution and a `Telegram reference: [[vikunja-telegram|...]]` line used for stateless idempotency.

## Deliberate limitations

This first version supports one project, one group, and optional single forum topic. It does not synchronize task updates, attachments, message edits/deletions, Telegram identities, commands, or replies to other users' replies.
