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
```

## What is implemented

- Responsive campaign, room, player, transcript, and voice-table interface
- Name entry, live room membership, and room switching
- Campaign creation, invitation links, and stable campaign-scoped player sessions
- Owner-only campaign folio for invitation replacement, player removal, and room management
- SQLite-backed rooms and transcripts that survive server restarts
- WebSocket text chat between connected players
- WebRTC peer-to-peer voice with mute, leave, and push-to-talk controls
- Accessible labels, keyboard focus states, live message announcements, and reduced-motion support
- Typed JSON event envelopes for chat, presence, and WebRTC signalling
- A reconnecting RFC 6455 WebSocket client boundary

`npm run dev` starts both the Vite web client and the room server. Create a campaign, copy its invite link, and open that link in another browser session to join the same durable table.

Campaign data is stored in `data/wayfarer.sqlite` by default. Set `DATABASE_PATH` when you need an isolated database, such as `DATABASE_PATH=/tmp/wayfarer.sqlite npm start`.

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
