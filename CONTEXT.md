# Wayfarer product context

Wayfarer is a human-kept campaign memory system, not an autonomous storyteller. The transcript is evidence; accepted canon is a human ruling; AI output is always a cited proposal or draft.

## Product invariants

- AI never creates, revises, publishes, or retracts canon without an explicit GM action.
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
- **Canon constitution**: versioned table-specific policy for what counts as canon.
- **Canon proposal**: cited AI suggestion awaiting a GM ruling.
- **Canon entry**: human-accepted truth with revision and audience history.
- **Continuity thread**: cited GM-private loose end with an open/dormant/resolved lifecycle.
- **Knowledge lens**: deterministic view of canon readable by one character seat; it is not a model inference.
- **Session recap**: cited draft split into campaign-safe text and GM-private notes, published only by a GM.
- **Preparation run**: readiness-gated, campaign-scoped drafting of canon suggestions, continuity, and recaps for one closed session.
- **House rule**: revisioned table ruling that preserves the source rule, interpretation, final wording, and reason for change.
- **Faction clock proposal**: editable counterfactual motion with explicit assumptions; accepting it advances the human-kept clock.
- **Spotlight report**: message counts for seats that opted in before the counted activity; it is not an assessment of participation quality.
- **Intent draft**: private, editable phrasing grounded only in that player’s messages and readable canon; it is never sent automatically.
- **AI surface**: one registered production inference boundary with a stable ID, exact generator edition, authority class, live evaluation suite, and privacy-safe runtime evidence.
