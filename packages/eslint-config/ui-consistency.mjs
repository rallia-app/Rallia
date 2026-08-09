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
  },
};

export const uiConsistency = {
  plugins: { 'rallia-ui': uiConsistencyPlugin },
  rules: {
    'rallia-ui/no-raw-hex-color': 'warn',
    'rallia-ui/no-hand-rolled-button': 'warn',
  },
};
