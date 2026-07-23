# Wayfarer's Table

A responsive text-and-voice table for tabletop roleplaying groups.

## Run locally

```sh
npm install
npm run dev
```

Production verification:

```sh
npm run lint
npm run build
npm run test:e2e
```

## What is implemented

- Responsive campaign, room, player, transcript, and voice-table interface
- Name entry, live room membership, and room switching
- Campaign creation, invitation links and QR handoff, and stable campaign-scoped player sessions
- Accountless seat recovery with one-time keys and cross-device QR links
- Owner-only campaign folio for invitation replacement, player removal, seat-key reset, and room management
- SQLite-backed rooms and transcripts that survive server restarts
- Campaign-wide unread activity, transcript search, and revision-safe shared notes
- WebSocket text chat between connected players
- WebRTC peer-to-peer voice with mute, leave, and push-to-talk controls
- Accessible labels, keyboard focus states, live message announcements, and reduced-motion support
- Typed JSON event envelopes for chat, presence, and WebRTC signalling
- A reconnecting RFC 6455 WebSocket client boundary

`npm run dev` starts both the Vite web client and the room server. Create a campaign, save the one-time seat key, then open **Invite players** to copy, share, or scan its join link from another browser. A player can later recover the same campaign identity with their name and latest seat key; successful recovery rotates both the session and recovery credentials.

`npm run test:e2e` starts isolated in-memory room and web servers, then verifies invitation, unread, search, shared-note, and two-browser WebRTC voice flows with Playwright. Voice tests use synthetic Web Audio microphone streams and exercise real media tracks and peer negotiation without recording host audio.

Campaign data is stored in `data/wayfarer.sqlite` by default. Set `DATABASE_PATH` when you need an isolated database, such as `DATABASE_PATH=/tmp/wayfarer.sqlite npm start`.

## Production operations

The server exposes `GET /api/health` for readiness checks. It verifies that the SQLite connection can execute a query and returns `200 {"status":"ok"}` when ready.

Production requests are same-origin by default. If the web client is hosted on another origin, list each exact HTTP origin explicitly:

```sh
ALLOWED_ORIGINS='https://table.example.com,https://play.example.com' npm start
```

Public campaign creation, invitation join, and seat recovery routes have in-memory IP rate limits. Run a single server process, or enforce equivalent shared limits at the reverse proxy when scaling horizontally. Set `TRUST_PROXY=1` only when the server is directly behind a trusted proxy that replaces `X-Forwarded-For`; never enable it when clients can connect directly.

Back up a live database with SQLite's online backup command so the main database and WAL are captured consistently:

```sh
mkdir -p backups
sqlite3 data/wayfarer.sqlite ".backup 'backups/wayfarer-$(date +%Y-%m-%d).sqlite'"
sqlite3 backups/wayfarer-$(date +%Y-%m-%d).sqlite 'PRAGMA integrity_check;'
```

Store backups outside the application host, encrypt them at rest, and test a restore regularly. Do not copy only `wayfarer.sqlite` while the server is running; committed data may still be in its `-wal` file.

## Protocol boundary

The included room server uses bearer-token sessions for HTTP and WebSocket authorization, SQLite for campaign data and transcripts, WebSocket for room events and WebRTC signalling, and encrypted WebRTC peer connections for voice.

### Production voice

Browsers require HTTPS for microphone access outside localhost. Serve the built application and room server behind HTTPS; the client automatically uses WSS when loaded over HTTPS.

The default ICE configuration contains a public STUN server, which is enough for local testing and some networks. Production deployments should provide a TURN service for players behind restrictive NAT or firewalls:

```sh
ICE_SERVERS='[{"urls":["stun:turn.example.com:3478"]},{"urls":["turns:turn.example.com:5349"],"username":"wayfarer","credential":"replace-me"}]' npm start
```

`ICE_SERVERS` must be a non-empty JSON array of WebRTC ICE server objects. It is validated at startup and delivered only to authenticated campaign sessions. Prefer short-lived TURN credentials from your provider rather than a permanent shared secret. Allow the provider's documented UDP and TCP/TLS relay ports through the deployment firewall.

Each peer seat reports its actual WebRTC state. A dropped connection triggers up to two ICE restarts; if recovery fails, the table shows the failed seat and offers a manual voice retry without interrupting text chat.

The shared client/server event types live in `src/types/protocol.ts`. The reconnecting WebSocket adapter lives in `src/lib/realtime.ts`.
