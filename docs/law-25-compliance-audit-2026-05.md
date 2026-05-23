# Quebec Law 25 Compliance Audit — Rallia

- **Scope:** `apps/web` (marketing + auth'd dashboards) and supporting infrastructure. Mobile app and server-side analytics noted as out-of-scope gaps.
- **Audit date:** 2026-05-22
- **Regulation:** _Act respecting the protection of personal information in the private sector_ (a.k.a. **Law 25** / Bill 64). In force progressively since Sept 2022; final provisions effective Sept 22, 2024.
- **Enforcer:** Commission d'accès à l'information du Québec (CAI).
- **Penalty ceiling:** administrative fines up to **CAD 10M or 2% of worldwide turnover**; penal fines up to **CAD 25M or 4% of worldwide turnover**.
- **Method:** Source code review of the web app, behavioural verification in the dev browser preview at three viewports, comparison against CAI guidance + published Law 25 commentary.

> Tracks the state of the codebase _after_ the consent banner implementation (PR introducing `apps/web/components/consent/*`, `apps/web/lib/consent.ts`, gated PostHog / Vercel Analytics / Sentry Replay / UTM cookies).

---

## 0. TL;DR

**Compliance Score: ~70/100** — Law 25's _technical_ cookie/tracking requirements are largely closed by the new consent layer. The remaining 30 points are split between (a) two non-trivial code gaps (mobile app, audit trail) and (b) organizational obligations (Privacy Officer, DSAR process, policy content) that cannot be solved from code.

```
Overall Law 25 Score:    ~70/100

Consent UX:              9/10   █████████░  (opt-in, off by default, refuse == accept, granular, reopenable)
Tracker gating (web):    8/10   ████████░░  (PostHog, Vercel Analytics, Sentry Replay, UTM cookies all gated)
Tracker gating (mobile): 0/10   ░░░░░░░░░░  (apps/mobile untouched — same legal exposure as web)
Audit trail of consent:  1/10   █░░░░░░░░░  (localStorage only — not demonstrable to CAI)
Privacy policy content:  4/10   ████░░░░░░  (Enzuzo embed exists; content not verified against new categories)
Privacy Officer:         ?/10   (not visible in repo — confirm one is named publicly)
DSAR process:            ?/10   (no operational artefact in repo)
Breach notification:     ?/10   (no documented internal procedure)
Cross-border disclosure: 3/10   ███░░░░░░░  (US-bound flows to PostHog/Sentry/Vercel not disclosed in banner)
```

---

## 1. Law 25 obligations vs. current state

| Obligation                                                 | Source                | Status                                     | Where in code                                                                              |
| ---------------------------------------------------------- | --------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Opt-in (not opt-out) before non-essential cookies/trackers | s. 8.1 + CAI guidance | ✅                                         | `cookie-banner.tsx`                                                                        |
| Privacy by default (tracking off on first paint)           | s. 9.1                | ✅                                         | `instrumentation-client.ts`, `analytics-runtime.tsx`                                       |
| Refusal as easy as acceptance                              | CAI guidance          | ✅                                         | Equal-weight `Refuse` / `Accept` buttons                                                   |
| Granular consent per purpose                               | s. 14                 | ✅ (2 toggleable + 1 always-on)            | `cookie-preferences-dialog.tsx`                                                            |
| Consent revocable any time                                 | s. 9                  | ✅                                         | Footer `CookiePreferencesTrigger`                                                          |
| Transparent info on purposes + recipients                  | s. 8 / s. 7           | ⚠️ Partial                                 | Banner body + per-category descriptions; **but** no mention that data leaves Quebec/Canada |
| Clear, simple language                                     | s. 8                  | ✅                                         | en-US.json / fr-CA.json `cookieConsent.*`                                                  |
| Designate a Privacy Officer + publish contact              | s. 3.1                | ❌ Unknown                                 | Should appear in `/privacy` policy                                                         |
| Privacy policy listing all processing                      | s. 8                  | ⚠️ Hosted by Enzuzo — content not verified | `app/[locale]/(marketing)/privacy/page.tsx`                                                |
| Cross-border disclosure assessment + notice                | s. 17                 | ❌                                         | PostHog (US), Sentry (US), Vercel Analytics (US) — not disclosed                           |
| Privacy Impact Assessment (PIA) for new processing         | s. 3.3                | ❌                                         | No PIA artefact in repo                                                                    |
| 30-day response to access/rectification requests           | s. 32 et seq.         | ❌                                         | No documented process                                                                      |
| Breach (confidentiality incident) notification             | s. 3.5                | ❌                                         | No documented process                                                                      |
| Demonstrable record of consent                             | s. 14                 | ❌                                         | localStorage only — visitor-controlled, not auditable                                      |
| Right to erasure / data portability                        | s. 28.1, s. 27        | ❌                                         | No self-serve flow; relies on email → manual process                                       |

---

## 2. Code-level gaps (fixable in this repo)

### 2.1 Mobile app has zero consent flow — **highest priority**

`apps/mobile` runs PostHog and persists first-touch UTMs via AsyncStorage on launch, with no opt-in. Same legal exposure as web pre-fix. Mirror the web design:

1. Mount a `ConsentProvider` equivalent (React Context backed by AsyncStorage).
2. Block `posthog.init` and UTM persistence in `App.tsx` until consent.
3. Build a native consent sheet (`react-native-actions-sheet`) on first launch.
4. Surface a "Cookie preferences" / "Privacy preferences" row in Settings.

Effort: ~1 day. Reference: same category labels (necessary / analytics / marketing) as web.

### 2.2 Consent audit trail — **second priority**

Currently in `lib/consent.ts:writeConsent`:

```ts
window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(state));
document.cookie = `${CONSENT_COOKIE_NAME}=${flag}; Max-Age=...; Path=/; SameSite=Lax`;
```

The visitor controls both. If the CAI asks _"prove this person opted in to PostHog on a given date"_, we cannot answer. Required minimal record per CAI guidance:

- Anonymous visitor id (hashed `ph_did` or random uuid generated on first decision)
- Timestamp
- Choices per category
- Consent banner version
- IP hash (not raw IP) + truncated UA for forensic dispute resolution

Implementation:

1. Migration: `consent_log` table (anon id, ts, analytics bool, marketing bool, version, ip_hash, ua).
2. `POST /api/consent` route — write-only, no read endpoint.
3. Call from `writeConsent`. Best-effort, must not block UI.
4. Retain ≥ 24 months (statute of limitations for CAI complaints).

### 2.3 Subdomain coverage of the consent cookie

`rallia_consent` is set with `Path=/` but no `Domain=`. If `api.rallia.ca`, `admin.rallia.ca` or other subdomains drop trackers, they cannot read the visitor's choice. Fix in `lib/consent.ts`:

```ts
const domain = location.hostname.endsWith('rallia.ca') ? '; Domain=.rallia.ca' : '';
document.cookie = `${CONSENT_COOKIE_NAME}=${flag}; Max-Age=${maxAge}; Path=/; SameSite=Lax${domain}`;
```

### 2.4 Server-side analytics not gated

`apps/web/app/api/admin/analytics/utm/route.ts` and `app/api/attribution/{sign,verify}/route.ts` operate without checking the consent cookie. They're admin-facing today, but if any of them ever fire for end-user visitors, they must read the `rallia_consent` cookie marker (`a` / `m` chars) and short-circuit when absent.

### 2.5 PostHog "right to erasure" on revoke

`analytics-runtime.tsx` calls `posthog.opt_out_capturing()` on revoke and purges local cookies — but past events stay on PostHog's servers. For a true revoke we should additionally call PostHog's [delete person endpoint](https://posthog.com/docs/api/persons#delete-api-projects-project_id-persons-id) for the visitor's distinct_id. Marginal but expected by the strictest reading of s. 28.1.

### 2.6 Sentry error capture runs pre-consent

`instrumentation-client.ts` keeps `Sentry.init` at boot (with `sendDefaultPii: false`). We argued this falls under "necessary operations" (production stability) — defensible but not airtight. If the CAI takes a stricter line, we'd need to gate Sentry too, or migrate to anonymous-only error logging. Watch upcoming CAI clarifications.

### 2.7 Marketing surfaces that may set their own cookies

`SmartAppBanner`, embedded `EnzuzoEmbed`, any third-party iframes (Maps, Stripe Checkout) — none audited individually. Static smart banner is Apple-managed and benign; Stripe Checkout sets its own cookies that are arguably _necessary_ for the payment functionality the user explicitly initiates. Worth a one-pass network audit (DevTools → Application → Cookies) before declaring complete.

---

## 3. Organizational gaps (cannot be fixed in code)

### 3.1 Designated Privacy Officer

Law 25 s. 3.1: by default the person with the highest authority. Their **name and contact must be published on the website**. Edit the Enzuzo-hosted policy to include:

```
Responsable de la protection des renseignements personnels :
<Name>, <Title>
privacy@rallia.ca
```

### 3.2 Privacy policy content review

The current policy is an Enzuzo embed (`scriptUrl=…b265d6f0…`). It must explicitly list:

- **Tracking technologies in use:** PostHog (product analytics), Vercel Web Analytics, Sentry (error monitoring + session replay), first-party UTM cookies (`rallia_utm`, `ph_did`).
- **Purposes** for each.
- **Retention periods** per data type.
- **Cross-border transfers:** PostHog (US Cloud), Sentry (US), Vercel (US). Required disclosure per s. 17.
- **User rights:** access, rectification, erasure, portability, withdrawal of consent. 30-day response window.
- **Privacy Officer contact.**
- **Complaint route:** CAI's mailing address.

### 3.3 DSAR (Data Subject Access Request) operational process

When someone emails `privacy@rallia.ca` asking _"give me everything you have on me"_:

1. Verify identity (email match against `auth.users` / `profiles`).
2. Pull from Supabase (profile, matches, bookings, messages).
3. Pull from PostHog (`/api/projects/:id/persons/?distinct_id=…`).
4. Pull from Sentry (`/api/0/organizations/:org/users/?email=…`).
5. Assemble PDF/JSON, deliver within **30 days**.

Document this as a runbook in `docs/`. Templates for response letters in both EN and FR.

### 3.4 Confidentiality-incident (breach) protocol

Required by s. 3.5. Minimum content:

- Detection → triage → severity scoring → containment → CAI notification ("with diligence") → affected-individual notification → root-cause analysis → register entry.
- Maintain a breach register even for non-notifiable incidents.

### 3.5 PIA (Privacy Impact Assessment)

Required _before_ any new processing of personal info or any cross-border transfer (s. 3.3, s. 17). Triggers for Rallia: launching availability sharing, ranking/visibility changes, new third-party integrations (e.g. Interac payments, calendar sync, anything in `docs/*-plan.md`). Document each PIA, even briefly.

---

## 4. Verification log (2026-05-22)

| Flow                                               | Viewport   | Result                                                                                                   |
| -------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------- |
| First visit                                        | 375 × 812  | Banner mounts hidden, fades in with translate-y over ~300 ms                                             |
| First visit                                        | 768 × 1024 | Same; full-width with side margins                                                                       |
| First visit                                        | 1440 × 900 | Floating card, max-w-2xl, bottom-right anchor                                                            |
| Refuse non-essential                               | desktop    | `localStorage` stores `{analytics: false, marketing: false}`; no `rallia_utm` / `ph_did` cookies written |
| Accept all (with `?utm_source=test`)               | desktop    | `localStorage` stores `{analytics: true, marketing: true}`; `rallia_utm` written **after** consent only  |
| Open prefs from footer, toggle marketing off, save | desktop    | `rallia_utm` and `ph_did` purged immediately                                                             |
| Locale switch fr-CA                                | desktop    | Full French banner + dialog incl. "Loi 25 du Québec" reference                                           |
| `tsc --noEmit`                                     | —          | Pass                                                                                                     |
| Browser console                                    | —          | No errors                                                                                                |

---

## 5. Prioritized action plan

| #   | Action                                                                                   | Owner         | Effort    | Risk if skipped                                                                            |
| --- | ---------------------------------------------------------------------------------------- | ------------- | --------- | ------------------------------------------------------------------------------------------ |
| 1   | Build consent flow for `apps/mobile` (PostHog + UTM gating + native sheet)               | Eng           | ~1 day    | Same legal exposure as web pre-fix; CAI complaints can target the mobile app independently |
| 2   | Server-side consent log + `/api/consent` route + Supabase table                          | Eng           | ~3 hr     | Cannot demonstrate consent during a CAI investigation                                      |
| 3   | Update Enzuzo privacy policy with tracker list, cross-border disclosure, Privacy Officer | Founder       | ~2 hr     | Banner is correct but the linked policy is not — CAI looks at the whole picture            |
| 4   | Name + publish Privacy Officer                                                           | Founder       | ~30 min   | s. 3.1 violation                                                                           |
| 5   | DSAR + breach runbooks committed to `docs/`                                              | Founder + Eng | ~half day | 30-day clock starts when an email arrives; you do not want to improvise                    |
| 6   | Set `Domain=.rallia.ca` on consent cookie                                                | Eng           | ~5 min    | Subdomain trackers fall outside consent scope                                              |
| 7   | PostHog person-delete on revoke                                                          | Eng           | ~30 min   | Strictest reading of s. 28.1                                                               |
| 8   | Network audit of every third-party iframe/script for cookie behaviour                    | Eng           | ~2 hr     | Hidden trackers void the consent guarantee                                                 |

Targets 1–5 give defensible Law 25 compliance. Targets 6–8 close the long tail.

---

## 6. References

- Loi 25 — texte officiel : <https://www.legisquebec.gouv.qc.ca/fr/document/lc/P-39.1>
- CAI guidance on online tracking : <https://www.cai.gouv.qc.ca/protection-renseignements-personnels/explications-loi-25/>
- McCarthy Tétrault — _Quebec's Law 25 and Cookies: Not So Cookie Cutter_ (2024)
- CookieYes — _Comprehensive Guide to Quebec Law 25_ (2025)
- Termly — _What Is Quebec's Law 25?_ (2025)
- BCLP — _Quebec Law No. 25: a little-known privacy law with a big reach_ (2025)
