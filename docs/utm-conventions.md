# UTM Conventions

How Rallia tags links so we can attribute signups, installs, and matches to the channels that drive them. Source of truth for the vocabulary lives in `packages/shared-utils/src/utm/vocabulary.ts` — keep this doc and that file in sync.

## When to tag a link

Tag every outbound link we _publish_ — Instagram bio, WhatsApp blasts, blog posts, paid ads, partner pages, QR codes on flyers. Do **not** tag in-product navigation (those events are tracked by their own analytics calls).

If you ever paste a link to `rallia.app` somewhere a real human will click it, it should carry UTM params.

## The five params

| Param          | Required | What it means                                | Example                     |
| -------------- | -------- | -------------------------------------------- | --------------------------- |
| `utm_source`   | yes      | Where the click physically came from         | `instagram`, `newsletter`   |
| `utm_medium`   | yes      | The category of channel                      | `social`, `email`, `cpc`    |
| `utm_campaign` | yes      | The growth initiative                        | `friends_family_2026`       |
| `utm_content`  | optional | Variant inside the campaign (A/B, post slot) | `story_swipeup`, `bio_link` |
| `utm_term`     | optional | Paid-search keyword only                     | `tennis_partners_montreal`  |

### `utm_source` — closed vocabulary

Pick from this list. If your channel isn't here, add it to `vocabulary.ts` rather than inventing a one-off — typos and variants split funnels in PostHog.

`instagram`, `facebook`, `tiktok`, `youtube`, `twitter`, `linkedin`, `reddit`, `whatsapp`, `imessage`, `sms`, `email`, `newsletter`, `blog`, `website`, `google_ads`, `meta_ads`, `partner`, `event`, `app_share`, `direct`, `other`

### `utm_medium` — closed vocabulary

`social`, `paid_social`, `cpc`, `email`, `referral`, `organic`, `qr`, `push`, `in_app`, `other`

### `utm_campaign` — open, but follow the format

`<topic>_<year>[_<variant>]` in `snake_case`. Examples:

- `friends_family_2026`
- `pickleball_launch_2026_q2`
- `montreal_clubs_2026`
- `valentines_doubles_2026`

Bump the year when you re-run a recurring campaign — don't reuse `holiday_special` across years.

## How to build a tagged link

Always go through `buildUtmUrl` from `@rallia/shared-utils` so the typed vocabulary catches mistakes at compile time:

```ts
import { buildUtmUrl } from '@rallia/shared-utils';

const url = buildUtmUrl('https://rallia.app/play', {
  utm_source: 'instagram',
  utm_medium: 'social',
  utm_campaign: 'friends_family_2026',
  utm_content: 'story_swipeup',
});
// → https://rallia.app/play?utm_source=instagram&utm_medium=social&utm_campaign=friends_family_2026&utm_content=story_swipeup
```

For ad-hoc one-off links (e.g. a one-time newsletter blast), it's fine to construct the URL by hand as long as the vocabulary is respected.

## How attribution works end-to-end

1. **Landing** — `UtmCapture` (web) / `App.tsx` deep-link handler (mobile) parses the URL on first visit.
2. **Persistence** — first-touch UTM set is stored: web cookie `rallia_utm` (90d) / mobile AsyncStorage `@rallia/utm-params`. We never overwrite once set, so a returning visitor's eventual signup still credits the original channel.
3. **Event** — `deep_link_opened` fires immediately so anonymous landings are visible in PostHog before signup.
4. **Identify** — at signup, `PostHogIdentify` (web) / `AuthenticatedProviders` (mobile) flushes the stored UTMs onto the new PostHog person, then clears the storage. The user now carries `utm_source` / `utm_medium` / `utm_campaign` / `utm_content` person properties.
5. **Cohorts** — filter PostHog insights by `person.utm_campaign = 'friends_family_2026'` to see funnel performance per campaign.

## Examples for common channels

```ts
// Instagram bio link
buildUtmUrl('https://rallia.app/', {
  utm_source: 'instagram',
  utm_medium: 'social',
  utm_campaign: 'always_on_2026',
  utm_content: 'bio_link',
});

// Friends & Family WhatsApp blast → /play
buildUtmUrl('https://rallia.app/play', {
  utm_source: 'whatsapp',
  utm_medium: 'referral',
  utm_campaign: 'friends_family_2026',
});

// Newsletter CTA
buildUtmUrl('https://rallia.app/', {
  utm_source: 'newsletter',
  utm_medium: 'email',
  utm_campaign: 'february_2026_digest',
  utm_content: 'header_cta',
});

// Printed flyer QR code
buildUtmUrl('https://rallia.app/', {
  utm_source: 'partner',
  utm_medium: 'qr',
  utm_campaign: 'tennis_canada_2026',
  utm_content: 'flyer_v1',
});
```

## What not to do

- Don't reuse `utm_source=facebook` for both organic posts and paid ads — that's `social` vs `paid_social` in `utm_medium`.
- Don't put unique IDs in `utm_content` — it explodes cardinality. Use it for variants, not invitations.
- Don't tag internal app links — those are covered by typed events in `apps/mobile/src/services/analytics.ts`.
- Don't change a campaign's name mid-flight; the data won't roll up.
