// UI-consistency enforcement (see root CLAUDE.md and specs/design-system/button-audit.md):
// generic elements must come from the shared component registry, styled by design
// tokens — not hand-rolled per screen. Both rules ship at 'warn' (same ratchet
// convention as the React Compiler rules): ~954 inline overrides and 142 hex-color
// files predate them, so 'error' would drown CI. Burn down opportunistically when
// touching a screen, then ratchet.
//
// A separate plugin (not extra no-restricted-syntax selectors) because flat-config
// rule options replace rather than merge across layers — adding selectors in a
// scoped override would clobber design-tokens.mjs's ratcheted 'error' rule.

import { TOKEN_HEX_PATTERN } from './design-tokens.mjs';

const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const TOKEN_HEX = new RegExp(TOKEN_HEX_PATTERN, 'i');

const BANNED_INLINE_PROPS = new Set(['backgroundColor', 'borderRadius']);
const TOUCHABLES = new Set(['TouchableOpacity', 'Pressable', 'AnimatedPressable']);

// Anything that scrolls its own content, plus the scaffolds that wrap one and
// apply the inset themselves.
const SCROLLABLES = new Set([
  'ScrollView',
  'FlatList',
  'SectionList',
  'VirtualizedList',
  'KeyboardAwareScrollView',
  'EventListScaffold',
]);

/** `Animated.FlatList` reports as `FlatList`. */
const elementName = node => {
  if (!node) return null;
  if (node.type === 'JSXIdentifier') return node.name;
  if (node.type === 'JSXMemberExpression') return elementName(node.property);
  return null;
};

// Scrollables hide behind conditionals, `.map`s and render helpers, so this
// walks the whole subtree rather than just JSX children.
const hasScrollableDescendant = node => {
  let found = false;
  const walk = value => {
    if (found || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const entry of value) walk(entry);
      return;
    }
    if (
      value.type === 'JSXOpeningElement' &&
      SCROLLABLES.has(elementName(value.name) ?? '')
    ) {
      found = true;
      return;
    }
    for (const key of Object.keys(value)) {
      if (key === 'parent') continue;
      walk(value[key]);
    }
  };
  for (const child of node.children ?? []) walk(child);
  return found;
};

// Collects Property nodes named backgroundColor/borderRadius anywhere inside a
// style expression: {…}, [a, b], cond ? a : b, cond && {…}.
const collectBannedProps = (node, out) => {
  if (!node) return;
  switch (node.type) {
    case 'ObjectExpression':
      for (const prop of node.properties) {
        if (
          prop.type === 'Property' &&
          !prop.computed &&
          BANNED_INLINE_PROPS.has(prop.key.name ?? prop.key.value)
        ) {
          out.push(prop);
        }
      }
      break;
    case 'ArrayExpression':
      for (const element of node.elements) collectBannedProps(element, out);
      break;
    case 'ConditionalExpression':
      collectBannedProps(node.consequent, out);
      collectBannedProps(node.alternate, out);
      break;
    case 'LogicalExpression':
      collectBannedProps(node.left, out);
      collectBannedProps(node.right, out);
      break;
  }
};

const uiConsistencyPlugin = {
  meta: { name: 'rallia-ui' },
  rules: {
    'no-raw-hex-color': {
      meta: {
        type: 'suggestion',
        docs: {
          description:
            'Disallow raw hex color literals; colors come from @rallia/design-system tokens or useThemeStyles()',
        },
        messages: {
          rawHex:
            "Raw hex color '{{value}}' — use @rallia/design-system tokens or useThemeStyles() colors instead (root CLAUDE.md, \"UI consistency\").",
        },
        schema: [],
      },
      create(context) {
        return {
          Literal(node) {
            if (
              typeof node.value === 'string' &&
              HEX_COLOR.test(node.value) &&
              // Token-valued hexes are already an 'error' via design-tokens.mjs.
              !TOKEN_HEX.test(node.value)
            ) {
              context.report({ node, messageId: 'rawHex', data: { value: node.value } });
            }
          },
        };
      },
    },
    'no-hand-rolled-button': {
      meta: {
        type: 'suggestion',
        docs: {
          description:
            'Disallow inline backgroundColor/borderRadius on touchables; use Button/IconButton from @rallia/shared-components',
        },
        messages: {
          handRolled:
            'Hand-styled touchable — use Button or IconButton from @rallia/shared-components (extend the shared component if a variant is missing) instead of inline {{prop}}.',
        },
        schema: [],
      },
      create(context) {
        return {
          JSXOpeningElement(node) {
            if (node.name.type !== 'JSXIdentifier' || !TOUCHABLES.has(node.name.name)) return;
            const styleAttr = node.attributes.find(
              attr => attr.type === 'JSXAttribute' && attr.name.name === 'style'
            );
            if (styleAttr?.value?.type !== 'JSXExpressionContainer') return;
            const banned = [];
            collectBannedProps(styleAttr.value.expression, banned);
            for (const prop of banned) {
              context.report({
                node: prop,
                messageId: 'handRolled',
                data: { prop: prop.key.name ?? prop.key.value },
              });
            }
          },
        };
      },
    },
    // A SafeAreaView that claims the bottom edge pads the inset onto the
    // wrapper. When it wraps a scrollable, that is wrong twice over: the padded
    // wrapper crops the scroll viewport so rows stop above the home indicator
    // instead of scrolling under it, and it stacks with the inset the list
    // already carries in contentContainerStyle (useScrollBottomInset), leaving
    // a dead band at the bottom. The scroll wrapper takes edges={[]}; only the
    // non-scrolling branches (loading, error, empty) claim the bottom edge.
    'no-double-bottom-inset': {
      meta: {
        type: 'problem',
        docs: {
          description:
            "Disallow edges={['bottom']} on a SafeAreaView wrapping a scrollable; the inset belongs in contentContainerStyle",
        },
        messages: {
          doubleInset:
            "SafeAreaView claims the bottom edge around a scrollable — the inset belongs in the list's contentContainerStyle via useScrollBottomInset, not on the wrapper. Padding the wrapper crops the scroll viewport and double-pads the bottom. Use edges={[]} here (root CLAUDE.md, \"Styling specifics\").",
        },
        schema: [],
      },
      create(context) {
        // Only the true double-count is an error: the file already applies the
        // inset to its scroll content, so the wrapper claiming it as well is
        // unambiguously padding twice. A wrapper that pads without the hook is
        // a different (softer) call and stays out of scope here.
        let appliesContentInset = false;
        const candidates = [];
        return {
          Identifier(node) {
            if (node.name === 'useScrollBottomInset') appliesContentInset = true;
          },
          JSXElement(node) {
            if (elementName(node.openingElement.name) !== 'SafeAreaView') return;
            const edgesAttr = node.openingElement.attributes.find(
              attr => attr.type === 'JSXAttribute' && attr.name.name === 'edges'
            );
            if (edgesAttr?.value?.type !== 'JSXExpressionContainer') return;
            const edges = edgesAttr.value.expression;
            if (edges.type !== 'ArrayExpression') return;
            const claimsBottom = edges.elements.some(
              el => el?.type === 'Literal' && el.value === 'bottom'
            );
            if (!claimsBottom || !hasScrollableDescendant(node)) return;
            candidates.push(edgesAttr);
          },
          'Program:exit'() {
            if (!appliesContentInset) return;
            for (const node of candidates) {
              context.report({ node, messageId: 'doubleInset' });
            }
          },
        };
      },
    },
  },
};

export const uiConsistency = {
  plugins: { 'rallia-ui': uiConsistencyPlugin },
  rules: {
    'rallia-ui/no-raw-hex-color': 'warn',
    'rallia-ui/no-hand-rolled-button': 'warn',
    // No pre-existing offenders once MyEvents is fixed, so this one starts at
    // 'error' rather than joining the 'warn' ratchet.
    'rallia-ui/no-double-bottom-inset': 'error',
  },
};
