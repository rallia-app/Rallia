// Design-token enforcement: flags hardcoded hex strings whose value duplicates
// a @rallia/design-system color token — the literal should be replaced by the
// token import so palette changes propagate (hand-copied values silently drift,
// which is how shared-components ended up on a stale teal/coral for months).
// Deliberately scoped to token-valued hex only: one-off colors, iOS system
// grays, and pure white/black are not flagged. Burned down to 0 (2026-07-06)
// and ratcheted to 'error' (same convention as the React Compiler rules in
// react-native.mjs); intentional exceptions carry inline disables with a
// rationale (decorative palettes that must not track brand-token changes).
//
// Keep in sync with packages/design-system/src/tokens/colors.ts.
const TOKEN_HEXES = [
  // primary (teal)
  'f0fdfa',
  'ccfbf1',
  '99f6e4',
  '5eead4',
  '2dd4bf',
  '14b8a6',
  '0d9488',
  '0f766e',
  '115e59',
  '134e4a',
  '042f2e',
  // secondary (coral)
  'fdf0f0',
  'fbe1e2',
  'f8c3c5',
  'f4a6a7',
  'f1888a',
  'ed6a6d',
  'be5557',
  '8e4041',
  '5f2a2c',
  '2f1516',
  '180b0b',
  // accent (gold) — 400/500/600 double as status.warning
  'fffbeb',
  'fef3c7',
  'fde68a',
  'fcd34d',
  'fbbf24',
  'f59e0b',
  'd97706',
  'b45309',
  '92400e',
  '78350f',
  '451a03',
  // neutral
  'fafafa',
  'f5f5f5',
  'e5e5e5',
  'd4d4d4',
  'a3a3a3',
  '737373',
  '525252',
  '404040',
  '262626',
  '171717',
  '0a0a0a',
  // status.success / error / info
  '10b981',
  '059669',
  '047857',
  'f87171',
  'ef4444',
  'dc2626',
  '38bdf8',
  '0ea5e9',
  '0284c7',
];

// Trailing (?:[0-9a-f]{2})? also catches token + alpha suffix (e.g. '#F59E0B1F').
const TOKEN_HEX_PATTERN = `^#(?:${TOKEN_HEXES.join('|')})(?:[0-9a-f]{2})?$`;

export const designTokens = {
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector: `Literal[value=/${TOKEN_HEX_PATTERN}/i]`,
        message:
          'Hardcoded hex duplicates a @rallia/design-system color token — import the token (primary/secondary/accent/neutral/status) instead. See packages/design-system/src/tokens/colors.ts.',
      },
    ],
  },
};
