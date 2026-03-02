/**
 * Report Issue Sheet
 *
 * An action sheet component for reporting issues with an opponent.
 * Opens from within the opponent feedback step without losing feedback state.
 * Uses react-native-actions-sheet for consistent sheet behavior.
 */

import React, { useState, useCallback, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator, TextInput } from 'react-native';
import ActionSheet, { SheetManager, SheetProps, ScrollView } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import { lightHaptic, selectionHaptic } from '@rallia/shared-utils';
import type { MatchReportReasonEnum } from '@rallia/shared-types';
import { REPORT_REASON_ICONS } from '@rallia/shared-types';
import { useThemeStyles, useTranslation } from '../../../../hooks';
import type { TranslationKey } from '../../../../hooks/useTranslation';

// =============================================================================
// CONSTANTS
// =============================================================================

const REPORT_REASONS: Array<{
  value: MatchReportReasonEnum;
  labelKey: string;
}> = [
  { value: 'harassment', labelKey: 'matchFeedback.report.reasons.harassment' },
  { value: 'unsportsmanlike', labelKey: 'matchFeedback.report.reasons.unsportsmanlike' },
  { value: 'safety', labelKey: 'matchFeedback.report.reasons.safety' },
  { value: 'misrepresented_level', labelKey: 'matchFeedback.report.reasons.misrepresented_level' },
  { value: 'inappropriate', labelKey: 'matchFeedback.report.reasons.inappropriate' },
];

// =============================================================================
// REASON CARD COMPONENT
// =============================================================================

interface ReasonCardProps {
  reason: MatchReportReasonEnum;
  label: string;
  selected: boolean;
  onPress: () => void;
  colors: {
    buttonActive: string;
    buttonInactive: string;
    border: string;
    textMuted: string;
    text: string;
  };
}

const ReasonCard: React.FC<ReasonCardProps> = ({ reason, label, selected, onPress, colors }) => {
  const iconName = REPORT_REASON_ICONS[reason] as keyof typeof Ionicons.glyphMap;

  return (
    <TouchableOpacity
      style={[
        styles.reasonCard,
        {
          backgroundColor: selected ? `${colors.buttonActive}15` : colors.buttonInactive,
          borderColor: selected ? colors.buttonActive : colors.border,
        },
      ]}
      onPress={() => {
        selectionHaptic();
        onPress();
      }}
      activeOpacity={0.7}
    >
      <Ionicons
        name={iconName}
        size={20}
        color={selected ? colors.buttonActive : colors.textMuted}
      />
      <Text
        size="sm"
        weight={selected ? 'semibold' : 'regular'}
        color={selected ? colors.buttonActive : colors.text}
        style={styles.reasonLabel}
      >
        {label}
      </Text>
      {selected && <Ionicons name="checkmark-circle" size={18} color={colors.buttonActive} />}
    </TouchableOpacity>
  );
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function ReportIssueActionSheet({ payload }: SheetProps<'report-issue'>) {
  const opponentName = payload?.opponentName ?? '';
  const onSubmit = payload?.onSubmit;
  const isSubmitting = payload?.isSubmitting ?? false;

  const { colors } = useThemeStyles();
  const { t } = useTranslation();

  const [selectedReason, setSelectedReason] = useState<MatchReportReasonEnum | null>(null);
  const [details, setDetails] = useState('');

  const handleClose = useCallback(() => {
    lightHaptic();
    setSelectedReason(null);
    setDetails('');
    SheetManager.hide('report-issue');
  }, []);

  const handleSubmit = useCallback(() => {
    if (!selectedReason) return;
    onSubmit?.(selectedReason, details.trim() || undefined);
  }, [selectedReason, details, onSubmit]);

  const canSubmit = useMemo(() => selectedReason !== null, [selectedReason]);

  const title = t('matchFeedback.report.title').replace('{name}', opponentName);

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={[styles.sheetBackground, { backgroundColor: colors.cardBackground }]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
    >
      <View style={styles.modalContent}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={styles.headerSpacer} />
          <Text size="lg" weight="semibold" color={colors.text}>
            {title}
          </Text>
          <TouchableOpacity
            onPress={handleClose}
            style={styles.closeButton}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
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
          {/* Reason Selection */}
          <View style={styles.section}>
            <Text
              size="sm"
              weight="semibold"
              color={colors.textSecondary}
              style={styles.sectionLabel}
            >
              {t('matchFeedback.report.selectReason')}
            </Text>
            <View style={styles.reasonsGrid}>
              {REPORT_REASONS.map(reason => (
                <ReasonCard
                  key={reason.value}
                  reason={reason.value}
                  label={t(reason.labelKey as TranslationKey)}
                  selected={selectedReason === reason.value}
                  onPress={() => setSelectedReason(reason.value)}
                  colors={colors}
                />
              ))}
            </View>
          </View>

          {/* Details Input */}
          <View style={styles.section}>
            <Text
              size="sm"
              weight="semibold"
              color={colors.textSecondary}
              style={styles.sectionLabel}
            >
              {t('matchFeedback.report.detailsLabel')}
            </Text>
            <TextInput
              style={[
                styles.detailsInput,
                {
                  borderColor: colors.border,
                  backgroundColor: colors.buttonInactive,
                  color: colors.text,
                },
              ]}
              value={details}
              onChangeText={setDetails}
              placeholder={t('matchFeedback.report.detailsPlaceholder')}
              placeholderTextColor={colors.textMuted}
              multiline
              numberOfLines={4}
              maxLength={500}
            />
            <Text size="xs" color={colors.textMuted} style={styles.characterCount}>
              {details.length}/500
            </Text>
          </View>
        </ScrollView>

        {/* Footer */}
        <View style={[styles.footer, { borderTopColor: colors.border }]}>
          <TouchableOpacity
            style={[
              styles.submitButton,
              {
                backgroundColor:
                  canSubmit && !isSubmitting ? colors.buttonActive : colors.buttonInactive,
              },
            ]}
            onPress={handleSubmit}
            disabled={!canSubmit || isSubmitting}
            activeOpacity={0.8}
          >
            {isSubmitting ? (
              <ActivityIndicator color={colors.buttonTextActive} />
            ) : (
              <Text
                size="lg"
                weight="semibold"
                color={canSubmit ? colors.buttonTextActive : colors.textMuted}
              >
                {t('matchFeedback.report.submit')}
              </Text>
            )}
          </TouchableOpacity>
        </View>
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
  handleIndicator: {
    width: spacingPixels[10],
    height: 4,
    borderRadius: 4,
    alignSelf: 'center',
  },
  modalContent: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[4],
    borderBottomWidth: 1,
  },
  closeButton: {
    padding: spacingPixels[1],
    width: 40,
    alignItems: 'flex-end',
  },
  headerSpacer: {
    width: 40,
  },
  contentContainer: {
    flex: 1,
  },
  scrollContent: {
    padding: spacingPixels[4],
    paddingBottom: spacingPixels[4],
  },
  section: {
    marginBottom: spacingPixels[6],
  },
  sectionLabel: {
    marginBottom: spacingPixels[3],
  },
  reasonsGrid: {
    gap: spacingPixels[2],
  },
  reasonCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    gap: spacingPixels[3],
  },
  reasonLabel: {
    flex: 1,
  },
  detailsInput: {
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    fontSize: 16,
    minHeight: 120,
    textAlignVertical: 'top',
  },
  characterCount: {
    textAlign: 'right',
    marginTop: spacingPixels[1],
  },
  footer: {
    padding: spacingPixels[4],
    borderTopWidth: 1,
    paddingBottom: spacingPixels[8],
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    gap: spacingPixels[2],
  },
});

export default ReportIssueActionSheet;
