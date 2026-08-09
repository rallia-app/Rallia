# Rallia Monorepo Guide

Rallia is a racquet-sports matchmaking app: Expo/React Native mobile app, Next.js web app, Supabase backend. Monorepo layout: `apps/mobile`, `apps/web`, `packages/shared-*`.

Full engineering guidelines live in `.cursor/rules/project-guidelines/RULE.md`. This file covers what agents get wrong most often. When the two conflict, this file wins.

## UI consistency (read this before writing ANY interface code)

The single most damaging failure mode in this repo is inventing ad-hoc styling for generic UI elements. Never guess how a button, input, card, badge, or any other common element should look. The answer already exists in the component registry.

**The rule: reach for the registry, never hand-roll.**

1. **Check the registry first**, in this order:
   - `packages/shared-components/src/` (mobile + cross-platform primitives: `foundation/Button`, `foundation/Text`, `foundation/Heading`, `forms/Input`, `forms/Select`, `layout/Card`, `layout/Stack`, `feedback/Badge`, `feedback/Skeleton`, `feedback/Spinner`, ...)
   - `apps/web/components/ui/` (web: shadcn/ui, 36 components installed)
   - `apps/mobile/src/components/` (app-specific composites)
2. **If the primitive exists, use it.** A button or CTA is `<Button>` from `@rallia/shared-components` (or `components/ui/button` on web). Never a `TouchableOpacity`/`Pressable` with hand-written `backgroundColor`/`borderRadius`/padding.
3. **If the primitive exists but lacks the variant you need, extend the shared component** (add a variant/size/prop) instead of forking a local copy. That is how the registry grows. Keep additions backwards compatible.
4. **If the primitive genuinely does not exist**, build it in the registry (`packages/shared-components` for mobile, `apps/web/components/ui` for web), not inline in a screen, if it is a generic element other screens could use.

**Design tokens are the only source of style values.**

- Colors, spacing, radius, typography, shadows come from `@rallia/design-system`. Never write hex literals (`#ffffff`), raw pixel radii (`borderRadius: 12`), or magic paddings.
- Mobile: `spacingPixels`, `radiusPixels`, `fontSizePixels`. Web: `spacing`, `radius`, `fontSize` (rem) via the Tailwind preset.
- Theme-dependent colors come from `useThemeStyles()` (`@rallia/shared-hooks`): `const { colors, isDark } = useThemeStyles()`. Every screen must render correctly in light AND dark mode. In dark mode, neutral body text is `colors.textMuted`, not `textSecondary` (which is teal).
- Loading states use the skeleton pattern (`Skeleton`, `SkeletonTextLine` mirroring the real layout), never centered spinners, for initial loads.

**Litmus test before you commit UI code:** if your diff contains a new `StyleSheet` entry named something like `submitButton`, `closeButton`, `retryButton`, `cta`, or a hex color, you have almost certainly duplicated something the registry already provides. Stop and use the shared primitive.

## Styling specifics (mobile)

- `StyleSheet.create` + design tokens. NativeWind is NOT installed in mobile; do not use `className` there.
- Safe areas: per-screen-category `edges` on `SafeAreaView` (tab screens `[]`, root screens with header `['bottom']`, headerless `['top','bottom']`). Never manual inset math.
- Sheets use `react-native-actions-sheet`. `await SheetManager.hide()` before showing another sheet. Never stack a second RN `Modal` for toasts above a sheet; use `ExtraOverlayComponent={<ToastOverlay />}`.
- React Compiler is enabled in mobile: do not mass-remove manual memoization; avoid `try/finally` and `eslint-disable` inside components (compiler bails).

## Copy & brand (user-facing text)

- User-facing copy says "games" / "parties" (fr), never "matches". Code identifiers keep `match`.
- No em dashes in any copy. No tennis-ball emoji; use sport-neutral emojis (🙌 💪 🔥 ✨ 🎯).
- French copy is Québécois-friendly but natural, never AI-sounding. "Streak" stays "streak" (feminine: "ta streak").
- Ratings always display one decimal: `Number(v).toFixed(1)` ("3.0", "4.5+").
- All strings go through i18n: `packages/shared-translations/src/locales/{en-US,fr-CA}.json`, always both files.

## Architecture essentials

- Data flow: Component → hook (`packages/shared-hooks`) → TanStack Query → service (`packages/shared-services`) → Supabase. Components never call Supabase directly. No Redux/Zustand.
- Database: new migration files only, never edit an applied migration. Local: `npx supabase migration up` (never `db push`). Types: `npm run db:generate-types:local`, never hand-edit `supabase.ts`. Every new public table migration needs explicit GRANTs.
- When copying a SQL function body to modify it, copy from the LATEST migration containing it (sort filenames), or you silently revert newer fixes.
- Logging via `Logger` from `@rallia/shared-services`, not `console.log`.
- Code comments: minimal, one short line max; rationale goes in the PR description.

## Git hygiene

- Multiple agents may share this working tree. Never `git add -A` or `git add .`; stage only files you touched, and check `git diff --cached` before committing.
- Conventional commits. Always commit migrations together with regenerated Supabase types.
