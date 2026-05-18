# Interac e-Transfer Payment Integration Plan

> **Status:** Production-ready spec, supersedes the previous Stripe Connect-based reimbursement system.
> **Owner:** Mathis · **Last revised:** 2026-05-04

---

## 1. Overview

After a match ends successfully (not cancelled), Rallia automatically lets each non-host participant reimburse the host who fronted the court cost. Players can complete payment without leaving the app via Interac e-Transfer. Existing Stripe Connect rails are decommissioned in this rollout — see §11.

**Key reasons for moving off Stripe:**

- Stripe Connect Express requires KYC onboarding for every host (friction).
- Stripe takes 2.9% + 30¢ per transaction; Interac e-Transfer is flat-fee (or free).
- Interac is the dominant Canadian P2P rail; Rallia is Canada-only at launch.
- Interac request-money flows do not require Rallia to be a money services business (we never custody funds).

**Capabilities being lost** (and how we compensate — see §10):

- KYC-grade host identity → replaced by verified email + phone + min account age.
- Chargebacks / dispute window → replaced by manual mediation policy + per-host caps.
- Platform fee mechanism → out of scope at launch; documented but not implemented.

---

## 2. User flow

### Match lifecycle

1. **Host** creates a match, books a court, fronts the cost (e.g. $60).
2. **Players** join until the match is full (or play with fewer players).
3. **Match happens.** No cancellation reported.
4. **Post-match trigger** fires (host taps "Request reimbursements" in v1; cron in v2 — see §6.4).
5. **Payment requests** are created for each non-host joined participant.
6. **Players pay** via Interac e-Transfer (in-app WebView Phase 2, email/SMS Phase 1 fallback).
7. **Host** sees payment status in real time.

### Split example

```
Court cost: $60 · 4 joined players (1 host + 3 others)

Host                  → $0
Player B              → $20.00
Player C              → $20.00
Player D              → $20.00
```

For non-divisible amounts, see §6.3 (rounding policy).

---

## 3. Provider strategy: two phases

### Phase 1 — Launch (Dwello)

|                 | Details                                                                  |
| --------------- | ------------------------------------------------------------------------ |
| Provider        | [Dwello Payments](https://payments.dwello.com/)                          |
| Flow            | Email/SMS — player receives Interac request, pays from their banking app |
| Per-transaction | $0.00 (next-day deposit) or $0.70 (instant auto e-transfer)              |
| Limit           | $10,000 per request                                                      |
| Webhooks        | Yes (Pro/Enterprise)                                                     |
| Tradeoff        | User leaves the app to pay → lower completion rate                       |

### Phase 2 — Growth (VoPay)

|                 | Details                                                                                   |
| --------------- | ----------------------------------------------------------------------------------------- |
| Provider        | [VoPay Interac Request Money](https://vopay.com/payment-methods/etransfer/request-money/) |
| Flow            | Embedded WebView — player pays inside the Rallia app                                      |
| Monthly         | $500+                                                                                     |
| Per-transaction | $1.50+                                                                                    |
| Limit           | $25,000 per request                                                                       |
| Webhooks        | Yes, per-event URLs                                                                       |
| White-label     | Yes (iFrame branding)                                                                     |

**Switch criterion:** Move to VoPay when paid-completion rate dips below 70% on Dwello, or when monthly volume × completion uplift > $500/month.

The provider abstraction (§5) keeps both behind a single interface so swapping is a config change.

---

## 4. Database schema

### Strategy: extend `match_participant`, do not introduce a new table

The existing `match_participant.has_paid` + `match_participant.payment_intent_id` are provider-agnostic. We rename the latter, add a few columns, and add a webhook event ledger. No `game_payments` table is introduced.

### Migration: `20260504000000_replace_stripe_with_interac.sql`

```sql
-- ============================================================
-- 1. Rename Stripe-specific column → provider-agnostic
-- ============================================================
ALTER TABLE match_participant
  RENAME COLUMN payment_intent_id TO payment_reference;

COMMENT ON COLUMN match_participant.payment_reference IS
  'External payment reference: Stripe PI id (legacy rows) or Interac transaction id (new rows). Reconciled via webhook.';

-- ============================================================
-- 2. Add Interac-specific fields
-- ============================================================
CREATE TYPE payment_status_enum AS ENUM (
  'none',        -- no request issued
  'requested',   -- request sent to provider, awaiting payer action
  'paid',        -- provider confirmed payment
  'failed',      -- payer attempted and failed
  'expired',     -- request expired before payment
  'cancelled',   -- host cancelled the request
  'manual'       -- host marked-as-paid out-of-band (cash, Venmo, etc.)
);

CREATE TYPE payment_provider_enum AS ENUM (
  'stripe',  -- legacy
  'dwello',
  'vopay',
  'manual'
);

ALTER TABLE match_participant
  ADD COLUMN payment_status     payment_status_enum   NOT NULL DEFAULT 'none',
  ADD COLUMN payment_provider   payment_provider_enum,
  ADD COLUMN payment_url        TEXT,
  ADD COLUMN amount_owed_cents  INTEGER,
  ADD COLUMN payment_currency   TEXT NOT NULL DEFAULT 'CAD',
  ADD COLUMN payment_requested_at  TIMESTAMPTZ,
  ADD COLUMN payment_paid_at       TIMESTAMPTZ,
  ADD COLUMN payment_expires_at    TIMESTAMPTZ,
  ADD COLUMN payment_failure_reason TEXT,
  ADD COLUMN payment_attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN payment_last_reminder_at TIMESTAMPTZ,
  ADD COLUMN marked_paid_by      UUID REFERENCES profile(id),
  ADD COLUMN marked_paid_at      TIMESTAMPTZ,

  ADD CONSTRAINT mp_amount_owed_positive CHECK (amount_owed_cents IS NULL OR amount_owed_cents > 0),
  ADD CONSTRAINT mp_currency_supported   CHECK (payment_currency = 'CAD'),
  ADD CONSTRAINT mp_paid_consistency     CHECK (
    (payment_status = 'paid') = (payment_paid_at IS NOT NULL)
  ),
  ADD CONSTRAINT mp_manual_consistency   CHECK (
    (payment_status = 'manual') = (marked_paid_by IS NOT NULL)
  );

-- Backfill: any legacy Stripe row that was paid stays paid; everything else → 'none'
UPDATE match_participant
   SET payment_status   = CASE WHEN has_paid THEN 'paid' ELSE 'none' END,
       payment_provider = CASE WHEN payment_reference IS NOT NULL THEN 'stripe'::payment_provider_enum ELSE NULL END,
       payment_paid_at  = CASE WHEN has_paid THEN updated_at ELSE NULL END;

CREATE INDEX idx_mp_payment_status ON match_participant(payment_status)
  WHERE payment_status IN ('requested', 'failed');
CREATE INDEX idx_mp_payment_expires ON match_participant(payment_expires_at)
  WHERE payment_status = 'requested';

-- ============================================================
-- 3. Webhook event ledger (idempotency + audit)
-- ============================================================
CREATE TABLE payment_webhook_event (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider      payment_provider_enum NOT NULL,
  external_event_id TEXT     NOT NULL,
  event_type    TEXT        NOT NULL,
  payload       JSONB       NOT NULL,
  signature_ok  BOOLEAN     NOT NULL,
  participant_id UUID       REFERENCES match_participant(id),
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at  TIMESTAMPTZ,
  processing_error TEXT,
  UNIQUE (provider, external_event_id)
);

CREATE INDEX idx_pwe_unprocessed ON payment_webhook_event(received_at)
  WHERE processed_at IS NULL;

-- ============================================================
-- 4. Decommission Stripe Connect host accounts
-- ============================================================
-- Done in a *follow-up* migration after manual deauthorization run; see §11.
-- DROP TABLE player_stripe_account; -- only after audit confirms zero in-flight rows
```

### Migration: `20260504000001_payment_notification_enum_values.sql`

**Must be a separate migration** — Postgres does not allow `ALTER TYPE ADD VALUE` to be used inside the same transaction that consumes the new value.

```sql
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'payment_requested';
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'payment_reminder_3d';
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'payment_received';
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'payment_all_received';
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'payment_failed';
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'payment_expired';
```

### Type regeneration (post-migration step)

Both `payment_intent_id → payment_reference` rename and the new enum values change the generated TypeScript types. Run after the migrations apply:

```bash
npx supabase gen types typescript --local > packages/shared-types/src/supabase.ts
# If apps/web/types/index.ts is also generated, regenerate accordingly.
npx tsc -b   # verify all references compile after the rename
```

**Known references that will need a manual update before TS compiles:**

- `packages/shared-services/src/matches/matchService.ts` — uses `match_participant.payment_intent_id`
- `supabase/functions/match-reimbursement-create/index.ts` — being deleted in §11.3 anyway, but pin the deletion to _after_ the rename to avoid an interim broken state

### RLS

```sql
-- Read: payer or host can see the row
CREATE POLICY "mp_payment_read"
  ON match_participant FOR SELECT TO authenticated
  USING (
    player_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM match m
       WHERE m.id = match_participant.match_id
         AND m.created_by = auth.uid()
    )
  );

-- Writes go through service role only (Edge Functions). No INSERT/UPDATE policy
-- for authenticated role on payment columns.

-- Webhook event ledger: service role only.
ALTER TABLE payment_webhook_event ENABLE ROW LEVEL SECURITY;
-- (no policies — only service role can read/write)
```

---

## 5. Provider abstraction

```ts
// supabase/functions/_shared/interac/types.ts

export type NormalizedEvent =
  | { kind: 'payment_completed'; transactionId: string; amountCents: number }
  | { kind: 'payment_failed'; transactionId: string; reason: string }
  | { kind: 'payment_expired'; transactionId: string }
  | { kind: 'unknown'; raw: unknown };

export interface InteracProvider {
  readonly name: 'dwello' | 'vopay';

  createMoneyRequest(params: {
    amountCents: number;
    payerEmail?: string;
    payerPhone?: string; // required if no email (Dwello only)
    payerFirstName: string;
    payerLastName: string;
    message: string; // limited to 40 chars by Interac
    idempotencyKey: string; // (matchId, payerId) tuple
    expiresInDays?: number; // default 14
  }): Promise<{
    transactionId: string;
    paymentUrl?: string; // VoPay only
    expiresAt: string; // ISO
  }>;

  cancelMoneyRequest(transactionId: string): Promise<void>;

  getTransactionStatus(transactionId: string): Promise<NormalizedEvent['kind']>;

  verifyWebhook(rawBody: string, signature: string, secret: string): boolean;

  parseWebhookEvent(rawBody: string): NormalizedEvent;
}
```

```ts
// supabase/functions/_shared/interac/index.ts
import { DwelloProvider } from './dwello.ts';
import { VoPayProvider } from './vopay.ts';

const PROVIDER = Deno.env.get('INTERAC_PROVIDER') ?? 'dwello';

export const interac: InteracProvider =
  PROVIDER === 'vopay' ? new VoPayProvider() : new DwelloProvider();
```

Each provider implementation MUST:

- Verify webhooks via HMAC-SHA256 against the provider secret (constant-time compare).
- Translate provider-specific payloads into `NormalizedEvent`.
- Use `idempotencyKey` on the create call (Dwello supports `Idempotency-Key` header; VoPay supports `clientReferenceId`).
- Surface provider errors as typed exceptions: `InteracError('rejected_by_provider', detail)`.

---

## 6. Backend (Supabase Edge Functions)

We keep all payment logic in `supabase/functions/*` to mirror the existing notification pipeline and avoid splitting webhook secrets across Vercel + Supabase.

### 6.1 `match-payment-request-create`

Replaces the deleted `match-reimbursement-create`.

```ts
// POST /functions/v1/match-payment-request-create
// Auth: caller must be the match host
// Body: { matchId: string }
// Returns: { issued: number; failed: Array<{ playerId, reason }> }

import { createClient } from '@supabase/supabase-js';
import { interac } from '../_shared/interac/index.ts';

Deno.serve(async req => {
  // ... CORS, auth boilerplate (same pattern as existing edge functions)
  const userId = await requireAuthenticatedUser(req);
  const { matchId } = await req.json();

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // ---- Load + validate match ----
  const { data: match } = await admin
    .from('match')
    .select(
      `
    id, created_by, estimated_cost, cost_split_type, is_court_free, cancelled_at, end_time
  `
    )
    .eq('id', matchId)
    .single();

  if (!match) return err('match_not_found', 404);
  if (match.created_by !== userId) return err('not_host', 403);
  if (match.cancelled_at) return err('match_cancelled');
  if (match.is_court_free) return err('court_is_free');
  if (match.cost_split_type !== 'split_equal') return err('split_type_unsupported');
  if (!match.estimated_cost || match.estimated_cost <= 0) return err('no_cost');
  if (new Date(match.end_time) > new Date()) return err('match_not_ended');

  // ---- Compute splits with deterministic rounding ----
  const { data: participants } = await admin
    .from('match_participant')
    .select(
      'id, player_id, is_host, status, profile:profile(first_name, last_name, email, phone, phone_verified)'
    )
    .eq('match_id', matchId)
    .eq('status', 'joined');

  const payers = participants.filter(p => !p.is_host);
  const splits = computeSplit(match.estimated_cost, payers.length); // see §6.3

  // ---- Issue requests (idempotent per payer) ----
  const issued: string[] = [];
  const failed: Array<{ playerId: string; reason: string }> = [];

  for (const [i, payer] of payers.entries()) {
    const amountCents = splits[i];

    // Skip if a non-final request already exists
    const { data: existing } = await admin
      .from('match_participant')
      .select('payment_status')
      .eq('id', payer.id)
      .single();
    if (existing && ['requested', 'paid', 'manual'].includes(existing.payment_status)) {
      continue;
    }

    const contact = pickContact(payer.profile);
    if (!contact) {
      failed.push({ playerId: payer.player_id, reason: 'no_contact_method' });
      continue;
    }

    try {
      const result = await interac.createMoneyRequest({
        amountCents,
        payerEmail: contact.email,
        payerPhone: contact.phone,
        payerFirstName: payer.profile.first_name,
        payerLastName: payer.profile.last_name,
        message: shortMessage(match), // ≤ 40 chars, sanitized
        idempotencyKey: `match:${matchId}:player:${payer.player_id}`,
        expiresInDays: 14,
      });

      await admin
        .from('match_participant')
        .update({
          payment_status: 'requested',
          payment_provider: interac.name,
          payment_reference: result.transactionId,
          payment_url: result.paymentUrl ?? null,
          amount_owed_cents: amountCents,
          payment_requested_at: new Date().toISOString(),
          payment_expires_at: result.expiresAt,
          payment_attempt_count: 1,
        })
        .eq('id', payer.id);

      // Enqueue payer notification via the v2 notification system.
      // Edge Functions can't import @rallia/shared-services (Deno), so we call
      // the same `insert_notification` RPC that createNotification() uses.
      await admin.rpc('insert_notification', {
        p_user_id: payer.player_id,
        p_type: 'payment_requested',
        p_target_id: matchId,
        p_title: null, // resolved from notifications.messages.payment_requested.title
        p_body: null, // resolved from notifications.messages.payment_requested.body
        p_payload: { matchId, amountCents, payerId: payer.player_id },
        p_priority: 'high',
        p_scheduled_at: null,
        p_expires_at: null,
        p_organization_id: null,
      });

      issued.push(payer.player_id);
    } catch (e) {
      failed.push({ playerId: payer.player_id, reason: errorCode(e) });
    }
  }

  return json({ issued: issued.length, failed });
});
```

### 6.2 `interac-webhook`

Replaces `stripe-match-webhook`.

```ts
// POST /functions/v1/interac-webhook
// Provider-specific URL: configure /interac-webhook?provider=dwello in Dwello dashboard

Deno.serve(async req => {
  const url = new URL(req.url);
  const providerName = url.searchParams.get('provider') ?? 'dwello';

  const rawBody = await req.text();
  const signature = req.headers.get(SIG_HEADER[providerName]) ?? '';
  const secret = Deno.env.get(`INTERAC_WEBHOOK_SECRET_${providerName.toUpperCase()}`)!;

  if (!interac.verifyWebhook(rawBody, signature, secret)) {
    // Persist as signature_ok=false for forensics, then 400.
    await persistEvent(providerName, rawBody, false, null);
    return new Response('invalid signature', { status: 400 });
  }

  const event = interac.parseWebhookEvent(rawBody);
  if (event.kind === 'unknown') {
    await persistEvent(providerName, rawBody, true, null);
    return new Response('ok', { status: 200 }); // ack but don't act
  }

  // Idempotency: insert into ledger; ON CONFLICT skip
  const externalId = extractEventId(rawBody);
  const { data: row, error } = await admin
    .from('payment_webhook_event')
    .insert({
      provider: providerName,
      external_event_id: externalId,
      event_type: event.kind,
      payload: JSON.parse(rawBody),
      signature_ok: true,
    })
    .select('id')
    .single();

  if (error?.code === '23505') {
    // Duplicate — already processed
    return new Response(JSON.stringify({ received: true, duplicate: true }), { status: 200 });
  }

  // Find the participant; transition state only if currently 'requested'
  const { data: mp } = await admin
    .from('match_participant')
    .select('id, player_id, match_id, amount_owed_cents')
    .eq('payment_reference', event.transactionId)
    .eq('payment_status', 'requested') // <-- guard
    .maybeSingle();

  if (!mp) {
    await admin
      .from('payment_webhook_event')
      .update({
        processed_at: new Date().toISOString(),
        processing_error: 'no matching requested participant',
      })
      .eq('id', row.id);
    return new Response('ok', { status: 200 });
  }

  if (event.kind === 'payment_completed') {
    await admin
      .from('match_participant')
      .update({
        payment_status: 'paid',
        has_paid: true,
        payment_paid_at: new Date().toISOString(),
      })
      .eq('id', mp.id);

    // Side effects via the v2 notification system (insert_notification RPC).
    // The notification table has its own delivery worker; we don't block here.
    const { data: match } = await admin
      .from('match')
      .select('created_by')
      .eq('id', mp.match_id)
      .single();
    await admin.rpc('insert_notification', {
      p_user_id: match.created_by,
      p_type: 'payment_received',
      p_target_id: mp.match_id,
      p_payload: { matchId: mp.match_id, payerId: mp.player_id, amountCents: mp.amount_owed_cents },
      p_priority: 'normal',
      p_title: null,
      p_body: null,
      p_scheduled_at: null,
      p_expires_at: null,
      p_organization_id: null,
    });

    // If this was the last unpaid request for the match, send "all received"
    const { count: stillOwed } = await admin
      .from('match_participant')
      .select('id', { count: 'exact', head: true })
      .eq('match_id', mp.match_id)
      .eq('payment_status', 'requested');
    if (stillOwed === 0) {
      await admin.rpc('insert_notification', {
        p_user_id: match.created_by,
        p_type: 'payment_all_received',
        p_target_id: mp.match_id,
        p_payload: { matchId: mp.match_id },
        p_priority: 'normal',
        p_title: null,
        p_body: null,
        p_scheduled_at: null,
        p_expires_at: null,
        p_organization_id: null,
      });
    }
  } else if (event.kind === 'payment_failed') {
    await admin
      .from('match_participant')
      .update({
        payment_status: 'failed',
        payment_failure_reason: event.reason,
      })
      .eq('id', mp.id);
  } else if (event.kind === 'payment_expired') {
    await admin.from('match_participant').update({ payment_status: 'expired' }).eq('id', mp.id);
  }

  await admin
    .from('payment_webhook_event')
    .update({ processed_at: new Date().toISOString(), participant_id: mp.id })
    .eq('id', row.id);

  return new Response(JSON.stringify({ received: true }), { status: 200 });
});
```

### 6.3 Rounding policy (`computeSplit`)

```ts
// Distribute cost as integer cents; the *first* N payers absorb the residual.
// e.g. $60 / 7 = 857.142… → six players pay 858¢, one pays 852¢.
// Largest residual on the player who joined first (deterministic ordering).
export function computeSplit(totalDollars: number, n: number): number[] {
  const totalCents = Math.round(totalDollars * 100);
  const base = Math.floor(totalCents / n);
  const residual = totalCents - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < residual ? 1 : 0));
}
```

Tests: `computeSplit(60, 4) = [1500,1500,1500,1500]`, `computeSplit(60, 7) = [858,858,858,858,858,857,857]`. Sum always equals `totalCents`.

### 6.4 Trigger mechanism

| Phase           | Mechanism                                                                                                                                                                                                                  | Source of truth |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| **v1 (launch)** | Manual: host taps "Request reimbursements" in `MatchDetailSheet` after match end                                                                                                                                           | Host action     |
| **v2**          | Vercel Cron: every 30 min, find matches where `end_time < now() - 1h AND cancelled_at IS NULL AND estimated_cost > 0 AND no participant has payment_status != 'none'` and POST to `match-payment-request-create` per match | Cron            |
| **v3**          | Supabase pg_cron + DB trigger when match marked complete (no Vercel hop)                                                                                                                                                   | DB trigger      |

Crons declared in `vercel.ts`:

```ts
// vercel.ts
import { type VercelConfig } from '@vercel/config/v1';
export const config: VercelConfig = {
  framework: 'nextjs',
  crons: [
    { path: '/api/crons/issue-payment-requests', schedule: '*/30 * * * *' },
    { path: '/api/crons/payment-reminders', schedule: '0 * * * *' }, // hourly
  ],
};
```

### 6.5 Reminders & expiry (`payment-reminders` cron)

For each row with `payment_status = 'requested'`:

- 3 days before `payment_expires_at`: send `payment_reminder` notification (push + email).
- On `payment_expires_at`: webhook will (or won't) fire `payment_expired`. Belt & suspenders: cron flips status to `expired` if 24h past expiry with no webhook event.
- After expiry: host sees a "Resend request" button which cancels the dead one and issues a fresh request.

### 6.6 Manual mark-as-paid

```ts
// POST /functions/v1/match-payment-mark-manual
// Auth: caller must be the match host
// Body: { participantId: string }
// Effect: payment_status = 'manual', has_paid = true, marked_paid_by = host
//         If a request was outstanding, call interac.cancelMoneyRequest first.
```

This preserves the existing UI affordance (`matchDetail.markAsPaid`) and handles cash/Venmo/already-paid-elsewhere cases.

---

## 7. Mobile UI

### 7.1 Reuse existing reimbursement section

The reimbursement section in `apps/mobile/src/components/MatchDetailSheet.tsx` (lines 4589–4700) stays in place. We replace only the **action handlers**:

| Old (Stripe)                                               | New (Interac)                                                                                                                                    |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `useStripe()` + `initPaymentSheet` + `presentPaymentSheet` | Open WebView modal (Phase 2) or Alert with "check your email" copy (Phase 1)                                                                     |
| `supabase.functions.invoke('match-reimbursement-create')`  | `supabase.functions.invoke('match-payment-request-create')` (host trigger) and per-participant payment URL fetch (payer)                         |
| Optimistic `has_paid: true` after payment sheet success    | Optimistic `payment_status: 'paid'` after WebView returns success URL — but UI MUST also refetch and trust the server (webhook is authoritative) |

### 7.2 Phase 1 (Dwello) — payer experience

Player sees a card on the match detail screen:

> **You owe $20.00 for Tuesday's match at Club XYZ**
> _Check your email for the Interac e-Transfer request from Rallia Payments. It expires in 14 days._
> [ Resend email ] [ Mark as paid (cash) ]

### 7.3 Phase 2 (VoPay) — payer experience

Tap "Pay Now" → WebView modal opens → player picks bank → bank login → approves transfer → WebView dismisses → row refetches, shows ✓.

```tsx
// InteracPaymentSheet.tsx
<Modal visible={visible} animationType="slide" onRequestClose={onClose}>
  <SafeAreaView style={{ flex: 1 }}>
    <View style={styles.header}>
      <Text style={styles.title}>{t('payments.completePayment')}</Text>
      <TouchableOpacity onPress={onClose}>
        <Text>{t('common.cancel')}</Text>
      </TouchableOpacity>
    </View>
    <WebView
      source={{ uri: paymentUrl }}
      onNavigationStateChange={s => {
        // VoPay redirects to https://rallia.app/payments/return?status=success&ref=...
        const u = new URL(s.url);
        if (u.origin === 'https://rallia.app' && u.pathname === '/payments/return') {
          if (u.searchParams.get('status') === 'success') onComplete();
          else if (u.searchParams.get('status') === 'cancel') onClose();
        }
      }}
      // Anti-fragility: also poll the row every 5s while WebView is open
      // and trust the server status as authoritative
    />
  </SafeAreaView>
</Modal>
```

### 7.4 Remove Stripe SDK

- `npm rm @stripe/stripe-react-native --workspace=apps/mobile`
- Strip `useStripe`, `initPaymentSheet`, `presentPaymentSheet` imports from `MatchDetailSheet.tsx` and any other component.
- Remove `STRIPE_*` env from EAS build profiles in `eas.json` and `app.json`.
- Remove the Stripe Connect return Universal Link from `app.json` and `apple-app-site-association`.

---

## 8. Notifications

We use the existing **notification system v2** (`notification` table + `insert_notification` RPC + `send-notification` Edge Function delivery worker). No parallel pipeline.

### Plumbing checklist

1. **Enum values** added in migration `20260504000001_payment_notification_enum_values.sql` (see §4).
2. **`PaymentNotificationPayload`** added to the `NotificationPayload` union in `packages/shared-services/src/notifications/notificationFactory.ts`:
   ```ts
   export interface PaymentNotificationPayload {
     matchId: string;
     payerId?: string;
     amountCents?: number;
     facilityName?: string;
     expiresAt?: string; // ISO
   }
   ```
3. **`DEFAULT_PRIORITIES`** map (also in `notificationFactory.ts`) gets entries:
   ```ts
   payment_requested: 'high',
   payment_reminder_3d: 'normal',
   payment_received: 'normal',
   payment_all_received: 'normal',
   payment_failed: 'high',
   payment_expired: 'normal',
   ```
4. **Translation keys** under `notifications.messages.payment_*.title` / `.body` in both en-US and fr-CA.
5. **Web app callers** (if any) use `createNotification({ userId, type, payload, ... })` from `@rallia/shared-services`.
6. **Edge Functions** call the underlying RPC directly (`admin.rpc('insert_notification', { p_user_id, p_type, p_target_id, p_payload, p_priority, p_title:null, p_body:null, ... })`) since they cannot import the workspace package.
7. **Push delivery** is handled automatically by the existing `send-notification` worker reading from the `notification` table. No new push-side code needed.

### Notification matrix

| Type                   | Recipient    | Trigger                                                    |
| ---------------------- | ------------ | ---------------------------------------------------------- |
| `payment_requested`    | Payer        | New request issued                                         |
| `payment_reminder_3d`  | Payer        | 3 days before expiry, only if `payment_status='requested'` |
| `payment_received`     | Host         | Webhook `payment_completed`                                |
| `payment_all_received` | Host         | Last `requested` row of a match flips to paid              |
| `payment_failed`       | Host + Payer | Webhook `payment_failed`                                   |
| `payment_expired`      | Host + Payer | Cron expiry                                                |

Currency rendering uses `Intl.NumberFormat(locale, { style: 'currency', currency: 'CAD' })`.

---

## 9. i18n (translation keys)

Add to both `packages/shared-translations/src/locales/en-US.json` and `fr-CA.json`:

```jsonc
"payments": {
  "payNow": "Pay Now",                           // "Payer maintenant"
  "completePayment": "Complete Payment",         // "Confirmer le paiement"
  "shareFor": "Your share for {facility}",       // "Votre part pour {facility}"
  "youOwe": "You owe {amount}",                  // "Vous devez {amount}"
  "paid": "Paid",                                 // "Payé"
  "pending": "Pending",                           // "En attente"
  "failed": "Failed",                             // "Échec"
  "expired": "Expired",                           // "Expiré"
  "manual": "Marked as paid",                    // "Marqué comme payé"
  "checkEmail": "Check your email",              // "Vérifiez votre boîte courriel"
  "interacRequestSent": "An Interac e-Transfer request has been sent to {email}. It expires {date}.",
  "interacRequestSentSms": "An Interac e-Transfer request has been sent to {phone}. It expires {date}.",
  "resendRequest": "Resend request",
  "markAsPaid": "Mark as paid (cash, etc.)",
  "requestReimbursements": "Request reimbursements",
  "allReceived": "All payments received",
  "received": "{paid} of {total} received",
  "noContactMethod": "We need an email or verified phone number to send a payment request.",
  "tap_to_pay_in_app": "Tap to pay in-app"
}
```

Currency values are NEVER concatenated with `$` strings; always rendered through `formatCurrency(amountCents, locale)`.

---

## 10. Risk compensations (for losing Stripe)

### 10.1 Identity / fraud

Stripe Connect Express ran KYC on every host. Interac request-money does not. Mitigations at launch:

- **Host eligibility gate:** to receive reimbursements, a player must have:
  - Verified email (existing `profile.email` + `profile.email_verified`)
  - Verified phone (existing `profile.phone_verified`)
  - Account age ≥ 7 days
  - Match history ≥ 1 completed match as participant
- **Soft caps:** monthly inbound cap of $500 per host for the first 30 days, raised to $2,000 thereafter. Enforced server-side in `match-payment-request-create`.
- **Alert hooks:** Sentry alert if a single email receives requests from > 5 distinct payers in 24h (collusion / impersonation signal).

### 10.2 Disputes

Interac e-Transfers are final on acceptance — no chargeback. Policy:

- Add a `Report a payment problem` action on each paid row → opens a support ticket (linked to PostHog event + Sentry breadcrumb).
- Disputes are mediated by Rallia ops manually (Phase 1). Statuses: `disputed` is NOT a `payment_status` value at launch; we use a separate `support_ticket` table to track without complicating the payment state machine.
- Document explicitly in ToS: "Once an Interac transfer is accepted, Rallia cannot reverse it."

### 10.3 Platform fees (deferred)

At launch, Rallia takes no fee. When monetization is needed, the rail must change: the request would need to be made _to Rallia_, then Rallia transfers to the host minus a fee. That triggers MSB-status questions and is out of scope for this rollout.

---

## 11. Stripe Connect decommissioning

Strict ordering matters — do NOT delete Stripe code until all in-flight rows are reconciled.

### 11.1 Pre-cutover audit (T-7 days)

```sql
-- Find any in-flight Stripe payments that need resolution
SELECT mp.id, mp.match_id, mp.player_id, mp.payment_reference, m.created_by, m.estimated_cost
FROM match_participant mp
JOIN match m ON m.id = mp.match_id
WHERE mp.payment_reference LIKE 'pi_%'  -- Stripe PaymentIntent prefix
  AND mp.has_paid = false
  AND mp.status = 'joined'
  AND m.cancelled_at IS NULL;
```

For each in-flight row: cancel the PaymentIntent in Stripe, notify the payer, re-issue under Interac after cutover.

### 11.2 Cutover steps (T-0)

1. **Disable** Stripe webhook endpoint in Stripe Dashboard (`stripe-match-webhook` URL).
2. **Deploy** new schema migration + Edge Functions (`match-payment-request-create`, `interac-webhook`, `match-payment-mark-manual`).
3. **Deploy** mobile app build with Interac flow (forces TestFlight roll, then App Store/Play Store via expedited review noting payment-rail change).
4. **Toggle** `INTERAC_PROVIDER=dwello` env var in Supabase project.
5. **Run** Stripe Connect deauthorization sweep — **player-side only**, do NOT touch `organization_stripe_account`:
   ```ts
   const { data: rows } = await admin
     .from('player_stripe_account')
     .select('player_id, stripe_account_id');
   for (const acct of rows ?? []) {
     await stripe.oauth.deauthorize({ stripe_user_id: acct.stripe_account_id });
   }
   ```
6. **Communicate** to hosts: in-app banner + email "Your payout method has changed."

### 11.3 Post-cutover cleanup (T+7 days)

> **Scope warning:** This cleanup targets **only the player-side reimbursement Stripe flow**. The repo also has a completely separate **organization-side Stripe Connect** flow (table `organization_stripe_account`) used for booking + donation revenue. **That flow stays.** Below lists are exact.

After 7 days with no Stripe webhook traffic to the **match** webhook URL:

#### Delete (player-reimbursement only)

```bash
rm -rf supabase/functions/match-reimbursement-create
rm -rf supabase/functions/stripe-match-webhook
rm -rf supabase/functions/player-stripe-onboard
```

#### Migration `20260511000000_drop_player_stripe_account.sql`

```sql
-- Archive then drop the player-side connect table.
-- Does NOT touch organization_stripe_account.
CREATE TABLE _archive_player_stripe_account AS TABLE player_stripe_account;
DROP TABLE player_stripe_account;
```

#### Mobile

- Remove `@stripe/stripe-react-native` from `apps/mobile/package.json`.
- Remove `useStripe`, `initPaymentSheet`, `presentPaymentSheet` calls from `MatchDetailSheet.tsx`.
- Remove the `stripe-connect-return` Universal Link from `app.json` and `apple-app-site-association`.

#### Keep (do NOT touch — organization-side)

| Path                                                                                 | Why it stays                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/lib/stripe/client.ts`                                                      | Stripe SDK init, used by all flows                                                                                                                                                                                   |
| `apps/web/lib/stripe/connect.ts`                                                     | Organization Connect onboarding                                                                                                                                                                                      |
| `apps/web/lib/stripe/payments.ts`                                                    | PaymentIntents for bookings + donations                                                                                                                                                                              |
| `apps/web/lib/stripe/types.ts`                                                       | Shared types                                                                                                                                                                                                         |
| `apps/web/lib/bookings/create.ts`, `cancel.ts`                                       | Booking flow uses `stripe_payment_intent_id`                                                                                                                                                                         |
| `apps/web/lib/programs/cancellation.ts`                                              | Program payments use Stripe                                                                                                                                                                                          |
| `apps/web/app/api/stripe/connect/route.ts`, `callback/route.ts`                      | Org Connect onboarding                                                                                                                                                                                               |
| `apps/web/app/api/stripe/webhooks/route.ts`                                          | Handles `account.updated`, `account.application.deauthorized`, `payment_intent.succeeded` (booking), `charge.refunded`. None of these handlers are uniquely tied to `player_stripe_account` — verified during audit. |
| `apps/web/app/[locale]/(org)/dashboard/settings/payments/*`                          | Org dashboard for Connect status                                                                                                                                                                                     |
| `supabase/functions/booking-create/`, `booking-cancel/`, `process-program-payments/` | Booking + program payment edge functions                                                                                                                                                                             |
| `organization_stripe_account` table                                                  | Org Connect data                                                                                                                                                                                                     |
| `booking.stripe_payment_intent_id` column                                            | Booking reconciliation                                                                                                                                                                                               |

#### Env vars

- Remove from Vercel + Supabase: any `STRIPE_*` var that was _only_ used by `match-reimbursement-create`, `stripe-match-webhook`, or `player-stripe-onboard`. In practice this is the `STRIPE_MATCH_WEBHOOK_SECRET`. Keep `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (for org webhook).

#### App Store / Play Store

- Update App Privacy declarations: list "Dwello Payments Inc." (Phase 1) / "VoPay Inc." (Phase 2) as a third-party processor for player reimbursements. Stripe Inc. remains listed for booking + donation flows.
- Reviewer notes for the build that drops `@stripe/stripe-react-native`: clarify that booking/donation Stripe flows are web-side and continue to function.

### 11.4 Backout plan

If Interac provider has a critical incident in the first 30 days:

- Toggle a feature flag `PAYMENTS_DISABLED=true` → app shows "Payment requests temporarily unavailable, please coordinate offline." Existing `markAsPaid` continues to work.
- We do NOT roll back to Stripe — that would require resurrecting deauthorized Connect accounts, which can't be done programmatically.

---

## 12. Observability

### 12.1 Logging (Sentry)

Every Edge Function logs structured breadcrumbs:

- `interac.request.created` { provider, transactionId, amountCents, matchId, payerId }
- `interac.webhook.received` { provider, eventId, kind, signatureOk }
- `interac.webhook.processed` { eventId, durationMs, transition }
- `interac.error.*` for typed failures

Sentry alerts on:

- Webhook signature failure rate > 1% (24h window)
- Webhook 5xx rate > 0.5%
- Provider API error rate > 5%
- Any `noContactMethod` for an active match (UX bug signal)

### 12.2 Analytics (PostHog)

Capture events on every state transition:

- `payment_request_issued`
- `payment_paid`
- `payment_failed` (with reason)
- `payment_expired`
- `payment_marked_manual`

Dashboards:

- Time-to-pay distribution (median, p90)
- Completion rate by provider
- $ in-flight, $ paid 7d / 30d
- Funnel: requested → paid

### 12.3 Ops runbook

`docs/runbooks/interac-payments.md` covering:

- Stuck `requested` row > 14 days
- Webhook signature failures
- How to manually re-issue a request
- How to mark a row as `manual` from SQL (with audit logging)
- Provider outage protocol

---

## 13. Compliance & legal

### 13.1 Pre-launch checklist

- [ ] Privacy Policy update: add Dwello Payments Inc. as a sub-processor (Phase 1), VoPay Inc. (Phase 2)
- [ ] ToS update: payment finality clause, Rallia is not a money services business, no chargeback/dispute reversal
- [ ] PIPEDA review: data flow diagram showing what PII (name, email, phone) is sent to provider
- [ ] FINTRAC consultation: confirm Rallia is NOT a Money Services Business under the request-money model (Rallia never custodies funds)
- [ ] Apple App Store: payment processor disclosure in `App Privacy` section + reviewer notes explaining that Interac is real-money outside-of-IAP (consistent with §3.1.5(b) of App Review Guidelines)
- [ ] Google Play: in-app payment policy review (Interac is a real-world goods/services payment, exempt from Play Billing)

### 13.2 Data retention

- `payment_webhook_event` rows: retain 7 years (Canadian financial recordkeeping standard)
- Deleted `match_participant` rows: PII (name, email, phone) is masked; financial fields preserved for ledger integrity

---

## 14. Test plan

### 14.1 Unit tests

- `computeSplit` — exhaustive checks: divisible, non-divisible, edge cases ($0, 1 player, 100 players)
- `verifyWebhook` — replay valid/invalid signatures for both providers
- `parseWebhookEvent` — fixture payloads for each event type per provider
- Currency rendering — `Intl.NumberFormat` for en-CA and fr-CA

### 14.2 Integration tests (sandbox)

- Dwello sandbox: end-to-end issue → simulate paid webhook → assert state
- VoPay sandbox: end-to-end issue → WebView mock → simulate paid → assert state
- Idempotency: replay the same webhook twice, assert one push notification, one DB transition
- Authorization: non-host calls `match-payment-request-create` → 403
- Trigger conditions: cancelled match, free court, host-pays split → all rejected

### 14.3 Migration tests

- Backfill of `payment_status` from `has_paid`: assert legacy paid rows preserved
- Stripe → Interac transition: with a row in mid-state, assert old `payment_intent_id` value rides into `payment_reference` correctly

### 14.4 Manual QA matrix

| Scenario                                       | Expected                                                |
| ---------------------------------------------- | ------------------------------------------------------- |
| Host with no Stripe account triggers payments  | Works (no host onboarding needed)                       |
| Player with no email + no verified phone       | `noContactMethod` returned, host sees error UI          |
| Player pays in-app via VoPay WebView           | Row flips to paid within 30s of bank approval           |
| Player pays via Interac email link, app closed | Push notification on next open + row updated by webhook |
| Player ignores request for 14 days             | Row flips to `expired`, host can resend                 |
| Host marks as paid manually before player pays | Provider request cancelled, row = `manual`              |
| Webhook delivered twice                        | Single notification, idempotent                         |

---

## 15. Implementation order

| Phase                          | Tasks                                                                                                                                                                                                                                                                                                | Days |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| **0. Pre-work**                | FINTRAC opinion, Dwello account + sandbox creds, ToS/Privacy updates                                                                                                                                                                                                                                 | 5    |
| **1. Schema + abstraction**    | Two migrations (column rename + new fields; enum-values), RLS, regenerate `packages/shared-types/src/supabase.ts` and `apps/web/types/index.ts`, fix `matchService.ts` reference, run `tsc -b`, `InteracProvider` interface, `DwelloProvider` impl with sandbox tests                                | 3    |
| **1.5. Notification plumbing** | Add `payment_*` enum values consumed; `PaymentNotificationPayload` type in `notificationFactory.ts`; `DEFAULT_PRIORITIES` entries; `notifications.messages.payment_*` translation keys (en-US + fr-CA)                                                                                               | 1    |
| **2. Edge Functions**          | `match-payment-request-create`, `interac-webhook`, `match-payment-mark-manual` + ledger; calls `insert_notification` RPC for all notifications                                                                                                                                                       | 3    |
| **3. UI translation strings**  | `payments.*` translation keys (en-US + fr-CA), `formatCurrency` helper using `Intl.NumberFormat`                                                                                                                                                                                                     | 1    |
| **4. Mobile UI rewire**        | Replace Stripe handlers in `MatchDetailSheet`, Phase 1 Alert flow, "Resend / Mark paid" actions; remove `@stripe/stripe-react-native` from mobile only                                                                                                                                               | 2    |
| **5. Cron + reminders**        | `vercel.ts` cron config, `payment-reminders` route                                                                                                                                                                                                                                                   | 1    |
| **6. Observability**           | Sentry, PostHog events, runbook                                                                                                                                                                                                                                                                      | 1    |
| **7. Stripe decommission**     | In-flight audit, **player-side-only** deauth sweep, delete the 3 player edge functions + mobile SDK + `player_stripe_account` table. Org-side Stripe Connect (`organization_stripe_account`, `lib/stripe/*`, `app/api/stripe/connect/*`, `app/api/stripe/webhooks/route.ts`) is preserved per §11.3. | 2    |
| **8. Phase 2 prep**            | VoPay sandbox, `VoPayProvider` impl, WebView component                                                                                                                                                                                                                                               | 3    |
| **9. Phase 2 cutover**         | Toggle `INTERAC_PROVIDER=vopay`, app build with WebView                                                                                                                                                                                                                                              | 1    |

**Total:** ~23 days of engineering. Cutover-blocking pre-work (FINTRAC, ToS) can run in parallel with implementation.

---

## 16. Open questions

| #   | Question                                                                                                | Owner           |
| --- | ------------------------------------------------------------------------------------------------------- | --------------- |
| 1   | Confirm Dwello sandbox availability and webhook signature scheme (HMAC algorithm + header name)         | Mathis          |
| 2   | Confirm VoPay return URL is configurable to `https://rallia.app/payments/return`                        | Mathis          |
| 3   | FINTRAC: written opinion that request-money does not require MSB registration                           | Legal           |
| 4   | Decision: 14-day expiry window — confirm acceptable from a UX standpoint                                | Product         |
| 5   | Decision: $500 / $2000 inbound caps — confirm from a fraud-vs-friction perspective                      | Product         |
| 6   | Stripe deauthorization: any user/host who explicitly objects keeps their account; document opt-out path | Legal + Support |

---

## Appendix A — Provider comparison

|                   | Dwello (Phase 1)                                    | VoPay (Phase 2)                                                     |
| ----------------- | --------------------------------------------------- | ------------------------------------------------------------------- |
| Monthly cost      | $0                                                  | $500+                                                               |
| Per-transaction   | $0 — $0.70                                          | $1.50+                                                              |
| In-app payment    | No (email/SMS)                                      | Yes (WebView iFrame)                                                |
| Webhook support   | Yes (Pro/Enterprise)                                | Yes (per-event URLs)                                                |
| Sandbox           | TBD (open Q1)                                       | Yes                                                                 |
| API style         | REST                                                | REST                                                                |
| Limit per request | $10,000                                             | $25,000                                                             |
| Signup            | Contact sales                                       | Contact sales                                                       |
| Docs              | [payments.dwello.com](https://payments.dwello.com/) | [docs.vopay.com](https://docs.vopay.com/docs/interac-money-request) |

## Appendix B — Other providers considered

| Provider                  | Why not chosen                                                                    |
| ------------------------- | --------------------------------------------------------------------------------- |
| Flinks Pay                | Open-banking layer — partners with VoPay rather than being a standalone processor |
| Kapcharge                 | Flat-rate, no-contract; held in reserve as Dwello backup                          |
| DC Payments               | Enterprise, opaque pricing                                                        |
| Peoples Payment Solutions | Targeted at fintech program managers, heavier lift                                |
| Nuvei                     | Redirect-based, e-commerce focus                                                  |
| Paysafe                   | Enterprise, gaming-focused                                                        |
| Stripe (Connect)          | Being decommissioned in this rollout — no native Interac Request Money support    |
