# ChatKeep

Personal chat/message record vault for your phone.

Save messages **you** choose to keep (paste, type, or share into the app). Sync them across phones that use the same access code. ChatKeep does **not** scrape WhatsApp, SMS, or other apps.

## Run

From the repo root (uses existing Express/Mongoose deps):

```bash
npm run chatkeep
```

Or:

```bash
node message-vault/server.js
```

Then open `http://localhost:4055` on your computer, or on your phone using your computer’s LAN IP (same Wi‑Fi), e.g. `http://192.168.x.x:4055`.

## Phone setup

1. Open ChatKeep in your phone browser.
2. Enter the access code (default: `keepchat`).
3. Name this phone and tap **Open vault**.
4. Install to home screen (Add to Home Screen / Install app) for a native-like icon.
5. Paste chats you want to keep and tap **Keep**. Tap **Sync** to push/pull with the server.

## Config

Set in `.env` (repo root):

| Variable | Default | Meaning |
|----------|---------|---------|
| `MESSAGE_VAULT_PORT` | `4055` | HTTP port |
| `MESSAGE_VAULT_ACCESS_CODE` | `keepchat` | Shared vault PIN |
| `MONGODB_URI` | (optional) | Persists records; falls back to memory if missing |

## API (for power users)

All `/api/*` routes need header `X-Access-Code: <code>`.

- `POST /api/devices/register` — register this phone
- `GET /api/records` — list / search
- `POST /api/records` — save one
- `POST /api/records/bulk` — sync offline queue
- `DELETE /api/records/:id` — delete
