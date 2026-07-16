# Manual End-to-End Test

This guide runs a disposable Vikunja instance and the integration on one Docker network, then verifies the complete Vikunja → Telegram → Vikunja flow. It assumes Docker Desktop on macOS and Telegram on a device that can reach the Mac over the local network.

Do not reuse a production Telegram bot while another integration instance is polling it. Use a test bot and group.

## 1. Create the Docker network

```bash
docker network create vikunja-test
docker network inspect vikunja-test
```

If Docker reports that the network already exists, continue.

## 2. Start disposable Vikunja

Create writable test directories owned by your macOS user:

```bash
mkdir -p "$HOME/vikunja-e2e/files" "$HOME/vikunja-e2e/db"
sudo chown -R "$(id -u):$(id -g)" "$HOME/vikunja-e2e/files" "$HOME/vikunja-e2e/db"
chmod -R u+rwX "$HOME/vikunja-e2e/files" "$HOME/vikunja-e2e/db"
```

Find the Mac's address on its active local network interface:

```bash
NETWORK_INTERFACE="$(route -n get default | awk '/interface:/{print $2}')"
LAN_IP="$(ipconfig getifaddr "$NETWORK_INTERFACE")"
printf 'Interface: %s\nLAN address: %s\n' "$NETWORK_INTERFACE" "$LAN_IP"
```

If the address is empty or belongs to a VPN, find the Mac's reachable LAN address in **System Settings → Network** and set it manually, for example `LAN_IP=192.168.1.25`.

Run Vikunja with the same numeric user. The outgoing-request setting is appropriate only for this trusted local test instance. The LAN URL is required because Telegram rejects `localhost` as an inline-keyboard button URL.

```bash
docker run -d \
  --name vikunja-test \
  --user "$(id -u):$(id -g)" \
  --network vikunja-test \
  -p 3456:3456 \
  -e "VIKUNJA_SERVICE_PUBLICURL=http://${LAN_IP}:3456/" \
  -e VIKUNJA_OUTGOINGREQUESTS_ALLOWNONROUTABLEIPS=true \
  -v "$HOME/vikunja-e2e/files:/app/vikunja/files" \
  -v "$HOME/vikunja-e2e/db:/db" \
  vikunja/vikunja:latest
```

If a failed `vikunja-test` container already exists, remove it with `docker rm -f vikunja-test` before rerunning the command.

Follow startup logs:

```bash
docker logs -f vikunja-test
```

Press `Ctrl+C` after startup, then open `http://<LAN_IP>:3456` in a browser and register a test account. Keep the browser-facing URL consistent with the integration configuration in step 5.

## 3. Create a project and API token

Create a project named `Telegram Integration Test`. Under **Settings → API Tokens**, create a dedicated token and save it immediately.

Enable exactly these permissions for the integration token:

- **projects** → `read one` for `GET /projects/{id}`;
- **tasks** → `read one` for `GET /tasks/{id}`;
- **tasks comments** → `read all` for `GET /tasks/{id}/comments`;
- **tasks comments** → `create` for `PUT /tasks/{id}/comments`.

Prefer obtaining the numeric project ID from the project URL. The optional project-list call below requires **projects** → `read all`, which the running integration does not need. If the URL does not make the ID clear, use a separate temporary discovery token with `read all` rather than broadening the integration token:

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:3456/api/v1/projects
```

This host-side discovery request may use `localhost`; unlike `VIKUNJA_FRONTEND_URL`, it is never sent to Telegram or opened on another device.

## 4. Create the Telegram test bot and group

1. Send `/newbot` to [BotFather](https://t.me/BotFather) and save the token.
2. Keep privacy mode enabled.
3. Create a private test group and add the bot without administrator permissions.
4. Store the token in a silent zsh variable. Run the command first, paste the token when prompted (it remains invisible), then press Enter:

   ```zsh
   read -rs "TELEGRAM_BOT_TOKEN?Paste the test bot token, then press Enter: "
   echo
   export TELEGRAM_BOT_TOKEN
   ```

5. Confirm the token and exact bot username:

   ```zsh
   curl -sS -- "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe" |
     python3 -m json.tool
   ```

6. Send `/start@YourExactBotUsername` in the group. No visible reply is expected because the integration is not running and does not implement command responses; the command only queues an update.
7. Retrieve queued message and membership updates:

   ```zsh
   curl -sS -X POST \
     "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates" \
     -H "Content-Type: application/json" \
     -d '{"offset":-10,"limit":10,"timeout":0,"allowed_updates":["message","my_chat_member"]}' |
     python3 -m json.tool
   ```

8. Copy the negative group ID from `message.chat.id` or `my_chat_member.chat.id`. A positive ID belongs to a private chat and is not the group ID.

Do not call `getUpdates` after starting the integration; only one long-poll consumer can use the bot at a time.

`can_read_all_group_messages: false` is the desired privacy-mode state. The bot still receives commands explicitly addressed to it and direct replies to its own messages. If a token is pasted into chat, logs, or documentation, revoke it immediately through BotFather and use the replacement.

## 5. Configure the integration

If the repository has no `.env`, create it from the example:

```bash
cp .env.example .env
openssl rand -hex 32
```

Save an existing `.env` before replacing it. Edit the test `.env`:

```dotenv
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
LOG_LEVEL=info

TELEGRAM_BOT_TOKEN=<test bot token>
TELEGRAM_CHAT_ID=<negative test group ID>
# TELEGRAM_MESSAGE_THREAD_ID=<optional forum topic ID>

VIKUNJA_API_URL=http://vikunja-test:3456/api/v1
# Replace <LAN_IP> with the address found in step 2; do not use localhost.
VIKUNJA_FRONTEND_URL=http://<LAN_IP>:3456
VIKUNJA_API_TOKEN=<test Vikunja API token>
VIKUNJA_PROJECT_ID=<numeric test project ID>
VIKUNJA_WEBHOOK_SECRET=<generated secret>

VIKUNJA_DOCKER_NETWORK=vikunja-test
```

## 6. Start and check the integration

Run these commands from the repository directory containing `compose.yaml`. Confirm the external network spelling before starting; the value must use the same hyphen as `vikunja-test`:

```bash
docker network inspect vikunja-test
docker compose config --environment | grep '^VIKUNJA_DOCKER_NETWORK='
docker compose config --quiet
docker compose up --build -d
docker compose ps
docker compose logs --tail=100 vikunja-telegram
```

Check readiness:

```bash
docker compose exec vikunja-telegram node -e \
  "fetch('http://127.0.0.1:3000/readyz').then(async r => console.log(r.status, await r.text()))"
```

Continue only after this returns HTTP `200` with both `telegram` and `vikunja` set to `true`.

## 7. Configure the project webhook

Open **Project settings → Webhooks** and create:

- target URL: `http://vikunja-telegram:3000/webhooks/vikunja`;
- event: `task.created` only;
- secret: exactly the value of `VIKUNJA_WEBHOOK_SECRET`;
- basic authentication: disabled.

Do not use the account-level webhook screen. If the event selector only shows `task.overdue`, `task.reminder.fired`, and `tasks.overdue`, return to the test project and open that project's settings.

## 8. Verify both directions

Create a task in `Telegram Integration Test` and confirm:

1. One Telegram notification appears.
2. **Open ticket** opens the correct Vikunja task.
3. A direct reply to the bot notification becomes a comment on that task.
4. The comment includes visible sender attribution and machine-readable metadata in this form:

   ```text
   Your reply text

   — Telegram: Display Name (@username)
   Telegram reference: [[vikunja-telegram|<chat-id>|<message-id>]]
   ```

5. An unrelated group message does not create a comment.

After correcting a webhook problem, create a new task: Vikunja does not retry a failed delivery.

## 9. Verify restart behavior

```bash
docker compose restart vikunja-telegram
docker compose ps
docker compose logs --tail=100 vikunja-telegram
```

Wait for readiness again, then create another task and reply to its notification.

## Troubleshooting

- `Could not init file handler ... permission denied`: recreate the container with the ownership and `--user` commands from step 2.
- `telegram:false`: check the bot token and ensure no other process is polling the bot.
- `vikunja:false`: check the internal API URL, token permissions, project ID, and shared network.
- Immediate container exit: inspect logs for `Invalid configuration: ...`.
- `no configuration file provided`: change to the integration repository directory before running `docker compose`.
- `network ... declared as external, but could not be found`: compare `docker network ls` with `VIKUNJA_DOCKER_NETWORK`. Names are exact; `vikunja-test` and `vikunja_test` are different. A temporary override must be on the same command line: `VIKUNJA_DOCKER_NETWORK=vikunja-test docker compose up -d`.
- `Restarting (1)`: the process is crashing; run `docker compose logs --tail=100 --no-color vikunja-telegram`.
- `Up ... (healthy)`: HTTP liveness is working, but run the `/readyz` check before configuring the webhook.
- No notification: verify the webhook event, target, secret, and Vikunja outgoing-request setting. Create a new task after fixing it.
- Repeated notification attempts for one task: check the project webhook list and remove duplicate registrations.
- Notification works but replies fail: verify task-read and task-comment permissions and reply directly to the bot notification.
- Telegram reports `inline keyboard button URL ... is invalid: Wrong HTTP URL`: replace `localhost` in both `VIKUNJA_SERVICE_PUBLICURL` and `VIKUNJA_FRONTEND_URL` with the reachable LAN URL, recreate both containers, and create a new task.
- Ticket link cannot be opened from another device: confirm that device can load `http://<LAN_IP>:3456`, or use a controlled HTTPS URL instead.

## 10. Tear down the test environment

From the integration repository:

```bash
docker compose down
docker rm -f vikunja-test
docker network rm vikunja-test
```

Restore any saved `.env`. Only after confirming that the path contains disposable test data, remove `$HOME/vikunja-e2e`:

```bash
rm -rf -- "$HOME/vikunja-e2e"
```

Optionally delete the Telegram test group and revoke or delete the test bot through BotFather.

## References

- [Vikunja Docker installation](https://vikunja.io/docs/installing/#docker)
- [Vikunja API tokens](https://vikunja.io/help/settings/#api-tokens)
- [Vikunja webhooks](https://vikunja.io/help/webhooks/)
- [Vikunja outgoing-request configuration](https://vikunja.io/docs/config-options/#allownonroutableips)
