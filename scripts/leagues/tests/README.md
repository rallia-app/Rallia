# League RPC test suites

Self-contained pgSQL assertion suites for the league/season RPCs. Each one seeds
its own fixtures from the local seed players, asserts, prints `PASS=n FAIL=n`,
raises if anything failed, and deletes what it created.

They exist because these paths handle money and the interesting failures are all
at the database layer (payment gates, optimistic locks, roster membership) — a
mobile-only feature has no browser surface to exercise them from.

## Run

Local Supabase must be up and seeded (`supabase/seed.sql` — note `[db.seed]` is
`enabled = false` in config.toml, so `db reset` does NOT load it; re-run it by
hand after a reset or the suites will fail on a missing organizer):

```sh
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f scripts/leagues/tests/paid-season.sql
```

| File                            | Covers                                                                                                                                       |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `league-update.sql`             | `league_update`: field/status matrix, optimistic lock, authz, audit payload                                                                  |
| `league-lifecycle.sql`          | `league_pause` / `league_resume` / `league_close`, and that `paused` actually blocks joins, `season_create`, `season_open`, `session_create` |
| `paid-season.sql`               | Paid enrolment end-to-end: fee/tax math, payout gate, ranking roster, the 15-min reaper, and the payment-bypass regression                   |
| `season-refunds-settlement.sql` | `season_request_refund` (full/partial/cutoff, double-refund), and both settlement candidate legs                                             |

## Gotcha when simulating the webhook

`lt-payment-webhook` marks the ledger `succeeded` **before** flipping
`season_members` to `enrolled`, and the payment gate keys off exactly that. Fake
the webhook in that order or the trigger will (correctly) raise
`PAYMENT_REQUIRED`.
