/**
 * RespondToReferenceOverlay Component
 *
 * ActionSheet for responding to a reference request.
 * Allows users to:
 * - View the requester's profile info
 * - See the claimed rating they're asked to validate
 * - Approve (support) or decline the rating
 * - Add an optional message
 */

import React, { useState, useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity, TextInput, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ActionSheet, { SheetManager, SheetProps, ScrollView } from 'react-native-actions-sheet';
import { Text, useToast } from '@rallia/shared-components';
import { supabase, Logger, notifyReferenceRequestResponded } from '@rallia/shared-services';
import { selectionHaptic, successHaptic, errorHaptic } from '@rallia/shared-utils';
import {
  spacingPixels,
  radiusPixels,
  fontSizePixels,
  fontWeightNumeric,
  status,
} from '@rallia/design-system';

import { useThemeStyles, useTranslation } from '#/hooks';

export function RespondToReferenceActionSheet({ payload }: SheetProps<'respond-to-reference'>) {
  const request = payload?.request;
  const onResponseComplete = payload?.onResponseComplete;

  const { colors } = useThemeStyles();
  const { t } = useTranslation();
  const toast = useToast();

  const [responseMessage, setResponseMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [selectedResponse, setSelectedResponse] = useState<'approve' | 'decline' | null>(null);

  const onClose = useCallback(() => {
    SheetManager.hide('respond-to-reference');
  }, []);

  const handleBeforeClose = useCallback(() => {
    setSelectedResponse(null);
    setResponseMessage('');
  }, []);

  const handleSelectResponse = (response: 'approve' | 'decline') => {
    selectionHaptic();
    setSelectedResponse(response);
  };

  const handleSubmit = async () => {
    if (!selectedResponse || !request) {
      Alert.alert(t('alerts.error'), t('referenceRequest.selectResponse'));
      return;
    }

    setSubmitting(true);

    try {
      const isApproved = selectedResponse === 'approve';
      const newStatus = isApproved ? 'completed' : 'declined';

      const { error } = await supabase
        .from('rating_reference_request')
        .update({
          status: newStatus,
          rating_supported: isApproved,
          response_message: responseMessage.trim() || null,
          responded_at: new Date().toISOString(),
        })
        .eq('id', request.id);

      if (error) throw error;

      if (isApproved) {
        successHaptic();
        toast.success(t('referenceRequest.responseSubmittedApprove'));
      } else {
        errorHaptic();
        toast.info(t('referenceRequest.responseSubmittedDecline'));
      }

      Logger.logUserAction('respond_to_reference_request', {
        requestId: request.id,
        response: selectedResponse,
        hasMessage: !!responseMessage.trim(),
      });

      // Send notification to the requester (fire and forget)
      (async () => {
        try {
          const { data: currentUser } = await supabase.auth.getUser();
          const { data: myProfile } = await supabase
            .from('profile')
            .select('first_name, last_name, display_name')
            .eq('id', currentUser?.user?.id ?? '')
            .single();

          const refereeName = myProfile
            ? `${myProfile.first_name || ''} ${myProfile.last_name || ''}`.trim() ||
              myProfile.display_name ||
              'A player'
            : 'A player';

          await notifyReferenceRequestResponded(
            request.requester_id,
            request.id,
            refereeName,
            request.rating_info.sport_display_name,
            newStatus,
            request.rating_info.label,
            isApproved,
            responseMessage.trim() || null
          );
        } catch (err) {
          Logger.error('Failed to send reference response notification', err as Error);
        }
      })();

      onClose();
      onResponseComplete?.();
    } catch (error) {
      Logger.error('Failed to submit reference response', error as Error, {
        requestId: request?.id,
      });
      errorHaptic();
      toast.error(t('referenceRequest.failedToSubmit'));
    } finally {
      setSubmitting(false);
    }
  };

  if (!request) return null;

  return (
    <ActionSheet
      gestureEnabled={!submitting}
      containerStyle={[styles.sheetBackground, { backgroundColor: colors.cardBackground }]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
      onBeforeClose={handleBeforeClose}
    >
      <View style={styles.modalContent}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={styles.headerCenter}>
            <Text weight="semibold" size="lg" style={{ color: colors.text }} numberOfLines={1}>
              {t('referenceRequest.respondTitle')}
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Ionicons name="close-outline" size={24} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Scrollable Content */}
        <ScrollView
          style={styles.scrollContent}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Question */}
          <Text style={[styles.question, { color: colors.text }]}>
            {t('referenceRequest.question', { name: request.requester.first_name })}
          </Text>

          {/* Response Options */}
          <View style={styles.responseOptions}>
            <TouchableOpacity
              style={[
                styles.responseOption,
                { backgroundColor: colors.inputBackground, borderColor: colors.border },
                selectedResponse === 'approve' && {
                  backgroundColor: status.success.DEFAULT + '15',
                  borderColor: status.success.DEFAULT,
                },
              ]}
              onPress={() => handleSelectResponse('approve')}
              activeOpacity={0.7}
            >
              <View
                style={[
                  styles.responseIcon,
                  {
                    backgroundColor:
                      selectedResponse === 'approve' ? status.success.DEFAULT : colors.card,
                  },
                ]}
              >
                <Ionicons
                  name="checkmark"
                  size={24}
                  color={selectedResponse === 'approve' ? '#fff' : colors.textMuted}
                />
              </View>
              <Text
                style={[
                  styles.responseLabel,
                  { color: selectedResponse === 'approve' ? status.success.DEFAULT : colors.text },
                ]}
              >
                {t('referenceRequest.yesApprove')}
              </Text>
              <Text style={[styles.responseDescription, { color: colors.textMuted }]}>
                {t('referenceRequest.approveDescription')}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.responseOption,
                { backgroundColor: colors.inputBackground, borderColor: colors.border },
                selectedResponse === 'decline' && {
                  backgroundColor: status.error.DEFAULT + '15',
                  borderColor: status.error.DEFAULT,
                },
              ]}
              onPress={() => handleSelectResponse('decline')}
              activeOpacity={0.7}
            >
              <View
                style={[
                  styles.responseIcon,
                  {
                    backgroundColor:
                      selectedResponse === 'decline' ? status.error.DEFAULT : colors.card,
                  },
                ]}
              >
                <Ionicons
                  name="close"
                  size={24}
                  color={selectedResponse === 'decline' ? '#fff' : colors.textMuted}
                />
              </View>
              <Text
                style={[
                  styles.responseLabel,
                  { color: selectedResponse === 'decline' ? status.error.DEFAULT : colors.text },
                ]}
              >
                {t('referenceRequest.noDecline')}
              </Text>
              <Text style={[styles.responseDescription, { color: colors.textMuted }]}>
                {t('referenceRequest.declineDescription')}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Optional Message */}
          <View style={styles.messageSection}>
            <Text style={[styles.messageLabel, { color: colors.textMuted }]}>
              {t('referenceRequest.addMessage')} ({t('common.optional')})
            </Text>
            <TextInput
              style={[
                styles.messageInput,
                {
                  backgroundColor: colors.inputBackground,
                  color: colors.text,
                  borderColor: colors.border,
                },
              ]}
              value={responseMessage}
              onChangeText={setResponseMessage}
              placeholder={t('referenceRequest.messagePlaceholder')}
              placeholderTextColor={colors.textMuted}
              multiline
              maxLength={250}
              numberOfLines={3}
            />
            <Text style={[styles.charCount, { color: colors.textMuted }]}>
              {responseMessage.length}/250
            </Text>
          </View>

          <Text style={[styles.privacyNote, { color: colors.textMuted }]}>
            {t('referenceRequest.privacyNote')}
          </Text>
        </ScrollView>

        {/* Sticky Footer */}
        <View style={[styles.footer, { borderTopColor: colors.border }]}>
          <TouchableOpacity
            style={[
              styles.submitButton,
              { backgroundColor: colors.primary },
              (!selectedResponse || submitting) && { opacity: 0.6 },
            ]}
            onPress={handleSubmit}
            disabled={!selectedResponse || submitting}
            activeOpacity={0.8}
          >
            {submitting ? (
              <Text style={[styles.submitButtonText, { color: colors.primaryForeground }]}>
                {t('common.submitting')}
              </Text>
            ) : (
              <Text style={[styles.submitButtonText, { color: colors.primaryForeground }]}>
                {t('referenceRequest.submitResponse')}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </ActionSheet>
  );
}

const styles = StyleSheet.create({
  sheetBackground: {
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
    maxHeight: '90%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacingPixels[4],
    borderBottomWidth: 1,
    position: 'relative',
    minHeight: 56,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: spacingPixels[12],
  },
  closeButton: {
    padding: spacingPixels[1],
    position: 'absolute',
    right: spacingPixels[4],
    zIndex: 1,
  },
  scrollContent: {
    flexGrow: 0,
  },
  content: {
    padding: spacingPixels[4],
    paddingBottom: spacingPixels[6],
  },
  question: {
    fontSize: fontSizePixels.base,
    fontWeight: fontWeightNumeric.semibold,
    textAlign: 'center',
    marginBottom: spacingPixels[4],
  },
  responseOptions: {
    flexDirection: 'row',
    gap: spacingPixels[3],
    marginBottom: spacingPixels[4],
  },
  responseOption: {
    flex: 1,
    alignItems: 'center',
    padding: spacingPixels[4],
    borderRadius: radiusPixels.xl,
    borderWidth: 2,
  },
  responseIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacingPixels[2],
  },
  responseLabel: {
    fontSize: fontSizePixels.base,
    fontWeight: fontWeightNumeric.semibold,
    marginBottom: spacingPixels[1],
  },
  responseDescription: {
    fontSize: fontSizePixels.xs,
    textAlign: 'center',
    lineHeight: 16,
  },
  messageSection: {
    marginBottom: spacingPixels[4],
  },
  messageLabel: {
    fontSize: fontSizePixels.sm,
    marginBottom: spacingPixels[2],
  },
  messageInput: {
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    padding: spacingPixels[3],
    fontSize: fontSizePixels.base,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  charCount: {
    fontSize: fontSizePixels.xs,
    textAlign: 'right',
    marginTop: spacingPixels[1],
  },
  footer: {
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[4],
    paddingBottom: spacingPixels[4],
    borderTopWidth: 1,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
    borderRadius: radiusPixels.lg,
  },
  submitButtonText: {
    fontSize: fontSizePixels.base,
    fontWeight: fontWeightNumeric.semibold,
  },
  privacyNote: {
    fontSize: fontSizePixels.xs,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: spacingPixels[4],
  },
});

export default RespondToReferenceActionSheet;
