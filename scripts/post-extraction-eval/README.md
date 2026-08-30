# Post extraction eval

Step 0 of the "posts feed" experiment: check that a cheap model (Claude Haiku 4.5) reliably
extracts structured fields (sport, place, time, level, format, spots) from free-text
"looking for players" posts, before building any product surface.

## Run

```bash
cd scripts/post-extraction-eval
npm install
ANTHROPIC_API_KEY=sk-ant-... npm run eval
```

Outputs a console table plus `results.md` (review table) and `results.json` (full data,
token usage, cost, latency).

## Iterating

- Replace the synthetic examples in `posts.json` with real posts copied from the Facebook
  groups (keep the messy ones). Each entry is `{ "id": "...", "text": "..." }`.
- The schema and prompt live in `run-eval.mjs` (`ExtractionSchema`, `buildSystemPrompt`).
  Structured outputs guarantee the response matches the schema; iterate on `.describe()`
  hints and prompt rules when a field is extracted wrong.
- Compare models with `EVAL_MODEL=claude-sonnet-5 npm run eval`.
- `results.json` files from good runs are worth keeping as regression baselines when the
  prompt changes.
