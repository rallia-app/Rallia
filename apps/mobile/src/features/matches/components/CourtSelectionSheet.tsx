/**
 * Court Selection Sheet
 *
 * Modal for selecting which court to book when multiple courts
 * are available at the same time slot.
 */

import React, { useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import ActionSheet, { SheetManager, SheetProps } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import { lightHaptic, successHaptic } from '@rallia/shared-utils';
import { useThemeStyles, useTranslation, type TranslationKey } from '../../../hooks';
import { useSport } from '../../../context';
import { SportIcon } from '../../../components/SportIcon';
import type { CourtOption } from '@rallia/shared-hooks';

// =============================================================================
// COURT ITEM COMPONENT
// =============================================================================

interface CourtItemProps {
  court: CourtOption;
  onPress: () => void;
  colors: {
    text: string;
    textMuted: string;
    border: string;
    buttonActive: string;
    buttonInactive: string;
  };
  t: (key: TranslationKey) => string;
}

const CourtItem: React.FC<CourtItemProps> = ({ court, onPress, colors, t }) => {
  const { selectedSport } = useSport();
  // Display translated "Court X" if we have a court number, otherwise fallback to raw name
  const displayName =
    court.courtNumber !== undefined
      ? t('matchCreation.booking.courtNumber').replace('{number}', String(court.courtNumber))
      : court.courtName;

  return (
    <TouchableOpacity
      style={[
        styles.courtItem,
        { backgroundColor: colors.buttonInactive, borderColor: colors.border },
      ]}
      onPress={() => {
        lightHaptic();
        onPress();
      }}
      activeOpacity={0.7}
    >
      <View style={[styles.courtIconContainer, { backgroundColor: `${colors.buttonActive}20` }]}>
        <SportIcon
          sportName={selectedSport?.name ?? 'tennis'}
          size={20}
          color={colors.buttonActive}
        />
      </View>
      <View style={styles.courtInfo}>
        <Text size="base" weight="medium" color={colors.text} numberOfLines={2}>
          {displayName}
        </Text>
        {court.price !== undefined && court.price > 0 && (
          <Text size="sm" color={colors.textMuted}>
            ${court.price.toFixed(2)}
          </Text>
        )}
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
    </TouchableOpacity>
  );
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function CourtSelectionActionSheet({ payload }: SheetProps<'court-selection'>) {
  const courts = (payload?.courts ?? []) as CourtOption[];
  const timeLabel = payload?.timeLabel ?? '';
  const onSelect = payload?.onSelect;
  const onCancel = payload?.onCancel;

  const { colors } = useThemeStyles();
  const { t } = useTranslation();

  const handleSelect = useCallback(
    (court: CourtOption) => {
      successHaptic();
      onSelect?.(court);
      SheetManager.hide('court-selection');
    },
    [onSelect]
  );

  const handleCancel = useCallback(() => {
    lightHaptic();
    onCancel?.();
    SheetManager.hide('court-selection');
  }, [onCancel]);

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={[styles.sheetContainer, { backgroundColor: colors.cardBackground }]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
    >
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View style={styles.headerCenter}>
          <Text size="lg" weight="semibold" color={colors.text}>
            {t('matchCreation.booking.selectCourt')}
          </Text>
          <Text size="sm" color={colors.textMuted}>
            {timeLabel} • {courts.length}{' '}
            {courts.length === 1
              ? t('matchCreation.booking.courtAvailable')
              : t('matchCreation.booking.courtsAvailable')}
          </Text>
        </View>
        <TouchableOpacity
          onPress={handleCancel}
          style={styles.closeButton}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="close-outline" size={24} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Court list */}
      <ScrollView
        contentContainerStyle={styles.courtListContent}
        showsVerticalScrollIndicator={false}
      >
        {courts.map((court, index) => (
          <CourtItem
            key={`${court.facilityScheduleId}-${index}`}
            court={court}
            onPress={() => handleSelect(court)}
            colors={colors}
            t={t}
          />
        ))}
      </ScrollView>

      {/* Footer */}
      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <TouchableOpacity
          style={[styles.cancelButton, { backgroundColor: colors.buttonInactive }]}
          onPress={handleCancel}
          activeOpacity={0.8}
        >
          <Text size="base" weight="medium" color={colors.textSecondary}>
            {t('common.cancel')}
          </Text>
        </TouchableOpacity>
      </View>
    </ActionSheet>
  );
}

// Keep old export for backwards compatibility during migration
export const CourtSelectionSheet = CourtSelectionActionSheet;

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  sheetContainer: {
    borderTopLeftRadius: radiusPixels['2xl'],
    borderTopRightRadius: radiusPixels['2xl'],
  },
  handleIndicator: {
    width: spacingPixels[10],
    height: 4,
    borderRadius: 4,
    alignSelf: 'center',
  },
  header: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacingPixels[4],
    borderBottomWidth: 1,
    position: 'relative',
  },
  headerCenter: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButton: {
    padding: spacingPixels[1],
    position: 'absolute',
    right: spacingPixels[4],
  },
  courtListContent: {
    padding: spacingPixels[4],
  },
  courtItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    marginBottom: spacingPixels[2],
    gap: spacingPixels[3],
  },
  courtIconContainer: {
    width: 40,
    height: 40,
    borderRadius: radiusPixels.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  courtInfo: {
    flex: 1,
  },
  footer: {
    padding: spacingPixels[4],
    borderTopWidth: 1,
  },
  cancelButton: {
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default CourtSelectionSheet;
