# Store screenshots

## Layout

- `current/` — the live sets, uploaded 2026-08. Validated: correct sizes, no alpha, brand copy rules applied.
  - `appstore-69in/` — iPhone 6.9" (1320x2868), en + fr, 10 each
  - `appstore-ipad13/` — iPad 13" (2064x2752), en + fr, 10 each
  - `googleplay/` — Play phone (1080x2160, Android frame), en + fr, 10 each
- `archive/2026-04-generated/` — April 2026 generation (iphone67/ipad13/phone, light + dark, pitch mockups)
- `archive/2026-03-v1/` — first 5-screenshot sets (iphone65, ipad13)
- `sources/` — raw device captures the old sets were built from
- `inspiration/` — reference material (Strava)

## Upload notes

- App Store Connect: 6.9" set in the iPhone slot, 13" set in the iPad slot, per locale (en + fr-CA). Apple derives smaller sizes.
- Play Console: phone screenshots per language listing.
- Keep exports flattened (no alpha channel) — ASC rejects PNGs with alpha.
