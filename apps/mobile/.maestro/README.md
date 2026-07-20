# Maestro E2E — tournaments

UI end-to-end flows for the leagues & tournaments feature, driven against a
real dev build talking to **staging** Supabase.

## Prerequisites

1. **Build + Metro with the E2E flag** (gates the non-deterministic auto-opener
   sheets — referral, weekly check-in, Série 1 announcement, pending match feedback —
   that otherwise hijack the screen; see `src/utils/e2e.ts`):

   ```sh
   # one-time native build onto a booted simulator
   npx expo run:ios --device "<sim-udid>"
   # then run Metro for the session WITH the flag (kills the auto-openers)
   EXPO_PUBLIC_E2E=1 npx expo start --dev-client --port 8081
   ```

2. **Signed in as the demo account** (`demo@rallia.ca`, OTP `000000`). The
   session persists across `launchApp`, so sign in once. Demo must be an
   **admin** on the target env to reach the organizer create action — and the
   admin row also exempts it from the 5/24h create rate limit:

   ```sql
   insert into public.admin (id, role, notes)
   values ('<demo-profile-id>', 'support', 'E2E')
   on conflict (id) do nothing;
   ```

## Flows

| File                             | Persona               | Covers                                                                                | Status                                                                                                                                                                                                                                  |
| -------------------------------- | --------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create-tournament.yaml`         | organizer             | create wizard → success                                                               | ✅ green, verified in DB                                                                                                                                                                                                                |
| `lifecycle-a-create-open.yaml`   | organizer             | create → open registration → self-register                                            | ✅ green                                                                                                                                                                                                                                |
| `lifecycle-b-close-bracket.yaml` | organizer             | close registration → generate bracket                                                 | ✅ green (after seeding a 2nd registrant)                                                                                                                                                                                               |
| `lifecycle-c-score-archive.yaml` | organizer             | record final score → completion → archive                                             | ✅ green                                                                                                                                                                                                                                |
| `doubles-register.yaml`          | organizer/participant | create doubles → open → add-myself → partner picker (search + pick) → pair registered | ✅ green, partnership verified in DB                                                                                                                                                                                                    |
| `edit-and-cancel.yaml`           | organizer             | create → edit (rename) → verify → cancel → cancelled notice                           | ✅ green                                                                                                                                                                                                                                |
| `participant-register.yaml`      | participant           | discover in list → register → withdraw                                                | ⚠️ register/withdraw CTAs proven; list-discovery entry (admin-gated quick-nav carousel) needs selector polish                                                                                                                           |
| `invite-redemption.yaml`         | participant           | deep link → private-tournament preview → register-via-token                           | ⚠️ deep-link entry blocked in the Expo dev client (custom `rallia://` schemes don't route via simctl/Maestro); works on a production/TestFlight build. Redemption logic is covered by `supabase/tests/tournament_invite_links_test.sql` |

### Selector caveats found while authoring

- **Overflow menu items** render as a single flattened accessibility node, so
  individual items aren't addressable by testID/text — tap by coordinate
  (fixed top-right card: ~`71%,16%` first item, `+6%` per item).
- **Partner picker rows toggle** selection — tap a row exactly once, by its
  `partner-row-<id>` testID (tapping the name text hits the inner node and
  doesn't fire the row's onPress).
- Buttons that wrap an icon + text expose accessibility text like `, Label`;
  match them with a substring regex `.*Label.*`, not the bare label.

The lifecycle is split into segments A/B/C because a **second registrant** must
be seeded server-side (via the real `tournament_register` RPC, acting as another
staging player) between A and B — only `demo@rallia.ca` can log in via
automation, so multi-user journeys are simulated server-side. See the seed
snippet in segment B's header.

## Run

```sh
cd apps/mobile
maestro test .maestro/flows/tournaments/create-tournament.yaml
# segments share live screen state — run A, seed, then B, then C in order
```

## Known limits (not Maestro-fixable on a dev build)

- **Deep-link entry** (`rallia://invite/...`) is intercepted by the Expo dev
  launcher. Test invite redemption against a preview/production build, or rely
  on the SQL suite for the redemption logic.
- **Two-device** journeys (live chat exchange, real push delivery, brand-new
  signup with a real OTP email) can't be automated with a single demo login;
  the "other user" is seeded server-side and push/chat are verified at the
  in-app screen + DB level.

## Selectors

UI elements carry `testID`s (the app otherwise exposes little accessible text).
Key ids: `tab-create-fab`, `action-create-tournament`, `tournament-name-input`,
`tournament-start-date`/`-end-date`/`-date-done`, `tournament-wizard-submit`,
`tournament-success-view`, `cta-open-registration`/`-close-registration`/
`-generate-bracket`/`-register`/`-add-myself`/`-withdraw`, `tournament-tab-*`,
`bracket-playable-match`, `score-input-p1-N`/`-p2-N`, `record-score-save`,
`tournament-overflow-menu`, `menu-*`, `invite-*`, `partner-*`,
`tournament-card-<id>`.

## Leagues (V6)

| File                                     | Persona   | Covers                                        |
| ---------------------------------------- | --------- | --------------------------------------------- |
| `leagues/lifecycle-a-create-season.yaml` | organizer | create → detail → create season → open season |

Key ids: `action-create-league`, `league-name-input`, `league-wizard-submit`,
`league-success-view`, `league-tab-seasons`, `cta-create-season` (opens the
create-season sheet), `season-name-input`, `cta-create-season-submit`,
`cta-open-season`.

DB RPC smoke (local): `npm run db:test:leagues` from repo root.
