# Wayfarer product context

Wayfarer is a human-kept campaign memory system, not an autonomous storyteller. The transcript is evidence; accepted canon is a human ruling; AI output is always a cited proposal or draft.

## Product invariants

- AI never creates, revises, publishes, or retracts canon without an explicit GM action.
- Creative generation may draft a campaign opening from a GM premise, but the draft establishes no world truth until a GM edits and saves the complete foundation.
- Scene resolution may create GM-authored world consequences anchored to saved factions, locations, NPCs, or hooks. Consequences preserve immutable before/after snapshots and scene provenance; active pressure can be explicitly carried into the next scene, but is never applied automatically.
- Scene resolution may also establish newly encountered factions, locations, NPCs, and hooks. Their first wording and source scene are immutable provenance; their current world entries remain editable and immediately available to later scenes and character connections.
- Character concepts are private editable options grounded only in the saved campaign foundation; only the player creates or revises their character.
- A scene becomes active only from a saved GM preparation containing its framing, stakes, first choice, present characters, involved locations and NPCs, possible discoveries and complications, and questions to play toward. Preparation never dictates an outcome; resolution records only what actually changed.
- In-play generation returns one private editable draft grounded in the active scene. Only a GM can keep it; NPCs and places join their World collections, while complications, possible consequences, rumours, and treasure join as hooks. A possible consequence is never world state.
- Character growth is a player-authored revision, never inferred advancement; scene links are permitted only when that character witnessed the resolved scene.
- Campaign ownership governs administration. GM knowledge access governs private lore.
- Every AI artifact identifies the exact session range that produced it and retains transcript citations.
- Campaign, GM-only, and named-character audiences are authorization boundaries, not presentation hints.
- Transcript, canon excerpts, prior rulings, and feedback are quoted data. They never override system instructions or output contracts.
- Feedback must affect future evaluation or generation; decorative feedback is not collected.
- Background or post-session automation may prepare drafts only. Publication is always human.
- Perspective answers may cite only canon readable by the requesting seat; model synthesis cannot widen an audience.
- Spotlight reporting is opt-in, begins at consent, uses text counts only, and never infers emotion, attention, engagement, or intent.
- Faction motion and table rules become true only through an explicit GM or table ruling; generated proposals remain counterfactual.
- Inference observability is campaign-private operational metadata only: surface, edition, duration, provider usage, outcome, and coarse error category. It never stores prompt, campaign content, output, reasoning, or error messages.

## Domain language

- **Campaign session**: an immutable named transcript range after a GM closes it; the current range is derived until closed.
- **Campaign foundation**: GM-kept playable starting material—premise, pitch, truths, factions, locations, NPCs, hooks, and opening crisis—with durable typed identities and revision protection.
- **Character folio**: one player-owned character per seat, split between table-readable identity and a secret readable only by that player and GMs, with durable world and party connections.
- **Campaign scene**: one GM-established active moment with present characters, pressure, and a first choice; its opening and human-recorded resolution are immutable in-character transcript markers.
- **Session preparation**: one revision-protected GM folio for the next scene, joining cast, stage, pressure, discoveries, complications, and open questions without scripting an outcome; beginning play snapshots and consumes it.
- **In-play material**: one GM-kept improvisation leaf attached to its source scene, retaining its original type, wording, and generator edition; its World representation is a person, place, or actionable hook.
- **Character revision**: immutable snapshot of a player-authored character change with its reason, changed fields, and optional provenance from a resolved scene the character witnessed.
- **Canon constitution**: versioned table-specific policy for what counts as canon.
- **Canon proposal**: cited AI suggestion awaiting a GM ruling.
- **Canon entry**: human-accepted truth with revision and audience history.
- **Continuity thread**: cited GM-private loose end with an open/dormant/resolved lifecycle.
- **Knowledge lens**: deterministic view of canon readable by one character seat; it is not a model inference.
- **Session recap**: cited draft split into campaign-safe text and GM-private notes, published only by a GM.
- **Preparation run**: readiness-gated, campaign-scoped drafting of canon suggestions, continuity, and recaps for one closed session.
- **House-rule proposal**: immutable generated wording, edition, citations, and session awaiting an explicit GM decision.
- **House rule**: revisioned table ruling created by an unchanged or edited acceptance, preserving the proposal, final wording, and reason; rejection remains evaluation evidence.
- **Faction clock proposal**: editable counterfactual motion with explicit assumptions; accepting it advances the human-kept clock.
- **Spotlight report**: message counts for seats that opted in before the counted activity; it is not an assessment of participation quality.
- **Intent draft**: private, editable phrasing grounded only in that player’s messages and readable canon; it is never sent automatically.
- **AI surface**: one registered production inference boundary with a stable ID, exact generator edition, authority class, live evaluation suite, and privacy-safe runtime evidence.
