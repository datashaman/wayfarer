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
- Name entry, live room membership, room switching, and in-memory message history
- WebSocket text chat between connected players
- WebRTC peer-to-peer voice with mute, leave, and push-to-talk controls
- Accessible labels, keyboard focus states, live message announcements, and reduced-motion support
- Typed JSON event envelopes for chat, presence, and WebRTC signalling
- A reconnecting RFC 6455 WebSocket client boundary

`npm run dev` starts both the Vite web client and the room server. Open the app in two browser tabs, enter a different name in each, and both players can chat and join the same voice table.

## Protocol boundary

The included room server uses WebSocket for membership, messages, and WebRTC signalling. Voice uses encrypted WebRTC peer connections with browser-negotiated Opus audio. Production deployments still need HTTPS/WSS, authentication, durable message storage, and a TURN service for restrictive networks.

The shared client/server event types live in `src/types/protocol.ts`. The reconnecting WebSocket adapter lives in `src/lib/realtime.ts`.
