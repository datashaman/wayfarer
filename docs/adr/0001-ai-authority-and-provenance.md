# ADR 0001: Human authority and cited AI artifacts

Status: accepted — 2026-07-25

## Context

Campaign memory mixes public events, private lore, corrections, jokes, speculation, and later changes to the world. An uncited summary or autonomous agent can quietly turn model error into table truth.

## Decision

AI operations are explicit preparations. Their outputs use strict schemas, remain non-stored at the provider, cite authorized campaign evidence, snapshot their campaign session where relevant, and enter a human review state. Only GMs decide canon, publish recaps, record house rules, or accept faction motion. Visibility is enforced for the campaign, all GMs, or named character seats. Administrative ownership is independent from knowledge access.

Scheduled post-session work is opt-in and readiness-gated. It may create private canon suggestions, continuity briefs, and recap drafts for a closed session, but it cannot publish or accept them. Perspective answers are validated against the requesting seat’s deterministic knowledge lens. Intent drafting uses only the requesting player’s own prior messages. Spotlight reporting begins at explicit consent and is limited to text message counts; it never processes voice or infers behavior.

Feedback and human edits are versioned evaluation context, never executable instructions. Numeric model confidence is retained only as internal ranking metadata and is not shown as calibrated probability.

Every production inference boundary has one registered surface ID and versioned adversarial suite. Campaign-private runtime traces are recorded only after application validation and contain operational metadata: surface, generator version, duration, provider usage, outcome, coarse error category, and time. They exclude prompts, campaign content, output, reasoning, identities, and error messages. Evaluation or runtime success never expands the surface's authority.

## Consequences

The product favors precision, provenance, and reversible review over invisible automation. Long sessions are chunked with overlap and deduplicated. Scheduled workflows may prepare drafts only and must pass the thresholds in `docs/ai-evaluation.md`; publication remains human regardless of measured quality. The additional consent and knowledge checks reduce convenience but prevent retrospective surveillance and audience widening.
