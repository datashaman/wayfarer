# AI evaluation and release gates

Live model checks are intentionally separate from deterministic tests. Every production AI surface is registered in `server/ai-surfaces.mjs` with a stable ID, authority boundary, version tag, and evaluation command. Run all eight live suites before changing a generator version:

- canon suggestions;
- continuity briefs;
- contradiction watch;
- session recaps;
- character knowledge;
- intent phrasing;
- house-rule compilation;
- faction-clock proposals.

Record an individual comparable result with:

```sh
npm run eval:record -- --suite canon --model gpt-5.6-luna --version openai:gpt-5.6-luna:canon-v2 --passed 8 --total 8
```

Use `--campaign ID` for table-specific results and `--notes TEXT` for fixture or prompt changes. Runs are append-only in `ai_evaluation_runs`.

Run and record every live generator suite in one command with:

```sh
npm run eval:all -- --campaign ID --notes "prompt or fixture change"
```

Omit `--campaign` for an operator-wide run. A failed suite is still recorded so regressions remain visible.

## Runtime traces

Production inference records are appended to `ai_inference_runs` after application-side validation finishes. Each campaign-private record contains only:

- the registered surface ID and exact generator version;
- success or failure and a coarse error category;
- elapsed milliseconds;
- provider-reported input and output unit counts, when available;
- the timestamp.

Prompts, transcript passages, canon, model output, citations, reasoning, player names, and error messages are never written to the trace table. Failure to record observability must not fail the campaign action. The GM-only AI evaluation ledger groups current-edition traces with the latest comparable live check; an observed success rate describes runtime health, not factual quality or authority.

Post-session preparation is not eligible until one campaign has all of:

- at least 20 reviewed canon suggestions;
- at least 80% canon acceptance including edited acceptances;
- at least 10 rated continuity threads;
- at least 70% useful continuity ratings;
- zero reported secret leaks.

Eligibility only permits preparing drafts. It never permits automatic canon acceptance, audience changes, recap publication, or outbound messages. A secret-leak report immediately fails readiness.
