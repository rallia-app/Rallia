import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import {
  spacingPixels,
  radiusPixels,
  fontSizePixels,
  fontWeightNumeric,
} from '@rallia/design-system';
import type { CompletenessTier, CompletenessItem } from '@rallia/shared-hooks';

import { getTierColors } from '#/features/profile/completionTierColors';

import ProfileCompletionRing from './ProfileCompletionRing';

// =============================================================================
// PROPS
// =============================================================================

interface ProfileCompletionChecklistProps {
  percentage: number;
  tier: CompletenessTier;
  items: CompletenessItem[];
  isComplete: boolean;
  loading: boolean;
  onAction: (item: CompletenessItem) => void;
  colors: {
    card: string;
    text: string;
    textMuted: string;
    border: string;
    primary: string;
    background: string;
  };
  isDark: boolean;
  t: (key: string, options?: Record<string, string | number | boolean>) => string;
}

// =============================================================================
// COMPONENT
// =============================================================================

const ProfileCompletionChecklist: React.FC<ProfileCompletionChecklistProps> = ({
  percentage,
  tier,
  items,
  isComplete,
  loading,
  onAction,
  colors,
  isDark,
  t,
}) => {
  const tierColors = getTierColors(tier, isDark);

  if (loading) return null;

  if (isComplete) return null;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>
          {t('profileCompletion.title')}
        </Text>
      </View>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {/* Progress header */}
        <View style={styles.progressHeader}>
          <ProfileCompletionRing
            percentage={percentage}
            size={48}
            strokeWidth={5}
            color={tierColors.accent}
            trackColor={tierColors.trackColor}
            labelColor={colors.text}
          />
          <View style={styles.progressInfo}>
            <Text size="base" weight="bold" style={{ color: colors.text }}>
              {t('profileCompletion.percentComplete', { percentage })}
            </Text>
            <Text size="sm" style={{ color: colors.textMuted }}>
              {t(`profileCompletion.tiers.${tier}`)}
            </Text>
          </View>
        </View>

        {/* Progress bar */}
        <View style={[styles.progressBarTrack, { backgroundColor: tierColors.trackColor }]}>
          <View
            style={[
              styles.progressBarFill,
              {
                backgroundColor: tierColors.accent,
                width: `${Math.min(100, percentage)}%`,
              },
            ]}
          />
        </View>

        {/* Checklist items */}
        <View style={styles.checklistContainer}>
          {items.map((item, index) => {
            const isLast = index === items.length - 1;
            return (
              <TouchableOpacity
                key={item.key}
                style={[
                  styles.checklistItem,
                  !isLast && { borderBottomWidth: 1, borderBottomColor: colors.border },
                ]}
                onPress={() => !item.completed && onAction(item)}
                activeOpacity={item.completed ? 1 : 0.7}
                disabled={item.completed}
              >
                <Ionicons
                  name={item.completed ? 'checkmark-circle' : 'ellipse-outline'}
                  size={22}
                  color={item.completed ? tierColors.accent : colors.textMuted}
                />
                <Text
                  size="sm"
                  style={[
                    styles.checklistLabel,
                    {
                      color: item.completed ? colors.textMuted : colors.text,
                      textDecorationLine: item.completed ? 'line-through' : 'none',
                    },
                  ]}
                >
                  {t(item.labelKey)}
                </Text>
                {!item.completed && (
                  <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </View>
  );
};

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  section: {
    marginTop: spacingPixels[5],
    paddingHorizontal: spacingPixels[4],
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacingPixels[3],
  },
  sectionTitle: {
    fontSize: fontSizePixels.xs,
    fontWeight: fontWeightNumeric.bold,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  card: {
    borderRadius: radiusPixels.xl,
    padding: spacingPixels[4],
    borderWidth: 1,
  },
  progressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
    marginBottom: spacingPixels[3],
  },
  progressInfo: {
    flex: 1,
    gap: spacingPixels[0.5],
  },
  progressBarTrack: {
    height: 6,
    borderRadius: 3,
    marginBottom: spacingPixels[3],
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  checklistContainer: {},
  checklistItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacingPixels[2.5],
    gap: spacingPixels[2.5],
  },
  checklistLabel: {
    flex: 1,
  },
});

export default ProfileCompletionChecklist;
