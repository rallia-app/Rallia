/**
 * ReportUserModal
 * Modal for reporting a user with reason selection and optional description
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import ActionSheet, { SheetManager, SheetProps, ScrollView } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { useThemeStyles, useTranslation } from '../../../hooks';
import { createUserReport, type ReportReason, REPORT_REASON_LABELS } from '@rallia/shared-services';
import { radiusPixels, primary, status, spacingPixels } from '@rallia/design-system';

const REPORT_REASONS: ReportReason[] = [
  'inappropriate_behavior',
  'harassment',
  'spam',
  'cheating',
  'other',
];

export function ReportUserActionSheet({ payload }: SheetProps<'report-user'>) {
  const reporterId = payload?.reporterId ?? '';
  const reportedId = payload?.reportedId ?? '';
  const reportedName = payload?.reportedName ?? '';
  const conversationId = payload?.conversationId;

  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();

  const [selectedReason, setSelectedReason] = useState<ReportReason | null>(null);
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleClose = useCallback(() => {
    setSelectedReason(null);
    setDescription('');
    SheetManager.hide('report-user');
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!selectedReason) {
      Alert.alert(t('common.error'), t('chat.report.pleaseSelectReason'));
      return;
    }

    setIsSubmitting(true);
    try {
      await createUserReport({
        reporterId,
        reportedId,
        reason: selectedReason,
        description: description.trim() || undefined,
        conversationId,
      });

      Alert.alert(t('chat.report.submitted'), t('chat.report.thankYou'), [
        { text: t('common.ok'), onPress: handleClose },
      ]);
    } catch (error) {
      Alert.alert(
        t('common.error'),
        error instanceof Error ? error.message : t('chat.report.failedToSubmit')
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedReason, description, reporterId, reportedId, conversationId, handleClose, t]);

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={[styles.sheetBackground, { backgroundColor: colors.cardBackground }]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
    >
      <View style={styles.modalContent}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Text weight="semibold" size="lg" style={{ color: colors.text }}>
            {t('chat.report.reportUser', { name: reportedName })}
          </Text>
          <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
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
          {/* Warning text */}
          <View
            style={[
              styles.warningBox,
              {
                backgroundColor: isDark ? 'rgba(245, 158, 11, 0.15)' : 'rgba(245, 158, 11, 0.1)',
              },
            ]}
          >
            <Ionicons name="warning-outline" size={20} color={status.warning.DEFAULT} />
            <Text
              size="sm"
              style={{
                color: isDark ? status.warning.light : status.warning.dark,
                flex: 1,
                marginLeft: 8,
              }}
            >
              {t('chat.report.warningText')}
            </Text>
          </View>

          {/* Reason selection */}
          <Text weight="medium" style={{ color: colors.text, marginBottom: 12, marginTop: 16 }}>
            {t('chat.report.selectReason')}
          </Text>

          {REPORT_REASONS.map(reason => (
            <TouchableOpacity
              key={reason}
              style={[
                styles.reasonOption,
                {
                  backgroundColor:
                    selectedReason === reason
                      ? isDark
                        ? primary[900]
                        : primary[50]
                      : isDark
                        ? '#2C2C2E'
                        : '#F2F2F7',
                  borderColor: selectedReason === reason ? primary[500] : 'transparent',
                },
              ]}
              onPress={() => setSelectedReason(reason)}
              activeOpacity={0.7}
            >
              <Text
                style={{
                  color: selectedReason === reason ? primary[500] : colors.text,
                  flex: 1,
                }}
              >
                {REPORT_REASON_LABELS[reason]}
              </Text>
              {selectedReason === reason && (
                <Ionicons name="checkmark-circle-outline" size={20} color={primary[500]} />
              )}
            </TouchableOpacity>
          ))}

          {/* Description input */}
          <Text weight="medium" style={{ color: colors.text, marginBottom: 12, marginTop: 20 }}>
            {t('chat.report.additionalDetails')}
          </Text>
          <TextInput
            style={[
              styles.descriptionInput,
              {
                backgroundColor: isDark ? '#2C2C2E' : '#F2F2F7',
                color: colors.text,
                borderColor: colors.border,
              },
            ]}
            placeholder={t('chat.report.provideContext')}
            placeholderTextColor={colors.textMuted}
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={4}
            maxLength={500}
          />
          <Text size="xs" style={{ color: colors.textMuted, textAlign: 'right', marginTop: 4 }}>
            {description.length}/500
          </Text>
        </ScrollView>

        {/* Sticky footer */}
        <View style={[styles.footer, { borderTopColor: colors.border }]}>
          <TouchableOpacity
            style={[
              styles.submitButton,
              {
                backgroundColor: selectedReason ? status.error.DEFAULT : colors.textMuted,
                opacity: isSubmitting ? 0.6 : 1,
              },
            ]}
            onPress={handleSubmit}
            disabled={!selectedReason || isSubmitting}
            activeOpacity={0.8}
          >
            {isSubmitting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="flag-outline" size={18} color="#fff" style={{ marginRight: 8 }} />
                <Text size="lg" weight="semibold" color="#fff">
                  Submit Report
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </ActionSheet>
  );
}

// Keep old export for backwards compatibility during migration
export const ReportUserModal = ReportUserActionSheet;

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
    padding: spacingPixels[4],
    borderBottomWidth: 1,
  },
  closeButton: {
    padding: spacingPixels[1],
  },
  contentContainer: {
    flex: 1,
  },
  scrollContent: {
    padding: spacingPixels[4],
    paddingBottom: spacingPixels[4],
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: radiusPixels.md,
  },
  reasonOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: radiusPixels.md,
    marginBottom: 8,
    borderWidth: 2,
  },
  descriptionInput: {
    borderRadius: radiusPixels.md,
    padding: 12,
    minHeight: 100,
    borderWidth: 1,
    fontSize: 14,
  },
  footer: {
    padding: spacingPixels[4],
    borderTopWidth: 1,
    paddingBottom: spacingPixels[4],
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
