/**
 * Typography Components Usage Examples
 *
 * This file demonstrates how to use the Text and Heading components
 * from the shared-components package.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Heading } from '@rallia/shared-components';
import { colors } from '../theme';

export const TypographyExamples: React.FC = () => {
  return (
    <View style={styles.container}>
      {/* Heading Examples */}
      <Heading level={1}>Main Page Title</Heading>
      <Heading level={2} color={colors.primary}>
        Section Title
      </Heading>
      <Heading level={3}>Subsection</Heading>
      <Heading level={4} align="center">
        Centered Heading
      </Heading>

      {/* Text Variants */}
      <Text variant="body">This is regular body text with normal weight and size.</Text>

      <Text variant="caption">This is caption text, smaller and lighter in color.</Text>

      <Text variant="label">This is label text</Text>

      {/* Text Weights */}
      <Text weight="regular">Regular weight text</Text>
      <Text weight="medium">Medium weight text</Text>
      <Text weight="semibold">Semibold weight text</Text>
      <Text weight="bold">Bold weight text</Text>

      {/* Text Sizes */}
      <Text size="xs">Extra small text</Text>
      <Text size="sm">Small text</Text>
      <Text size="base">Base size text</Text>
      <Text size="lg">Large text</Text>
      <Text size="xl">Extra large text</Text>

      {/* Text Decorations */}
      <Text italic>Italic text</Text>
      <Text underline>Underlined text</Text>
      <Text strikethrough>Strikethrough text</Text>

      {/* Text Alignment */}
      <Text align="left">Left aligned text</Text>
      <Text align="center">Center aligned text</Text>
      <Text align="right">Right aligned text</Text>

      {/* Custom Colors */}
      <Text color={colors.primary}>Primary colored text</Text>
      <Text color={colors.accent}>Accent colored text</Text>
      <Text color={colors.success}>Success colored text</Text>
      <Text color={colors.error}>Error colored text</Text>

      {/* Combined Props */}
      <Text size="lg" weight="bold" color={colors.primary} align="center">
        Large, bold, centered, primary text
      </Text>

      {/* Real-world Example: Card Content */}
      <View style={styles.card}>
        <Heading level={3}>Match Details</Heading>
        <Text variant="caption" style={styles.marginTop}>
          Saturday, November 30, 2025
        </Text>
        <Text variant="body" style={styles.marginTop}>
          Join us for an exciting tennis match at the community center.
        </Text>
        <Text size="sm" color={colors.primary} weight="semibold" style={styles.marginTop}>
          8 players registered
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 12,
  },
  card: {
    backgroundColor: colors.white,
    padding: 16,
    borderRadius: 8,
    marginTop: 16,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  marginTop: {
    marginTop: 8,
  },
});

export default TypographyExamples;
