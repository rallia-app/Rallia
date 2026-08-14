# Participation consent — conditions générales + décharge on paid entry

**Status:** proposal. Blocked on legal review of Jean's two documents (§7) and on
their EN translation. Everything else is buildable now.

## Why

Jean's ask (2026-08-14): on registration to a paid tournament or league, players
must confirm they have read and accepted two documents living in Drive
(`Rallia_Conditions_Generales.docx`, `Rallia_Decharge_Responsabilite.docx`).

The waiver is the reason this needs real UI. In a Quebec consumer contract an
"external clause" the consumer was never made aware of can be struck (art. 1435
CCQ), and a liability waiver buried behind a link is the canonical example. An
explicit acceptance act, recorded with version and timestamp, is what makes the
document part of the contract.

Known limit, so nobody oversells the checkbox: art. 1474 CCQ voids any exclusion
of liability for bodily or moral injury, ticked box or not. What acceptance buys
is proof of informed assumption of risk (contributory-fault posture), not
immunity. Jean's own text concedes this ("ne limite pas les responsabilités qui
ne peuvent être exclues").

## Decisions

- **One checkbox, not two.** Single tick covering both documents, each openable
  inline. Two ticks is marginally stronger evidence and measurably worse
  conversion on a payment flow; 1474 caps the waiver's upside anyway.
  Wording: « J'ai lu et j'accepte les [conditions générales] et la
  [décharge de responsabilité]. »
- **Paid entries only.** The gate keys on `entry_fee_cents > 0` (tournaments)
  and the paid-season path (leagues), matching Jean's ask. Free events change
  nothing, which also keeps every already-shipped client working. Extending to
  free events later is a one-line change in each RPC.
- **Consent is stamped on the entry row, not on `player_consent`.**
  `player_consent` is one row per (player, policy): right for app-wide CGU,
  wrong for events, where re-entry into a NEW event must re-accept the then-
  current version. The registration row is the natural record: it already
  carries who/what/when and survives as the audit trail. `policy_versions` /
  `accept_policy_consent()` are left untouched.
- **The version is a number, the documents live with the other legal pages.**
  New `policy_versions` rows are NOT used (see above); instead a tiny
  `lt_participation_terms` table holds the current version + per-locale URLs.
  Documents are hosted as web pages under `apps/web` (like the inlined privacy
  policy — NOT Enzuzo), FR first, EN required before ship. Mobile opens them in
  the in-app browser from the sheet.

## 1. Data model

```sql
CREATE TABLE lt_participation_terms (          -- one row per version
    version      integer PRIMARY KEY,
    url_fr       text NOT NULL,
    url_en       text NOT NULL,
    published_at timestamptz NOT NULL DEFAULT now()
);
-- current version = max(version). Seed v1 with the two page URLs.

ALTER TABLE tournament_registrations
    ADD COLUMN terms_version     integer,
    ADD COLUMN terms_accepted_at timestamptz;

ALTER TABLE season_members
    ADD COLUMN terms_version     integer,
    ADD COLUMN terms_accepted_at timestamptz;
```

Nullable on purpose: existing rows and free entries stay NULL. A paid entry
written after this ships always carries both. GRANT SELECT on
`lt_participation_terms` to authenticated (new-table GRANT rule).

## 2. RPC changes

`tournament_begin_paid_registration` and `season_begin_paid_enrollment` gain
`p_terms_version integer DEFAULT NULL`:

- `NULL` or ≠ `max(version)` from `lt_participation_terms` →
  `TERMS_ACCEPTANCE_REQUIRED` (P0001, before any slot/fee work).
- Match → stamp `terms_version` + `terms_accepted_at = now()` on the
  reservation row it already writes.

Trailing DEFAULT keeps the existing overload callable — same trap as the fee
overloads (see `project_league_paid_season_traps`): do NOT create a second
overload, alter the one function.

The paid invite-accept path needs nothing: `tournament_accept_invite` refuses
paid events (`PAYMENT_REQUIRED`) and routes through begin_paid, so the single
gate covers it. The free `tournament_register` path is untouched.

## 3. Edge function

`lt-create-registration-payment` body gains `termsVersion?: number`, passed
through to whichever RPC it calls. Map the new RPC error to
`terms_acceptance_required`. Stamp `termsVersion` into the PaymentIntent
metadata for a second, Stripe-side record.

## 4. Mobile UI

Paid registration sheet (the fee-quote step in `TournamentDetail` /
`components.tsx`, same spot for season enrollment):

- One `Checkbox` row (shared-components primitive; extend it if mobile lacks
  one — do not hand-roll) above the pay button; button disabled until ticked.
- Label is one sentence with two inline links; each opens the localized URL
  from `lt_participation_terms` in the in-app browser. Locale picks
  `url_fr`/`url_en`.
- `terms_acceptance_required` from the edge function maps to an inline error
  (belt-and-braces; the disabled button should make it unreachable).
- Free events: row absent entirely.

i18n: new keys in both `en-US.json` and `fr-CA.json`. FR is the source
language here; EN must not read as machine-translated.

## 5. Web

Two new pages under `apps/web` (`/participation-terms`, `/liability-waiver` —
top-level like `/privacy`, not under `/legal/`), FR + EN, content converted
from Jean's docs following the inlined-privacy pattern (markdown content file

- react-markdown page). Built 2026-08-14; EN is an in-house draft pending the
  same legal review as the FR. The web player app has no paid registration flow
  today, so no web checkbox — the pages exist to be linked from mobile and
  email.

## 6. Content fixes required before seeding v1

1. Both docs are paper forms ending in `Nom / Signature / Date` blanks. Digital
   version drops the signature block; the record is the stamped row.
2. Refund wording conflict: the T&C says refundable "avant la publication
   officielle du tableau"; the Série 2 config says until registration close
   (Aug 21, bracket publishes Aug 22). Align the doc to "la fermeture des
   inscriptions" — it is the earlier of the two and matches
   `refund_cutoff_at` everywhere.
3. Add "les frais de service ne sont pas remboursables" explicitly (matches
   `project_lt_paid_registration`).

## 7. Legal review checklist (before v1 publishes)

- 1474 CCQ carve-out wording — present, keep prominent.
- « Décisions finales, sans appel » and the blanket no-refund clause: both are
  abusive-clause bait under the LPC in a consumer contract; soften or accept
  the risk knowingly.
- Photo/video publication bullet doubles as a personal-information consent —
  check against the privacy policy rather than duplicating it.

## Rollout

1. Web pages live (FR+EN) → seed `lt_participation_terms` v1.
2. Migration (table + columns + RPC alters) — local → staging → prod via CI.
3. Edge function deploy.
4. Mobile sheet change ships in the next build; the RPC gate only fires for
   paid events, and no paid event opens before Stripe onboarding completes, so
   there is no window where an old client hits the gate — verify Série 2
   opening waits for the build containing the checkbox.

Order matters for 4: enabling the gate before the checkbox build is in review
would brick paid registration for current clients. If Série 2 must open first,
ship the migration with the gate OFF (RPC accepts NULL) and flip it in a
follow-up once the build is out.

## Out of scope

- Free-event consent (one-line follow-up if wanted).
- Organizer-side terms (Jean's docs are player-facing).
- Re-acceptance mid-event on version bump: an entry accepted at vN stays vN;
  new version only gates new entries.
