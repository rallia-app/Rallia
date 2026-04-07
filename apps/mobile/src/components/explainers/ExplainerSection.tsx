import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';

interface ExplainerSectionProps {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  iconBackgroundColor: string;
  title: string;
  children: React.ReactNode;
  isDark: boolean;
  textColor: string;
  mutedColor: string;
}

export const ExplainerSection: React.FC<ExplainerSectionProps> = ({
  icon,
  iconColor,
  iconBackgroundColor,
  title,
  children,
  textColor,
}) => {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={[styles.iconCircle, { backgroundColor: iconBackgroundColor }]}>
          <Ionicons name={icon} size={18} color={iconColor} />
        </View>
        <Text size="base" weight="semibold" color={textColor} style={styles.sectionTitle}>
          {title}
        </Text>
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
};

const styles = StyleSheet.create({
  section: {
    marginBottom: spacingPixels[5],
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacingPixels[2],
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: radiusPixels.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacingPixels[2],
  },
  sectionTitle: {
    flex: 1,
  },
  sectionBody: {
    paddingLeft: 32 + spacingPixels[2],
  },
});
