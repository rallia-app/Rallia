/**
 * ReportFacilitySheet
 * Action sheet for reporting inaccurate facility information.
 * Styled to match MatchCreationWizard / FeedbackSheet design language.
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  ScrollView,
} from 'react-native';
import ActionSheet, { SheetManager, SheetProps } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text, useToast } from '@rallia/shared-components';
import { useTheme } from '@rallia/shared-hooks';
import { useTranslation } from '../../../hooks';
import { createFacilityReport, type FacilityReportReason } from '@rallia/shared-services';
import {
  lightTheme,
  darkTheme,
  radiusPixels,
  primary,
  neutral,
  base,
  spacingPixels,
  status,
} from '@rallia/design-system';
import { selectionHaptic, lightHaptic } from '@rallia/shared-utils';

// =============================================================================
// TYPES
// =============================================================================

interface ThemeColors {
  cardBackground: string;
  text: string;
  textMuted: string;
  border: string;
  muted: string;
  buttonActive: string;
  buttonInactive: string;
  buttonTextActive: string;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const REASON_ICONS: Record<FacilityReportReason, keyof typeof Ionicons.glyphMap> = {
  wrong_address: 'location-outline',
  incorrect_hours: 'time-outline',
  wrong_court_count: 'grid-outline',
  wrong_surface_types: 'layers-outline',
  outdated_contact_info: 'call-outline',
  wrong_amenities: 'list-outline',
  other: 'ellipsis-horizontal-circle-outline',
};

const REASONS: FacilityReportReason[] = [
  'wrong_address',
  'incorrect_hours',
  'wrong_court_count',
  'wrong_surface_types',
  'outdated_contact_info',
  'wrong_amenities',
  'other',
];

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function ReportFacilityActionSheet({ payload }: SheetProps<'report-facility'>) {
  const reporterId = payload?.reporterId ?? '';
  const facilityId = payload?.facilityId ?? '';
  const facilityName = payload?.facilityName ?? '';

  const { theme } = useTheme();
  const { t } = useTranslation();
  const toast = useToast();
  const isDark = theme === 'dark';

  // Theme colors — same pattern as MatchCreationWizard & FeedbackSheet
  const themeColors = isDark ? darkTheme : lightTheme;
  const colors = useMemo<ThemeColors>(
    () => ({
      cardBackground: themeColors.card,
      text: themeColors.foreground,
      textMuted: themeColors.mutedForeground,
      border: themeColors.border,
      muted: themeColors.muted,
      buttonActive: isDark ? primary[500] : primary[600],
      buttonInactive: themeColors.muted,
      buttonTextActive: base.white,
    }),
    [themeColors, isDark]
  );

  const [selectedReason, setSelectedReason] = useState<FacilityReportReason | null>(null);
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleClose = useCallback(() => {
    lightHaptic();
    setSelectedReason(null);
    setDescription('');
    SheetManager.hide('report-facility');
  }, []);

  const handleSelectReason = useCallback((reason: FacilityReportReason) => {
    selectionHaptic();
    setSelectedReason(reason);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!selectedReason) return;

    setIsSubmitting(true);
    try {
      await createFacilityReport({
        reporterId,
        facilityId,
        reason: selectedReason,
        description: description.trim() || undefined,
      });

      // Close and reset
      setSelectedReason(null);
      setDescription('');
      SheetManager.hide('report-facility');

      toast.success(t('facilityDetail.reportFacility.successMessage'));
    } catch (error) {
      const message =
        error instanceof Error && error.message === 'DUPLICATE_REPORT'
          ? t('facilityDetail.reportFacility.errorDuplicate')
          : t('facilityDetail.reportFacility.errorGeneric');
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedReason, description, reporterId, facilityId, t]);

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={[
        styles.sheetBackground,
        styles.container,
        { backgroundColor: colors.cardBackground },
      ]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
    >
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        {/* Badge — mirrors the sport badge in MatchCreationWizard */}
        <View style={[styles.badge, { backgroundColor: status.warning.DEFAULT }]}>
          <Ionicons name="flag" size={14} color={base.white} />
          <Text size="sm" weight="semibold" color={base.white}>
            {t('facilityDetail.reportFacility.title')}
          </Text>
        </View>

        {/* Close button on the right */}
        <TouchableOpacity onPress={handleClose} style={styles.closeButton} activeOpacity={0.7}>
          <Ionicons name="close-outline" size={24} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Scrollable content */}
      <ScrollView
        style={styles.contentContainer}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Facility name + description */}
        <Text weight="bold" size="lg" style={{ color: colors.text, marginBottom: 4 }}>
          {facilityName}
        </Text>
        <Text size="sm" style={{ color: colors.textMuted, marginBottom: spacingPixels[4] }}>
          {t('facilityDetail.reportFacility.description')}
        </Text>

        {/* Reason selection */}
        <Text weight="semibold" style={{ color: colors.text, marginBottom: spacingPixels[3] }}>
          {t('facilityDetail.reportFacility.selectReason')}
        </Text>

        <View style={styles.reasonCards}>
          {REASONS.map(reason => {
            const isSelected = selectedReason === reason;
            return (
              <TouchableOpacity
                key={reason}
                style={[
                  styles.reasonOption,
                  {
                    backgroundColor: isSelected
                      ? `${colors.buttonActive}15`
                      : colors.buttonInactive,
                    borderColor: isSelected ? colors.buttonActive : colors.border,
                  },
                ]}
                onPress={() => handleSelectReason(reason)}
                activeOpacity={0.7}
              >
                <View
                  style={[
                    styles.reasonIconContainer,
                    {
                      backgroundColor: isSelected ? colors.buttonActive : colors.border,
                    },
                  ]}
                >
                  <Ionicons
                    name={REASON_ICONS[reason]}
                    size={22}
                    color={isSelected ? colors.buttonTextActive : colors.textMuted}
                  />
                </View>
                <Text
                  weight={isSelected ? 'semibold' : 'regular'}
                  style={{
                    color: isSelected ? colors.buttonActive : colors.text,
                    flex: 1,
                  }}
                >
                  {t(`facilityDetail.reportFacility.reasons.${reason}` as Parameters<typeof t>[0])}
                </Text>
                {isSelected && (
                  <Ionicons name="checkmark-circle" size={22} color={colors.buttonActive} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Description input */}
        <Text
          weight="semibold"
          style={{
            color: colors.text,
            marginBottom: spacingPixels[3],
            marginTop: spacingPixels[5],
          }}
        >
          {t('facilityDetail.reportFacility.additionalDetails')}
        </Text>
        <TextInput
          style={[
            styles.descriptionInput,
            {
              backgroundColor: isDark ? neutral[800] : neutral[50],
              color: colors.text,
              borderColor: colors.border,
            },
          ]}
          placeholder={t('facilityDetail.reportFacility.detailsPlaceholder')}
          placeholderTextColor={colors.textMuted}
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={4}
          maxLength={500}
        />
        <Text
          size="xs"
          style={{ color: colors.textMuted, textAlign: 'right', marginTop: spacingPixels[1] }}
        >
          {description.length}/500
        </Text>
      </ScrollView>

      {/* Footer — matches MatchCreationWizard footer */}
      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <TouchableOpacity
          style={[
            styles.submitButton,
            {
              backgroundColor: selectedReason ? colors.buttonActive : colors.buttonInactive,
            },
            isSubmitting && styles.buttonDisabled,
          ]}
          onPress={handleSubmit}
          disabled={!selectedReason || isSubmitting}
          activeOpacity={0.8}
        >
          {isSubmitting ? (
            <ActivityIndicator size="small" color={colors.buttonTextActive} />
          ) : (
            <>
              <Text
                size="lg"
                weight="semibold"
                color={selectedReason ? colors.buttonTextActive : colors.buttonActive}
              >
                {t('facilityDetail.reportFacility.submit')}
              </Text>
              <Ionicons
                name="arrow-forward-outline"
                size={20}
                color={selectedReason ? colors.buttonTextActive : colors.buttonActive}
              />
            </>
          )}
        </TouchableOpacity>
      </View>
    </ActionSheet>
  );
}

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  sheetBackground: {
    flex: 1,
    borderTopLeftRadius: radiusPixels['2xl'],
    borderTopRightRadius: radiusPixels['2xl'],
  },
  container: {
    flex: 1,
  },
  handleIndicator: {
    width: spacingPixels[10],
    height: 4,
    borderRadius: 4,
    alignSelf: 'center',
  },

  // Header — mirrors CreateGroupModal header
  header: {
    position: 'relative' as const,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    borderBottomWidth: 1,
  },
  closeButton: {
    position: 'absolute' as const,
    right: 16,
    padding: spacingPixels[1],
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[1.5],
    borderRadius: radiusPixels.full,
    gap: spacingPixels[1.5],
  },

  // Content
  contentContainer: {
    flex: 1,
  },
  scrollContent: {
    padding: spacingPixels[4],
    paddingBottom: spacingPixels[6],
  },
  reasonCards: {
    gap: spacingPixels[3],
  },
  reasonOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacingPixels[4],
    borderRadius: radiusPixels.xl,
    borderWidth: 1,
    gap: spacingPixels[3],
  },
  reasonIconContainer: {
    width: 44,
    height: 44,
    borderRadius: radiusPixels.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  descriptionInput: {
    borderRadius: radiusPixels.lg,
    padding: spacingPixels[3],
    minHeight: 100,
    borderWidth: 1,
    fontSize: 14,
    textAlignVertical: 'top',
  },

  // Footer — matches MatchCreationWizard footer
  footer: {
    padding: spacingPixels[4],
    borderTopWidth: 1,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    gap: spacingPixels[2],
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
