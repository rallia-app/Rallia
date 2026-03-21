# App Store Submission Checklist — Rallia

> Legend: `[x]` = Done | `[-]` = In Progress / Partial | `[ ]` = To Do

## Critical (Will cause rejection)

- [-] **Account Deletion** — Button UI exists in `SettingsScreen.tsx:449-458` but is **commented out**. A stub `handleDeleteAccount` exists in `SettingsModal.native.tsx` but only logs to console. No backend deletion logic. No web-based deletion page (required by Google Data Safety form).
  - [ ] Uncomment and wire up the delete button in SettingsScreen
  - [ ] Implement actual data deletion (profile, chats, matches, etc.) via Supabase
  - [ ] Build a web-based account deletion page for Google Play Data Safety form

- [x] **Report User/Content** — Fully implemented with three report types:
  - [x] Report player from chat (`ReportUserModal.tsx`) with reason selection + evidence uploads
  - [x] Report opponent from match feedback (`ReportIssueSheet.tsx`)
  - [x] Report facility inaccuracy (`ReportFacilitySheet.tsx`)
  - [x] Admin moderation dashboard with review, ban, and dismiss actions
  - [x] Anti-spam (24h duplicate prevention), auto-priority assignment, RLS policies

- [ ] **Demo Account for Reviewers** — Create a test account with pre-populated data (matches, chats, profile info). Provide credentials in App Store Connect review notes and Google Play Console's App Content → App Access page. Include any special configuration or setup instructions reviewers need to fully test the app.
  - [ ] Google requires credentials to be: **in English**, accessible at all times, reusable, valid regardless of reviewer location, and maintained without error

- [-] **App Completeness** — 40% of Apple rejections are Guideline 2.1. Issues found:
  - [ ] `Match.tsx` screen is a **placeholder stub** (just displays a translation key)
  - [ ] `useGroupEditActions.ts:98` shows **"Coming Soon"** alert for group description editing
  - [ ] `useTourSequence.ts:57-73` is **completely disabled** (returns hardcoded false values)
  - [ ] `AuthSuccessOverlay.tsx:50-64` has 3 navigation buttons that **do nothing** (TODO comments)
  - [ ] Multiple admin analytics screens fall back to **mock/generated data**
  - [ ] `mockMatches.ts` still used — TODO says "Replace with actual Supabase queries"
  - [ ] `backblazeUpload.ts:429` — video thumbnail generation is a placeholder
  - [ ] `PlayerProfile.tsx:790` — weekStreak hardcoded to 0
  - [ ] `SportProfile.tsx:814` — peer rating request logic not implemented
  - [x] Deep links are all properly configured and functional
  - [ ] Test on physical devices running the latest OS versions

- [ ] **Data Safety / Privacy Labels** — Complete both forms accurately:
  - [ ] Apple: App Privacy Labels in App Store Connect (location, email, name, usage data, push tokens, chat messages, etc.)
  - [ ] Google: Data Safety section in Play Console (same disclosures + account deletion web URL)
  - [ ] Ensure both match the actual privacy policy at rallia.ca/privacy

- [-] **Privacy Policy & Terms of Service URLs** — Links are configured in-app (`rallia.ca/privacy` and `rallia.ca/terms`) but **both URLs currently return 404**. These pages must be live before submission — both stores will reject if the links are broken.
  - [ ] Deploy a live privacy policy page at rallia.ca/privacy
  - [ ] Deploy a live terms of service page at rallia.ca/terms

---

## Important (High risk of rejection)

- [x] **Privacy Manifests (Apple)** — `PrivacyInfo.xcprivacy` exists at `ios/Rallia/PrivacyInfo.xcprivacy` and is properly configured: `NSPrivacyTracking: false`, declares required-reason API usage (file timestamps, UserDefaults, system boot time, disk space). Third-party SDK manifests should still be verified at build time.

- [ ] **Content Rating Questionnaires** — Complete on both platforms:
  - [ ] Apple: Updated age rating questionnaire (new tiers: 4+, 9+, 13+, 16+, 18+). Chat + player matching likely means 13+.
  - [ ] Google: IARC questionnaire in Play Console.

- [x] **Android Target API Level** — Expo SDK 54 targets **API level 35** (Android 15) by default. Meets current requirements. Note: by **August 31, 2026**, new apps must target **API level 36** (Android 16).

- [ ] **Google Play Closed Testing** — If developer account was created after November 2023: run a closed test with **20+ opted-in testers for 14 consecutive days** before publishing to production.

- [ ] **Google Play App Content Declarations** — Complete all required declarations in Play Console → App Content:
  - [ ] Privacy policy URL (must be a live webpage, not a PDF, and must contain your app name)
  - [ ] Ads declaration (no ads in app — declare "No")
  - [ ] Target audience and content (age range)
  - [ ] Data Safety form (see Critical section above)
  - [ ] Advertising ID declaration (no advertising ID used — declare "No")
  - [ ] Government apps declaration (declare "No")
  - [ ] Financial features declaration (Stripe for court bookings — may need declaration)
  - [ ] Health features declaration (declare "No")

---

## Moderate (Could cause rejection or delays)

- [-] **Terms of Use Acceptance at Signup** — Currently only a passive text disclaimer on the sign-in screen: _"By continuing, you agree to Rallia's Terms of Use."_ No checkbox, no explicit acceptance. Google requires users to accept Terms before creating UGC.
  - [ ] Add explicit Terms + Privacy Policy acceptance (checkbox or tap-to-agree) during signup
  - [ ] Add links to the full legal documents in the acceptance flow

- [-] **In-App Support Contact** — Feedback sheet exists in Settings (`useFeedbackReportSheet`), plus links to Terms/Privacy Policy. However, there is **no direct support email or contact form** visible in Settings. Apple requires published contact info accessible from within the app.
  - [ ] Add a visible support email address or contact form to the Settings screen

- [x] **App Tracking Transparency (Apple)** — **Not needed.** Facebook sign-in is commented out in UI. No Facebook SDK tracking, no ad network SDKs, no cross-app tracking. `NSPrivacyTracking` is set to `false`. Internal referral attribution uses first-party data only.

- [-] **POST_NOTIFICATIONS Permission (Android 13+)** — `POST_NOTIFICATIONS` is **not explicitly declared** in the manifest or app.json. It may be auto-added by `expo-notifications` at build time, but this should be verified in a production build.
  - [ ] Verify the permission appears in the final APK/AAB manifest after build
  - [ ] If missing, add `android.permission.POST_NOTIFICATIONS` to app.json permissions array

- [ ] **Google Pay / Billing Clarity** — Google Pay is disabled. Court bookings are physical services so Stripe is fine and Google Play Billing is NOT required. Ensure store listing and app metadata make clear that payments are for physical court bookings.

- [ ] **Google Play Store Listing Metadata** — Prepare all required assets:
  - [ ] App title (max 30 characters, no promotional phrases)
  - [ ] Short description (max 80 characters)
  - [ ] Full description (max 4,000 characters, must match actual app functionality)
  - [ ] App icon (512x512 px, max 1024 KB)
  - [ ] Feature graphic (1024x500 px)
  - [ ] Screenshots: minimum 2 for phones (min 1080x1920 px), authentic in-app UI, text overlay limited to 20%
  - [ ] Release notes for the version

---

## Nice to Have (Improves chances)

- [x] **Dark Mode Support** — Fully implemented. `ThemeProvider` with system/light/dark modes, `useThemeStyles()` hook, color palettes for both themes, user preference persisted to AsyncStorage. Used across 179+ component files.

- [ ] **Dynamic Type (Apple)** — **Not implemented.** No `allowFontScaling` or `maxFontSizeMultiplier` on text components. Users with accessibility font settings won't see them reflected in the app.

- [-] **Offline / Network Error Handling** — `networkTimeout.ts` provides timeout wrappers with retry logic and exponential backoff. `@react-native-community/netinfo` is installed but **not actively used** for offline state detection. App does not gracefully degrade when completely offline.
  - [ ] Add offline state detection and user-facing offline indicator

- [-] **Permission Purpose Strings** — iOS strings in app.json are Rallia-specific (camera/photos for profile pictures). Expo Image Picker strings are more user-friendly but slightly generic ("to share with your friends"). Android has no explanation strings (standard behavior).
  - [ ] Update Expo Image Picker strings to be more specific (e.g., "to set your profile picture and share match photos")

- [ ] **Staged Rollout (Google)** — Use staged rollout for the production release (start at 1-5% of users, monitor Android Vitals for crash rates and ANRs, then gradually increase to 100%).

- [-] **Privacy Policy Content** — **Cannot verify — rallia.ca/privacy returns 404.** Once live, verify it covers:
  - [ ] Identifies ALL data collected (including third-party SDK data)
  - [ ] Explains HOW data is collected
  - [ ] Describes ALL uses of that data
  - [ ] Confirms third-party data sharing has equal or greater protection
  - [ ] Explains data retention and deletion policies
  - [ ] Describes how users can revoke consent and request data deletion

- [ ] **Store Listing Screenshots** — Screenshots must match the actual current app UI and the correct device type selected in App Store Connect. Do not use overlays that hide the app experience. Text overlays should highlight features, not obscure them.

---

## Already Handled

- [x] Sign in with Apple
- [x] Google Sign-In
- [x] Push Notifications setup (expo-notifications, token registration, badge sync)
- [x] Splash Screen & App Icon configured
- [x] Block User functionality on player profiles
- [x] Chat Community Guidelines (ChatAgreementModal)
- [x] Admin Moderation Panel (reports, bans, dismiss actions)
- [x] Report User from chat (with evidence uploads)
- [x] Report Opponent from match feedback
- [x] Report Facility inaccuracy
- [x] Permission request dialogs with descriptions
- [x] Stripe for physical court bookings (IAP not required for physical goods)
- [x] 64-bit architecture (handled by Expo/React Native)
- [x] App Bundle format — AAB (handled by EAS Build)
- [x] Play App Signing (mandatory for new apps, handled by EAS Build)
- [x] Privacy Manifest (PrivacyInfo.xcprivacy) configured
- [x] Dark Mode support (system/light/dark with ThemeProvider)
- [x] Android Target API Level 35 (via Expo SDK 54)
- [x] No ad tracking / ATT not required
- [x] Deep links configured and functional

---

## Post-Submission Notes

- **90% of submissions** are reviewed within 24 hours
- If rejected, reply directly in App Store Connect / Play Console — fix all cited issues before resubmitting
- Submit **one appeal per rejection** (Apple)
- You can request an **expedited review** from Apple for critical bug fixes or time-sensitive events
- You can book a **30-minute consultation** with Apple's App Review team via [developer.apple.com/events](https://developer.apple.com/events/)
- Google Play first-time submissions may take **3-7 days**; subsequent updates typically **1-3 days**
- Google runs **automated pre-launch tests** on virtual devices — check pre-launch report in Play Console for crash/ANR issues before they reach reviewers
