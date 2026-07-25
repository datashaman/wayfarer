# AI evaluation and release gates

Live model checks are intentionally separate from deterministic tests. Run the canon, continuity, contradiction, recap, and feedback suites before changing a generator version. Record comparable results with:

```sh
npm run eval:record -- --suite canon --model gpt-5.6-luna --version openai:gpt-5.6-luna:canon-v2 --passed 8 --total 8
```

Use `--campaign ID` for table-specific results and `--notes TEXT` for fixture or prompt changes. Runs are append-only in `ai_evaluation_runs`.

Run and record every live generator suite in one command with:

```sh
npm run eval:all -- --campaign ID --notes "prompt or fixture change"
```

Omit `--campaign` for an operator-wide run. A failed suite is still recorded so regressions remain visible.

Post-session preparation is not eligible until one campaign has all of:

- at least 20 reviewed canon suggestions;
- at least 80% canon acceptance including edited acceptances;
- at least 10 rated continuity threads;
- at least 70% useful continuity ratings;
- zero reported secret leaks.

Eligibility only permits preparing drafts. It never permits automatic canon acceptance, audience changes, recap publication, or outbound messages. A secret-leak report immediately fails readiness.
