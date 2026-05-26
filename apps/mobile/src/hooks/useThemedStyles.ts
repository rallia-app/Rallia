import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { useThemeStyles, type ThemeColors } from '@rallia/shared-hooks/src/useThemeStyles.native';

type ThemeShadows = ReturnType<typeof useThemeStyles>['shadows'];

export interface ThemedStylesContext {
  colors: ThemeColors;
  shadows: ThemeShadows;
  isDark: boolean;
}

/**
 * Builds a theme-aware StyleSheet from a factory, memoized per active theme.
 *
 * Replaces the `style={[styles.x, { color: colors.y }]}` pattern: put theme
 * colors directly inside the stylesheet so call sites stay `style={styles.x}`.
 * The active `colors` are also returned for non-style props (e.g. icon colors).
 *
 * Define the factory at module scope (stable identity) so the StyleSheet is
 * only rebuilt when the theme actually changes.
 *
 * @example
 * const makeStyles = ({ colors }: ThemedStylesContext) =>
 *   StyleSheet.create({
 *     card: { backgroundColor: colors.cardBackground, borderColor: colors.border },
 *     title: { color: colors.foreground, fontSize: 18 },
 *   });
 *
 * function Card() {
 *   const { styles, colors } = useThemedStyles(makeStyles);
 *   return (
 *     <View style={styles.card}>
 *       <Icon color={colors.foreground} />
 *     </View>
 *   );
 * }
 */
export function useThemedStyles<T extends StyleSheet.NamedStyles<T>>(
  factory: (ctx: ThemedStylesContext) => T
): ThemedStylesContext & { styles: T } {
  const { colors, shadows, isDark } = useThemeStyles();
  const styles = useMemo(
    () => factory({ colors, shadows, isDark }),
    [factory, colors, shadows, isDark]
  );
  return { styles, colors, shadows, isDark };
}
