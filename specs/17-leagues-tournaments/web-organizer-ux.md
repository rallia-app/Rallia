# Web Organizer UX

> Web admin views for tournament and league organizers. Lives under `apps/web/app/[locale]/(org)/`.

The web surface is **organizer-only** and exists because mobile is poor for bulk roster management, bracket editing, and CSV exports. Players and spectators view leagues/tournaments on mobile; organizers run them on the web (mobile organizer dashboard exists but is functionally limited).

## Routes

```
/[locale]/(org)/leagues
  page.tsx                                — list of organizer's leagues
  new/page.tsx                            — create league
  [id]/page.tsx                           — league dashboard
  [id]/edit/page.tsx                      — edit league
  [id]/members/page.tsx                   — member roster
  [id]/seasons/page.tsx                   — season list
  [id]/seasons/[sid]/page.tsx             — season dashboard
  [id]/seasons/[sid]/sessions/page.tsx    — session list
  [id]/seasons/[sid]/sessions/[ssid]/page.tsx        — session dashboard
  [id]/audit/page.tsx                     — audit log

/[locale]/(org)/tournaments
  page.tsx                                — list
  new/page.tsx                            — create
  [id]/page.tsx                           — tournament dashboard
  [id]/edit/page.tsx                      — edit
  [id]/registrations/page.tsx             — registration manager
  [id]/bracket/page.tsx                   — full bracket editor
  [id]/audit/page.tsx                     — audit log
```

All routes are protected by `(org)` group middleware that requires authenticated organizer role. Non-organizers attempting these routes are redirected to the public mobile-style detail page.

## Tournament dashboard

Single-page dashboard with cards mirroring the mobile dashboard but expanded.

```
┌────────────────────────────────────────────────────────────────────────┐
│  Spring Open 2026                              [Edit] [Cancel] [Archive]│
│  Tennis · Singles · Best of 3 · 16 spots · Hard                          │
│  Status: In progress · 4 of 8 round-1 matches completed                  │
├────────────────────────────────────────────────────────────────────────┤
│  Quick stats                                                            │
│   12 registered · 0 waitlisted · 0 disputed · 0 awaiting validation     │
├────────────────────────────────────────────────────────────────────────┤
│  Sections                                                               │
│   ▸ Registration     [Open] [Close] [Invite] [Approve pending]          │
│   ▸ Bracket          [Generate] [Edit] [Lock] [Reset match]             │
│   ▸ Schedule         [Bulk schedule round] [Assign courts]              │
│   ▸ Communications   [Open chat] [Send announcement]                    │
│   ▸ Exports          [PDF bracket] [CSV roster]                         │
│   ▸ Audit log        [View all changes]                                 │
└────────────────────────────────────────────────────────────────────────┘
```

## Bracket editor

The web bracket editor is the primary differentiator from mobile. Features:

- **Drag-and-drop swap**: organizer drags a player chip from one match slot to another. The drop target highlights green/red based on legality.
- **Inline score editing**: click a match → score editor appears in a side panel. Save → triggers RPC.
- **Bulk schedule**: select round → "Schedule round 1" → modal with start time, court assignment, match duration → all matches scheduled in one batch.
- **Reset match**: right-click match → Reset (with confirmation about downstream impact).
- **Lock/unlock**: padlock icon on each match.

Layout:

```
┌──────────────────────────────────────────────────────────────────┐
│  Bracket — Spring Open 2026                                       │
│  [Save changes] [Discard] [Generate PDF]    [Lock bracket]         │
├──────────────────────────────────────────────────────────────────┤
│  R1                R2                R3                Final       │
│  ┌────────┐                                                        │
│  │A vs E  │──┐                                                     │
│  └────────┘  │   ┌────────┐                                        │
│  ┌────────┐  │   │A vs C  │──┐                                     │
│  │BYE/E   │  ├──>│        │  │   ┌────────┐                        │
│  └────────┘  │   └────────┘  │   │ ?      │──┐                     │
│              │                │   └────────┘  │                     │
│   …          │                │               │  ┌────────┐         │
│              │                │               ├─>│ ?      │         │
└──────────────────────────────────────────────────────────────────┘
```

The bracket renders as React-flow-style nodes connected by SVG. Realtime updates apply node-by-node.

## Registration manager

Table view with bulk actions:

| Selectable | Player     | Rating | Reputation | Status     | Seed | Actions                 |
| :--------: | ---------- | ------ | ---------- | ---------- | ---- | ----------------------- |
|     ☐      | A. Smith ✓ | 4.5    | 92%        | Registered | 1    | [Disqualify] [Set seed] |
|     ☐      | B. Jones   | 4.0    | 75%        | Pending    | —    | [Approve] [Reject]      |
|     ☐      | C. Lee     | 3.5    | —          | Waitlist 1 | —    | [Promote] [Remove]      |

Bulk: Approve all pending, Disqualify selected, Move selected to waitlist.

## League dashboard

Tabs for Members, Seasons, Sessions, Settings. Each tab is a virtualized table with inline edit/action support.

### Members tab

| Member   | Role         | Status    | Joined     | Last active | Actions            |
| -------- | ------------ | --------- | ---------- | ----------- | ------------------ |
| A. Smith | Organizer    | Active    | 2025-09-12 | yesterday   | (you)              |
| B. Jones | Co-organizer | Active    | 2025-10-03 | today       | [Demote] [Suspend] |
| C. Lee   | Member       | Pending   | 2026-04-25 | —           | [Approve] [Reject] |
| D. Park  | Member       | Active    | 2025-09-12 | 3 days ago  | [Suspend] [Kick]   |
| E. Brown | Member       | Suspended | 2025-09-12 | 2 weeks ago | [Lift suspension]  |

### Seasons tab

Cards for each season with status pill, dates, ranking link, "Open" / "Close" CTA.

### Sessions tab

Calendar-style grid with sessions plotted; click to enter session dashboard.

### Settings tab

Edit league metadata, default rules editor (JSON-shaped form, not raw JSON), pause/close league.

## Session dashboard

```
Session #4 — Apr 15, 18:00–19:30 · Club Mont-Royal     [Edit] [Cancel]

┌─ Confirmations ────────────────────────────────────────────────┐
│ Confirmed: 8        Pending: 3        Declined: 2        Waitlist: 1 │
│ [Send reminder to pending]                                       │
└──────────────────────────────────────────────────────────────────┘

┌─ Match Sheet ──────────────────────────────────────────────────┐
│ Pairing mode: BY_RANK                  [Generate] [Regenerate] │
│                                                                 │
│ Round 1 — Court 1: A vs B  [✓ Validated]   6-4, 4-6, 7-6(5)    │
│ Round 1 — Court 2: C vs D  [Pending]                            │
│ Round 2 — Court 1: A vs C  [Pending]                            │
│                                                                 │
│ [Drag handle to reorder]   [Lock] [Swap] [Override score]      │
└──────────────────────────────────────────────────────────────────┘

┌─ Communications ───────────────────────────────────────────────┐
│ [Open chat]   [Send announcement]                                │
└──────────────────────────────────────────────────────────────────┘
```

Match override opens a side panel with the same score-entry shape as mobile, but full-keyboard.

## Exports

Per co-founder brief ("Classement filtrable, triable, exportable (.CSV/.XLSX/.PDF)"):

| Export                   | Source               | Trigger                                  | Output                                  |
| ------------------------ | -------------------- | ---------------------------------------- | --------------------------------------- |
| Bracket PDF              | Tournament           | "Generate PDF" button                    | Signed-URL Supabase Storage download    |
| Roster CSV / XLSX        | Tournament or league | "Download roster" → format picker        | Name, email (if opt-in), seed, rating   |
| Ranking CSV / XLSX / PDF | Season               | "Download standings" → format picker     | Rank, points, W/L, +/-, % participation |
| Session sheet PDF        | Session              | "Download match sheet"                   | One-page sheet ready to print           |
| Audit log CSV            | Tournament or league | "Export audit log"                       | Time-ordered actions, organizer-only    |
| iCal feed                | League               | Per-organizer feed URL (token-protected) | Live-updating .ics                      |

XLSX support uses [`exceljs`](https://www.npmjs.com/package/exceljs) server-side; PDFs use the existing `@react-pdf/renderer` pipeline already in the web codebase for invoices.

The roster CSV respects player-level email-share preferences (some players opt out of sharing email with organizers — system 03 settings).

## shadcn components

Web uses [shadcn/ui](https://ui.shadcn.com/). New components:

- `BracketEditor` (custom, built on `@xyflow/react`).
- `RegistrationTable` (built on shadcn `Table` + `DataTable`).
- `MemberRosterTable`.
- `SessionCalendar` (custom, built on `react-day-picker`).
- `RankingTable` (sortable, paginated).
- `RuleSetEditor` (form built on shadcn `Form` with structured fields).

All components use `next-intl` for translations (server: `getTranslations`, client: `useTranslations` per [memory note](../../README.md)).

## Auth & middleware

- Routes under `(org)` require an authenticated user with organizer/co-organizer role for the requested entity.
- Middleware reads `Authorization` header and resolves the role via the same helper functions as RLS (`is_tournament_organizer`, `is_league_organizer`).
- Non-org users attempting `(org)` routes are redirected to `/[locale]/tournaments/[id]` (public detail).

## Realtime

Web uses Supabase Realtime through the same channels as mobile (`tournament:{id}`, `tournament:{id}:bracket`, `session:{id}`, `league:{id}:season:{sid}:ranking`). Optimistic mutations + realtime invalidation are managed by `@tanstack/react-query`.

## Performance & responsiveness

- All tables virtualized via `@tanstack/react-virtual`.
- Bracket editor: degraded view for screens < 1024 px wide (vertical scroll instead of nested rounds).
- Mobile-web equivalence: every web page is at minimum **viewable** on mobile-Safari, but bracket-edit and bulk-actions are gated behind a "Open in mobile organizer" CTA on small screens.

## Accessibility

- All interactive elements keyboard-reachable.
- Bracket nodes have `aria-label` describing match state.
- Drag-and-drop has keyboard alternatives ("Move this player" → modal with destination match picker).
- Forms use shadcn `Form` with proper `aria-describedby` for errors.

## Performance budgets (web)

| View                                   | Target LCP |
| -------------------------------------- | ---------- |
| Tournament dashboard                   | < 1.5 s    |
| Bracket editor (N=32)                  | < 2.5 s    |
| League dashboard                       | < 1.5 s    |
| Session dashboard                      | < 1.5 s    |
| Bulk action (e.g., approve 50 members) | < 3 s      |
