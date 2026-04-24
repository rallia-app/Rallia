import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text, Button } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';

interface ReferenceRequestsBannerProps {
  count: number;
  onPress: () => void;
  colors: { card: string; text: string; primary: string; border: string };
  t: (key: string, options?: Record<string, string | number | boolean>) => string;
}

const ReferenceRequestsBanner: React.FC<ReferenceRequestsBannerProps> = ({
  count,
  onPress,
  colors,
  t,
}) => (
  <View style={[styles.container, { backgroundColor: colors.card, borderColor: colors.border }]}>
    <View style={styles.content}>
      <Ionicons
        name="checkmark-circle-outline"
        size={20}
        color={colors.primary}
        style={styles.icon}
      />
      <Text size="sm" color={colors.text} style={styles.text} numberOfLines={2}>
        {t('referenceRequest.pendingCount', { count })}
      </Text>
    </View>
    <Button variant="primary" size="xs" onPress={onPress}>
      {t('referenceRequest.reviewCta')}
    </Button>
  </View>
);

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: spacingPixels[4],
    marginTop: spacingPixels[3],
    marginBottom: spacingPixels[2],
    padding: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: spacingPixels[2],
  },
  icon: {
    marginRight: spacingPixels[2],
  },
  text: {
    flex: 1,
  },
});

export default ReferenceRequestsBanner;
