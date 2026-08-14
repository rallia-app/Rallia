# Button / CTA Audit — shared `foundation/Button`

**Date:** 2026-08-09
**Scope:** `packages/shared-components/src/foundation/Button.tsx` vs. hand-rolled buttons in `apps/mobile/src/{screens,features}`.
**Goal:** identify why agents and humans bypass the shared Button, and define the smallest set of API changes that makes "always use the registry" (see root `CLAUDE.md`) actually followable.

## 1. Adoption snapshot

| Metric                                                          | Value                  |
| --------------------------------------------------------------- | ---------------------- |
| Shared `<Button>` call sites (mobile)                           | ~81                    |
| `TouchableOpacity` occurrences (mobile screens + features)      | 2,347 across 286 files |
| Locally-defined button style keys (`*Button:`, `*Btn:`, `cta:`) | 550 across 185 files   |
| Distinct literal `borderRadius` values in those trees           | 20+                    |
| Files with hardcoded hex colors                                 | 142                    |
| `<Button>` call sites passing `themeColors`                     | 28                     |
| `<Button>` call sites passing `isDark`                          | 9                      |

Most-duplicated hand-rolled names: `closeButton` ×54, `backButton` ×32, `submitButton` ×30, `headerButton` ×17, `retryButton` ×16, `cancelButton` ×12, `fab` ×5+.

## 2. Root causes (why people bypass it)

### 2.1 Button does not theme itself (the biggest one)

`Button` takes `themeColors` and `isDark` as props and falls back to hardcoded light-ish defaults. Every correct call site must wire:

```tsx
const { colors, isDark } = useThemeStyles();
<Button themeColors={colors} isDark={isDark}>
  ...
</Button>;
```

That is more ceremony than writing a `TouchableOpacity`, so people skip it. Consequences:

- ~90 of ~118 usages pass no `themeColors`; ~109 pass no `isDark`. In dark mode these render light-theme colors (`outline`/`ghost`/`link` text uses `lightTheme.foreground` = near-black on a dark background).
- `packages/shared-components` **already depends on `@rallia/shared-hooks`** (package.json), so Button can call `useThemeStyles()` itself. There is no dependency obstacle; this is purely historical.

### 2.2 No icon-only story

`children` is mandatory and always rendered inside `<Text>`, so an icon-only button is impossible. This single gap explains the four biggest duplication clusters (close ×54, back ×32, header ×17, fab): all are icon-only touchables, each re-inventing hit area, radius, and background:

- `Paywall.tsx:440` closeButton: 36×36, radius 18
- `ImportContactsModal.tsx:413` closeButton: `padding: 4`, absolutely positioned
- `ChatSearchBar.tsx:239` closeButton: `padding: spacingPixels[2]`
- `Communities.tsx:838` headerButton: 40×40, no background
- `Chat.tsx:594` / `Groups.tsx:579` / `SharedLists.tsx:404` fab: 56×56, radius 28, hand-rolled shadows that differ per screen

### 2.3 Missing semantic variants for common roles

Same role, divergent styling because no variant encodes it:

- **retry / empty-state action** (×16): renders at radius `sm`/`md`/`lg`, paddings 16/20/24 px, colors `primary[500]` vs `colors.primary` vs `colors.accent` depending on the screen. Once Button self-themes, `variant="primary" size="sm|md"` covers all 16; no new variant needed, but a documented convention is.
- **primary CTA**: `TournamentDetail.tsx:5494`, `LeagueDetail.tsx:4313` (py `spacingPixels[4]`) vs `SubscriptionManagement.tsx:289`, `SessionDetail.tsx:1367` (py `spacingPixels[3]`); `AdminSettingsScreen.tsx:521` uses radius `md` where CTAs elsewhere use `lg`. Convention needed: full-width CTA = `size="lg" fullWidth`.
- **cancel/confirm pairs** (×12+): covered today by `variant="outline"` + `variant="primary"`/`destructive`, but undocumented, so screens hand-roll both.

### 2.4 Quality gaps in the primitive itself

- No `accessibilityRole="button"`, no `accessibilityLabel`/`accessibilityState` pass-through.
- No `hitSlop` (hand-rolled close buttons with `padding: 4` are sub-44pt touch targets today; the primitive should fix this class-wide).
- `TouchableOpacity` with fixed `activeOpacity={0.7}`; the app also has `AnimatedPressable` (`apps/mobile/src/components/AnimatedPressable.tsx`) as a separate, un-unified press-feedback path.
- No `onLongPress`.
- Radius is fixed at `borderRadius.base` unless `rounded` (full). The app's CTA convention in practice is larger radii; worth one decision, then encoded in the component.

### 2.5 Out of scope for Button (separate primitives)

- **Chips / selectable pills** (filter toggles, sport selectors): a selected/unselected state machine, not a Button variant. Recommend a future `foundation/Chip`.
- **Segmented controls**: same reasoning.

## 3. Recommended changes (all backwards compatible)

### 3.1 Self-theming

Button calls `useThemeStyles()` internally. Precedence: explicit `themeColors`/`isDark` props (kept, marked `@deprecated`) > theme context > current static defaults (only if no provider, e.g. isolated tests). This silently _fixes_ dark mode at ~90 existing call sites; visual change is the intended correction, but a quick dark-mode pass on key screens is warranted after the change.

### 3.2 `IconButton` (new, `foundation/IconButton.tsx`)

```tsx
interface IconButtonProps {
  icon: React.ReactNode;
  accessibilityLabel: string; // required, on purpose
  variant?: 'ghost' | 'tinted' | 'filled' | 'outline';
  size?: 'sm' | 'md' | 'lg'; // 32 / 40 / 48 pt square, radius full
  elevated?: boolean; // FAB-style shadow from design-system shadows
  disabled?: boolean;
  onPress?: (e?: GestureResponderEvent) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}
```

Mapping of today's clusters: close/header/back → `variant="ghost" size="md"`; FAB → `variant="filled" size="lg" elevated`; sub-44pt sizes get automatic `hitSlop`.

### 3.3 Button API additions

- `icon` + optional `children` (icon-only falls back to suggesting IconButton via docs, but doesn't crash).
- `accessibilityLabel`, `accessibilityState`, `onLongPress`, `hitSlop` pass-through; `accessibilityRole="button"` always set.
- Document the role conventions in the component JSDoc: full-width CTA = `size="lg" fullWidth`; retry = `size="sm"|"md" variant="primary"`; cancel/confirm = `outline` + `primary`/`destructive`.

### 3.4 Enforcement (follow-up, separate change)

ESLint rule set to `warn` (matching the React Compiler precedent):

- no raw hex color literals in `apps/mobile/src/{screens,features}`;
- no `backgroundColor`/`borderRadius` in inline styles on `TouchableOpacity`/`Pressable` in those trees.

954 inline overrides and 142 hex-color files exist today; `warn` keeps CI green while the count burns down opportunistically.

## 4. Suggested order of implementation

1. ~~Self-theming (3.1)~~ — **DONE 2026-08-09.** Button calls `useThemeStyles()` internally; `themeColors` kept as an explicit override that wins untouched (legacy call sites build their own palettes, including destructive ones); `isDark` prop is now ignored (deprecated). Note: `ThemeContext` ships a light-theme default value, so Button is safe without a provider (tests).
2. ~~`IconButton` (3.2)~~ — **DONE 2026-08-09.** `foundation/IconButton.tsx`, exported from the barrel. ghost/tinted/filled/outline, sizes sm 32 / md 40 / lg 48 (circular), `elevated` for FABs, required `accessibilityLabel`, automatic `hitSlop` below 44pt.
3. Button API additions + JSDoc conventions (3.3).
4. ~~Lint rules (3.4)~~ — **DONE 2026-08-09.** `packages/eslint-config/ui-consistency.mjs` (custom `rallia-ui` plugin; a separate plugin because flat-config rule options replace rather than merge, so extra `no-restricted-syntax` selectors would clobber the ratcheted design-tokens 'error' rule). Two `warn` rules scoped to `apps/mobile/src/{screens,features}`: `no-raw-hex-color` (skips token-valued hexes, which stay 'error' via design-tokens.mjs) and `no-hand-rolled-button` (inline `backgroundColor`/`borderRadius` on `TouchableOpacity`/`Pressable`/`AnimatedPressable`). Baseline at introduction: 958 + 524 warnings. Ratchet to 'error' once burned down, matching the design-tokens precedent.
5. Opportunistic migration of existing screens (never a big-bang sweep; convert when touching a screen anyway).
