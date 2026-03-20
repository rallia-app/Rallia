/**
 * RespondToReferenceOverlay Component
 *
 * Overlay for responding to a reference request.
 * Allows users to:
 * - View the requester's profile info
 * - See the claimed rating they're asked to validate
 * - Approve (support) or decline the rating
 * - Add an optional message
 *
 * UX Design:
 * - Clear visual hierarchy showing who's asking and what they claim
 * - Easy approve/decline buttons with haptic feedback
 * - Optional message for context
 * - Confirmation before submitting
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Image,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Animated,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Overlay, Text, useToast } from '@rallia/shared-components';
import { supabase, Logger } from '@rallia/shared-services';
import { selectionHaptic, successHaptic, errorHaptic } from '@rallia/shared-utils';
import { useThemeStyles, useTranslation } from '../../../hooks';
import { CertificationBadge } from './CertificationBadge';
import {
  spacingPixels,
  radiusPixels,
  fontSizePixels,
  fontWeightNumeric,
  status,
} from '@rallia/design-system';

interface ReferenceRequest {
  id: string;
  requester_id: string;
  player_rating_score_id: string;
  message: string | null;
  status: 'pending' | 'completed' | 'declined' | 'expired' | 'cancelled';
  expires_at: string;
  created_at: string;
  requester: {
    id: string;
    first_name: string;
    last_name: string;
    display_name: string | null;
    profile_picture_url: string | null;
  };
  rating_info: {
    label: string;
    value: number | null;
    sport_name: string;
    sport_display_name: string;
  };
}

interface RespondToReferenceOverlayProps {
  visible: boolean;
  onClose: () => void;
  request: ReferenceRequest;
  onResponseComplete: () => void;
}

export const RespondToReferenceOverlay: React.FC<RespondToReferenceOverlayProps> = ({
  visible,
  onClose,
  request,
  onResponseComplete,
}) => {
  const { colors } = useThemeStyles();
  const { t } = useTranslation();
  const toast = useToast();

  const [responseMessage, setResponseMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [selectedResponse, setSelectedResponse] = useState<'approve' | 'decline' | null>(null);

  // Animation
  const scaleAnim = useRef(new Animated.Value(0.9)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setSelectedResponse(null);
      setResponseMessage('');

      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue: 1,
          tension: 100,
          friction: 10,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, scaleAnim, fadeAnim]);

  const handleSelectResponse = (response: 'approve' | 'decline') => {
    selectionHaptic();
    setSelectedResponse(response);
  };

  const handleSubmit = async () => {
    if (!selectedResponse) {
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

      onResponseComplete();
    } catch (error) {
      Logger.error('Failed to submit reference response', error as Error, {
        requestId: request.id,
      });
      errorHaptic();
      toast.error(t('referenceRequest.failedToSubmit'));
    } finally {
      setSubmitting(false);
    }
  };

  const requesterName = `${request.requester.first_name} ${request.requester.last_name}`;

  return (
    <Overlay
      visible={visible}
      onClose={onClose}
      type="bottom"
      showBackButton={false}
      showCloseButton={true}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <Animated.View
          style={[
            styles.container,
            {
              opacity: fadeAnim,
              transform: [{ scale: scaleAnim }],
            },
          ]}
        >
          {/* Title */}
          <Text style={[styles.title, { color: colors.text }]}>
            {t('referenceRequest.respondTitle')}
          </Text>
          <Text style={[styles.subtitle, { color: colors.textMuted }]}>
            {t('referenceRequest.respondSubtitle')}
          </Text>

          {/* Requester Card */}
          <View style={[styles.requesterCard, { backgroundColor: colors.inputBackground }]}>
            <View style={styles.requesterHeader}>
              {request.requester.profile_picture_url ? (
                <Image
                  source={{ uri: request.requester.profile_picture_url }}
                  style={styles.avatar}
                />
              ) : (
                <View
                  style={[
                    styles.avatar,
                    styles.avatarPlaceholder,
                    { backgroundColor: colors.card },
                  ]}
                >
                  <Ionicons name="person-outline" size={24} color={colors.textMuted} />
                </View>
              )}
              <View style={styles.requesterInfo}>
                <Text style={[styles.requesterName, { color: colors.text }]}>{requesterName}</Text>
                <Text style={[styles.sportLabel, { color: colors.textSecondary }]}>
                  {request.rating_info.sport_display_name}
                </Text>
              </View>
            </View>

            {/* Claimed Rating */}
            <View style={[styles.claimedRating, { backgroundColor: colors.card }]}>
              <View style={styles.claimedRatingHeader}>
                <Text style={[styles.claimedLabel, { color: colors.textMuted }]}>
                  {t('referenceRequest.claimsToBeRated')}
                </Text>
                <CertificationBadge status="self_declared" size="sm" />
              </View>
              <View style={styles.ratingDisplay}>
                <Text style={[styles.ratingBig, { color: colors.primary }]}>
                  {request.rating_info.label}
                </Text>
                {request.rating_info.value && (
                  <Text style={[styles.ratingSmall, { color: colors.textSecondary }]}>
                    ({request.rating_info.value.toFixed(1)})
                  </Text>
                )}
              </View>
            </View>

            {/* Requester's Message */}
            {request.message && (
              <View style={styles.messageFromRequester}>
                <Ionicons name="chatbubble-outline" size={14} color={colors.textMuted} />
                <Text style={[styles.requesterMessage, { color: colors.textSecondary }]}>
                  "{request.message}"
                </Text>
              </View>
            )}
          </View>

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

          {/* Submit Button */}
          <TouchableOpacity
            style={[
              styles.submitButton,
              {
                backgroundColor: selectedResponse ? colors.primary : colors.border,
              },
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
              <>
                <Ionicons
                  name="paper-plane-outline"
                  size={18}
                  color={selectedResponse ? colors.primaryForeground : colors.textMuted}
                />
                <Text
                  style={[
                    styles.submitButtonText,
                    { color: selectedResponse ? colors.primaryForeground : colors.textMuted },
                  ]}
                >
                  {t('referenceRequest.submitResponse')}
                </Text>
              </>
            )}
          </TouchableOpacity>

          {/* Privacy note */}
          <Text style={[styles.privacyNote, { color: colors.textMuted }]}>
            {t('referenceRequest.privacyNote')}
          </Text>
        </Animated.View>
      </KeyboardAvoidingView>
    </Overlay>
  );
};

const styles = StyleSheet.create({
  keyboardView: {
    width: '100%',
  },
  container: {
    paddingBottom: spacingPixels[6],
  },
  title: {
    fontSize: fontSizePixels.xl,
    fontWeight: fontWeightNumeric.bold,
    textAlign: 'center',
    marginBottom: spacingPixels[1],
  },
  subtitle: {
    fontSize: fontSizePixels.sm,
    textAlign: 'center',
    marginBottom: spacingPixels[5],
  },
  requesterCard: {
    borderRadius: radiusPixels.xl,
    padding: spacingPixels[4],
    marginBottom: spacingPixels[4],
  },
  requesterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
    marginBottom: spacingPixels[3],
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  avatarPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  requesterInfo: {
    flex: 1,
  },
  requesterName: {
    fontSize: fontSizePixels.lg,
    fontWeight: fontWeightNumeric.semibold,
  },
  sportLabel: {
    fontSize: fontSizePixels.sm,
    marginTop: 2,
  },
  claimedRating: {
    borderRadius: radiusPixels.lg,
    padding: spacingPixels[3],
  },
  claimedRatingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacingPixels[1],
  },
  claimedLabel: {
    fontSize: fontSizePixels.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  ratingDisplay: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacingPixels[2],
  },
  ratingBig: {
    fontSize: fontSizePixels['2xl'],
    fontWeight: fontWeightNumeric.bold,
  },
  ratingSmall: {
    fontSize: fontSizePixels.base,
  },
  messageFromRequester: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacingPixels[2],
    marginTop: spacingPixels[3],
    paddingTop: spacingPixels[3],
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
  },
  requesterMessage: {
    flex: 1,
    fontSize: fontSizePixels.sm,
    fontStyle: 'italic',
    lineHeight: 20,
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
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[2],
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    marginBottom: spacingPixels[3],
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

export default RespondToReferenceOverlay;
