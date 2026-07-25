# ADR 0001: Human authority and cited AI artifacts

Status: accepted — 2026-07-25

## Context

Campaign memory mixes public events, private lore, corrections, jokes, speculation, and later changes to the world. An uncited summary or autonomous agent can quietly turn model error into table truth.

## Decision

AI operations are explicit, one-shot preparations. Their outputs use strict schemas, remain non-stored at the provider, cite exact campaign messages, snapshot their campaign session, and enter a human review state. Only GMs decide canon and publish recaps. Visibility is enforced for the campaign, all GMs, or named character seats. Administrative ownership is independent from knowledge access.

Feedback and human edits are versioned evaluation context, never executable instructions. Numeric model confidence is retained only as internal ranking metadata and is not shown as calibrated probability.

## Consequences

The product favors precision, provenance, and reversible review over invisible automation. Long sessions are chunked with overlap and deduplicated. Any future scheduled workflow may prepare drafts only and must pass the thresholds in `docs/ai-evaluation.md`; publication remains human regardless of measured quality.
