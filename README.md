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
- Durable per-player read state, reconnect catch-up, idempotent messages, and paginated transcript history
- WebSocket text chat between connected players
- WebRTC peer-to-peer voice with mute, leave, and push-to-talk controls
- Accessible labels, keyboard focus states, live message announcements, and reduced-motion support
- Typed JSON event envelopes for chat, presence, and WebRTC signalling
- A reconnecting RFC 6455 WebSocket client boundary

`npm run dev` starts both the Vite web client and the room server. Create a campaign, save the one-time seat key, then open **Invite players** to copy, share, or scan its join link from another browser. A player can later recover the same campaign identity with their name and latest seat key; successful recovery rotates both the session and recovery credentials.

To enable GM-triggered Living Canon suggestions, copy `.env.example` to `.env.local` and set `OPENAI_API_KEY`. When a GM explicitly chooses **Find passages**, the server sends the next batch of at most 100 previously unscanned campaign messages to the configured model. The durable scan cursor advances only after extraction succeeds, so repeat scans do not resend old transcript and messages arriving during a scan remain queued for the next one. Suggestions start GM-only, cite their transcript sources, and cannot become canon until a GM accepts or edits them. Responses are requested with API storage disabled. `OPENAI_CANON_MODEL` defaults to `gpt-5.6-luna` and can be overridden.

Each campaign has a GM-private, revision-safe canon constitution in the Living Canon ledger. It records the table’s evidence threshold, treatment of player declarations and OOC corrections, correction precedence, review visibility default, and optional table guidance. Every edit appends a new numbered revision. Extraction receives the current constitution as trusted GM policy, while transcript text and prior rulings remain quoted data; the constitution cannot remove citation, privacy, structured-output, or human-review safeguards.

Transcript activity automatically forms a current campaign session. A GM can close and name it from Living Canon, freezing its exact message range and active speakers; the next message opens a new current session without setup. Each chapter shows whether canon review is unreviewed, partial, or complete. Continuity and contradiction tools run against the GM-selected session rather than arbitrary recent history. Sessions above one model context are processed in overlapping 200-message chunks, deduplicated, and ranked before the report cap is applied; a 5,000-message operational ceiling remains explicit.

Each canon extraction and continuity run receives up to 20 recent human rulings from that campaign. Accepted edits and useful threads show the table's preferred patterns, while incorrect, secret-leak, and not-useful outcomes tell generators what not to repeat. Feedback remains quoted context rather than instructions, and the same strict citation and visibility checks still apply to every generated result.

Before a suggestion enters review, deterministic near-duplicate matching compares its normalized title and claim with pending and previously ruled proposals of the same kind. Equivalent pending suggestions absorb new citations; equivalents of accepted, disputed, or rejected claims are suppressed. Negation and world-change wording such as “now” or “no longer” prevents a match so changed facts remain available to the contradiction workflow. Match outcomes are retained by extractor version.

Human rulings can also be inspected as a versioned, local evaluation set. `npm run eval:feedback` reads `DATABASE_PATH` (or `data/wayfarer.sqlite`) and writes JSON to stdout with canon acceptance, edit, dispute, and rejection rates; continuity usefulness, error, and secret-leak rates; and deduplication outcomes, grouped by generator version. Add `-- --campaign ID` to scope one campaign or `-- --output PATH` to create a new file; an existing output file is never overwritten. The export excludes player and campaign names but contains exact cited campaign text, so keep it private and do not commit it.

Comparable live-model results can be appended with `npm run eval:record`; see `docs/ai-evaluation.md` for arguments and release thresholds. The GM-only AI evaluation ledger compares human verdicts by generator version, shows secret-leak and regression warnings, tracks release gates, and joins every production surface’s current edition with campaign-scoped live checks and privacy-safe runtime health. Runtime traces retain duration, provider usage, outcome, and a coarse error category—never prompts, campaign content, output, reasoning, or error messages. Readiness can only enable draft preparation—never automatic publication or canon changes.

`npm run eval:all` runs and records the canon, continuity, contradiction, recap, character-knowledge, intent, house-rule, and faction-clock live suites together. The four campaign-intelligence suites can also be run independently with `npm run eval:knowledge`, `npm run eval:intent`, `npm run eval:house-rules`, and `npm run eval:factions`. Once a campaign passes every release gate, a GM may opt into post-session preparation from **Table tools**. Closing a session then queues only the selected private drafts—canon suggestions, a continuity brief, and/or a recap. Readiness is checked again for every run, and no result is accepted or published automatically.

**Table tools** also holds four bounded campaign workflows. Character recollection answers cite only canon readable by the requesting seat. The intent studio offers private, editable phrasing grounded in that player’s own messages and never sends it. Negotiated house-rule compilation immediately preserves the original generated wording, citations, session, and edition as a proposal; unchanged acceptance, edited acceptance, or rejection records a reason, and accepted wording begins the revisioned rule history. GM-private faction clocks receive counterfactual proposals with explicit assumptions and advance only after acceptance. Optional spotlight reports count only text sent after each seat opts in; they never record voice or infer emotion, attention, engagement, or intent.

GMs create the campaign itself from the top-level **World** folio. A short premise can become a private, system-neutral opening draft with three setting truths, two factions in conflict, three dangerous locations, five NPCs with wants and leverage, four actionable hooks, and one opening crisis already in motion. Every field remains editable, a blank manual folio is always available, and nothing becomes campaign material until a GM explicitly establishes it. Saved foundations are durable typed content with stable entity identities and optimistic revisions—not chat output—and retain the generator edition that first proposed them. `OPENAI_INTELLIGENCE_MODEL` powers the optional draft; run `npm run eval:campaign-seed` for its bounded live fixture.

Run `npm run eval:canon` with a configured key to check the live extractor against promises, banter, corrections, transcript prompt injection, strict and permissive constitution policies, citation integrity, and GM-only visibility. Deterministic safety checks remain part of `npm test`; the live evaluation is separate because it calls the configured model.

GMs can publish accepted canon to the party, keep it private, or share it with named character seats. Audience changes are preserved in immutable revision history, targeted players see those passages in their own ledger, and GMs can inspect a deterministic character-knowledge lens showing readable canon and attended sessions. A targeted seat receives source citations only from sessions it attended; otherwise the passage is labeled GM-confirmed without exposing unwitnessed transcript evidence. Canon can still be revised, superseded, or retracted without erasing the audit trail. The GM-only continuity brief finds up to three cited loose threads from accepted canon and selected play. Each thread has an append-only open, dormant, or resolved lifecycle with a human reason entered inline. Feedback is recorded as useful, incorrect, secret leak, or not useful. Run `npm run eval:continuity` to exercise the live brief generator; `OPENAI_CONTINUITY_MODEL` defaults to the canon model and can be configured independently.

Campaign ownership and private lore access are separate roles. The owner manages invitations, rooms, seats, and GM assignments; GMs review canon suggestions and can read or change GM-only canon, continuity briefs, and contradiction reports. The campaign owner always retains GM access, while other seated players can be granted or revoked GM access from the campaign folio without transferring ownership.

A GM can prepare a cited recap draft for the selected session. The draft separates a campaign-safe summary from private GM notes and preserves the session range that produced it. GM edits append immutable draft revisions with optimistic conflict protection; publication makes the recap immutable. Players see nothing until a GM explicitly publishes the recap, and preparation never publishes automatically. `OPENAI_RECAP_MODEL` defaults to the canon model; run `npm run eval:recap` for its live privacy and citation fixture.

The GM-only contradiction watch compares accepted canon with the latest 100 transcript messages. It records only clear conflicts backed by both a canon entry and exact campaign transcript citations. Reports are read-only: they explain what conflicts but never choose a winner or change canon. Run `npm run eval:contradictions` to check direct conflicts, harmless elaboration, passage-of-time changes, and transcript prompt injection against the live model. `OPENAI_CONTRADICTION_MODEL` defaults to the canon model and can be configured independently.

`npm run test:e2e` starts isolated in-memory room and web servers, then verifies invitation, offline unread catch-up, paginated history, search, shared-note, and two-browser WebRTC voice flows with Playwright. Voice tests use synthetic Web Audio microphone streams and exercise real media tracks and peer negotiation without recording host audio.

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
