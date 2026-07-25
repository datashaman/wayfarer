# Wayfarer's Table Interface System

## Direction and feel

Design for players who are already mid-session and need to speak, read, and respond without losing narrative focus. The interface should feel like a quiet digital game table: warm, grounded, slightly literary, and dense enough to keep the whole party in view.

Domain language: party table, campaign ledger, rooms, seats, character voices, session transcript, maps, shared notes, and turn-taking.

Color world: candle soot, worn parchment, walnut, brass, sealing wax, and muted moss. Color communicates action or state; it is not decoration.

State honesty: never fabricate connectivity, presence, speaking, delivery, unread, or encryption states. Presence and voice labels must come from live WebSocket or WebRTC state. Express unavailable or empty states through concise player-facing language and affordances. Keep implementation caveats in documentation and tests, never in product copy.

Signature: the voice roster is the table-presence rail. Player seats, speaking rings, mute state, join/leave controls, and connection status should all reinforce the sense of sitting around one shared table.

Avoid generic SaaS expressions:

- Use a campaign ledger instead of an application sidebar.
- Use readable session transcript blocks instead of chat bubbles.
- Use a persistent table-presence rail instead of a detached call toolbar.
- Use restrained, domain-specific language instead of dashboard terminology.

## Depth and surfaces

Use borders-only depth. Do not add drop shadows, gradients, or large surface jumps.

Dark surfaces use one warm soot hue with small lightness changes:

- `--soot-950`: deepest page background
- `--soot-925`: campaign chrome and side rails
- `--soot-900`: transcript canvas
- `--soot-875`: inset composer and selected local seat
- `--soot-850`: active controls and navigation
- `--soot-800`: hover and disabled control states

Use `--border-soft`, `--border`, and `--border-strong` according to boundary importance. Inputs are inset and slightly darker than their surroundings. Side rails remain in the same color family as the canvas and rely on borders for separation.

## Palette and semantics

- Primary text: `--parchment`
- Supporting text: `--parchment-soft`
- Metadata: `--parchment-dim`
- Disabled or placeholder text: `--parchment-muted`
- Primary action and active-room accent: `--wax` / `--wax-bright`
- Online, speaking, secure, and connected state: `--moss`
- Errors, destructive controls, and muted warnings: `--danger`
- Focus: `--focus`, always with a visible 2px ring

Player avatar colors may vary to establish identity, but should be mixed into soot surfaces rather than displayed at full saturation.

## Typography

- Interface controls, compact labels, status, and navigation: system sans-serif.
- Campaign names, room titles, character names, transcript text, and narrative markers: Georgia or a compatible readable serif.
- Metadata uses small sans-serif text with tabular numerals for timestamps.
- Uppercase labels require restrained tracking and should only identify structural sections or states.

The serif/sans contrast is functional: serif carries the fiction and transcript; sans-serif carries application mechanics.

## Spacing and shape

Use an 8px base spacing unit, with 4px allowed for micro-gaps and optical correction. Prefer 8, 12, 16, 24, and 32px spacing values.

- Small controls and navigation: 6px radius (`--radius-small`)
- Composer, panels, and substantial controls: 10px radius (`--radius-medium`)
- Avatars and status counters may be circular or pill-shaped because their meaning depends on that silhouette.
- Do not introduce large soft radii; the table should feel crafted and practical rather than playful.

## Reusable component patterns

### Campaign bar

Persistent top-level context containing the campaign identity, connection state, search, help, and mobile drawer controls. Keep it compact at 64px desktop and 58px mobile.

The invitation action belongs beside the campaign identity and opens a narrow invitation folio available to every seated player. Show the campaign name, join QR, campaign-scoped link, copy action, and native share action when supported. This is a player-facing handoff surface, not a setup panel; it must never include session or recovery credentials.

### Campaign entry

New tables begin with a campaign name and player name. Invitation links reduce entry to the player name only. Keep this as a focused, single-card gateway with inline errors and one primary action; never prefill fictional campaigns or players.

### Seat recovery

Accountless seats receive a one-time recovery key before entering the table. Present the key with copy and QR options, explain that it is private, and require explicit acknowledgement. Recovery links carry the invitation, player name, and key in the URL fragment; consume and clear that fragment immediately. Owners reset keys from the campaign folio with two-step confirmation, then receive the same one-time reveal.

### Campaign folio

Owner-only campaign administration opens as a right-side folio so play remains the dominant surface. Group invitation, room-ledger, and party-seat controls into bordered sections. Use inline edit and two-step destructive confirmation; avoid detached settings pages and modal alert dialogs. At 480px and below the folio fills the viewport and action groups stack.

### Campaign ledger

Left rail containing rooms, online party members, characters, and the local profile. Active rooms use a soot surface, subtle border, and wax hash icon. Unread state uses a compact wax counter.

### AI evaluation ledger

Treat AI quality as a human-kept campaign ruling trail, never as model-confidence analytics. Lead with verdict strips for outcomes the table has actually judged, then show release gates, generator editions, and campaign-scoped live checks in that order. Publication and preparation eligibility remain human decisions.

- Verdict strips pair one large tabular percentage with the judged sample count, a thin semantic outcome bar, and explicit category totals. Use an em dash when no judgment exists rather than implying a zero score.
- Release gates form the main scan path. Each row states the threshold and its current evidence; use moss checks only for passed gates and wax marks for evidence still being gathered.
- Generator editions are compact ledger rows with surface, exact version, success rate, sample size, and a restrained `Learning`, `Steady`, or `Watch` state. A version is evidence, not a product badge.
- Surface evidence is one continuous bordered ledger with a row for every production assistant. Each row joins authority class, current edition, latest adversarial proof, and privacy-safe runtime health. `Observed` uses moss, `Watch` uses danger, `Untried` uses wax, and `Unconfigured` remains muted; absent evidence must never inherit success color.
- Recorded checks show date, suite, model, generator version, pass count, and change from the prior comparable run. Empty states explain how to record campaign-scoped evidence.
- Secret leaks and material regressions are explicit alerts above the verdicts. Never expose this owner-private evaluation surface to ordinary campaign members.

Use the established borders-only depth, soot/parchment/wax/moss palette, serif narrative copy, sans structural labels, and 8px spacing system. Verdict strips may sit in two columns when space permits and must stack into a single uninterrupted reading order on narrow screens.

### Campaign intelligence folio

Personal and GM-assisted campaign tools share one right-side folio so the transcript remains dominant. The folio is a continuous ruling trail, not a tabbed AI dashboard: personal recollection, intent drafting, and consent lead; GM preparation, negotiated rules, faction clocks, and opted-in counts follow according to authority.

- Every generated passage is visibly a proposal, answer, or editable phrasing. Human decisions and their consequences carry stronger hierarchy than model state.
- Knowledge answers end in readable-canon citations. Intent drafts offer a direct `Use in composer` handoff but never send.
- Consent is a standalone bordered section with plain scope language. An enabled state uses moss; disabled consent must never be implied by silence.
- Preparation leads with its release-gate status and private-draft boundary before scheduling controls.
- Preparation runs are task trails: show canon, continuity, and recap independently with attempt count, error, and retry. Terminal work may raise one compact bordered notice with direct links to its ledger artifacts; never use celebratory toasts.
- Release gates must state the exact evidence remaining and link to the relevant ruling surface. A threshold without an acquisition path is incomplete.
- Knowledge answers place compact verdict controls after their citations. Selected verdicts use a restrained moss boundary, and exact generator editions remain visible as ledger metadata.
- House rules read as source → interpretation → ruling, with revision and retirement actions kept beside the record. A compiler begins with explicitly selected transcript passages, visually separates evidence from the editable proposal, and carries source chips into the recorded revision.
- Faction clocks use segmented wax tracks as their signature. Counterfactual proposals sit inset beneath the clock with cited assumptions, an exact before → after diff, and durable proposed/accepted/rejected state.
- Spotlight output is a quiet text-count ledger. Consent history and reports that included the current player are visible beside the control. Never use competitive charts, rankings, celebratory color, or language that implies participation quality.

At narrow widths the folio fills the viewport, two-column forms stack, and the document reading order remains unchanged. Keep borders-only depth, inset controls, serif narrative records, sans mechanics, and the 8px spacing system.

### Session transcript

Messages are avatar-and-copy rows, never speech bubbles. Sender, timestamp, delivery state, and literary body text form the hierarchy. System events sit between hairline rules. Keep transcript measure near 760px for readability.

### Composer

Inset bordered surface with narrative serif text. The send action is the only filled wax control in the transcript. Persist unfinished drafts and expose clear focus, empty, pending, and error states.

### Table presence

Right rail of voice seats. Speaking uses a moss ring and quiet tinted surface; muted state uses an explicit microphone icon. The local seat gets its own boundary. Always explain that voice is encrypted in transit.

### Avatars and presence

Initial-based circular avatars use individual muted colors mixed into soot. Online presence is a small moss dot. Speaking is a moss ring outside the avatar, not a color change inside it.

### Controls

Lucide icons clarify known actions and share one stroke style. Standalone icon buttons are 28–34px. Filled wax is reserved for the primary action. Every control needs default, hover, focus, disabled, and relevant active/error states.

### Responsive behavior

- Above 980px: campaign ledger, transcript, and table-presence rail are visible.
- Between 721px and 980px: keep the campaign ledger; move voice into a right drawer.
- At 720px and below: move both rails into drawers and keep a persistent voice dock below the composer.
- The transcript always remains the dominant surface.

## Motion and accessibility

Use fast 140ms color and border transitions. Speaking rings may pulse gently, but respect `prefers-reduced-motion`. Avoid spring or bounce motion.

All icon-only actions need accessible names. New messages use a polite live region. Dialog drawers are labelled and modal. Microphone use must always follow an explicit user action and permission request.
