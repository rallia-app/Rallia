/**
 * MatchInviteConfirmSheet
 *
 * One-tap confirmation sheet opened by the morning digest email's "Send invite"
 * CTA. The email encodes a (opponent, facility, sport, date, start, end) — by
 * the time the user taps, that slot may have been booked elsewhere, so the
 * sheet calls `validate_and_create_match_from_email_invite` to atomically
 * re-validate and create the match in the same transaction.
 *
 * On caller_busy / opponent_busy the sheet swaps to an error state offering a
 * "See other suggestions" CTA that opens the existing match-suggestions sheet.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from 'react-native';
import ActionSheet, { SheetManager, SheetProps } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { Text, useToast } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, primary, neutral } from '@rallia/design-system';
import {
  errorHaptic,
  lightHaptic,
  successHaptic,
  getProfilePictureUrl,
} from '@rallia/shared-utils';
import { Logger, supabase } from '@rallia/shared-services';
import { topSuggestionKeys, justForYouKeys } from '@rallia/shared-hooks';

import { useThemeStyles, useTranslation } from '#/hooks';
import { formatTimeOfDay } from '#/utils/dateFormatting';

export interface MatchInviteConfirmPayload {
  opponentId: string;
  facilityId: string;
  sportId: string;
  matchDate: string; // YYYY-MM-DD
  startTime: string; // HH:MM:SS
  endTime: string; // HH:MM:SS
}

interface ConfirmRpcResult {
  success: boolean;
  match_id?: string;
  reason?: 'caller_busy' | 'opponent_busy' | 'facility_unavailable';
}

type SheetStatus = 'idle' | 'sending' | 'sent' | 'error';

interface OpponentSummary {
  firstName: string | null;
  lastName: string | null;
  avatar: string | null;
}

interface FacilitySummary {
  name: string | null;
  city: string | null;
}

function formatSummary(matchDate: string, startTime: string, locale: string): string {
  const dateObj = new Date(`${matchDate}T${startTime}`);
  const date = dateObj.toLocaleDateString(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const time = formatTimeOfDay(dateObj, locale);
  return `${date} · ${time}`;
}

export function MatchInviteConfirmActionSheet(props: SheetProps<'match-invite-confirm'>) {
  const { colors, isDark } = useThemeStyles();
  const { t, locale } = useTranslation();
  const { success: toastSuccess } = useToast();
  const queryClient = useQueryClient();
  const payload = props.payload;

  const [status, setStatus] = useState<SheetStatus>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [opponent, setOpponent] = useState<OpponentSummary | null>(null);
  const [facility, setFacility] = useState<FacilitySummary | null>(null);

  // Fetch a tiny summary so the sheet can render the opponent name + facility.
  // Public columns only (first_name, last_name, profile_picture_url, name, city).
  useEffect(() => {
    if (!payload) return;
    let cancelled = false;
    (async () => {
      const [profileResp, facilityResp] = await Promise.all([
        supabase
          .from('profile')
          .select('first_name, last_name, profile_picture_url')
          .eq('id', payload.opponentId)
          .maybeSingle(),
        supabase.from('facility').select('name, city').eq('id', payload.facilityId).maybeSingle(),
      ]);
      if (cancelled) return;
      if (profileResp.data) {
        setOpponent({
          firstName: (profileResp.data as { first_name: string | null }).first_name,
          lastName: (profileResp.data as { last_name: string | null }).last_name,
          avatar:
            getProfilePictureUrl(
              (profileResp.data as { profile_picture_url: string | null }).profile_picture_url
            ) ?? null,
        });
      }
      if (facilityResp.data) {
        setFacility({
          name: (facilityResp.data as { name: string | null }).name,
          city: (facilityResp.data as { city: string | null }).city,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [payload]);

  const opponentName = useMemo(() => {
    if (!opponent) return '';
    const first = opponent.firstName ?? '';
    const lastInitial = opponent.lastName ? opponent.lastName.charAt(0) + '.' : '';
    return `${first} ${lastInitial}`.trim();
  }, [opponent]);

  const subtitle = useMemo(() => {
    if (!payload) return '';
    const facilityLabel = facility?.name ?? '';
    const dateTime = formatSummary(payload.matchDate, payload.startTime, locale);
    if (opponentName && facilityLabel) {
      return t('inviteConfirmSheet.subtitleWithOpponent', {
        opponentName,
        facility: facilityLabel,
        dateTime,
      });
    }
    return t('inviteConfirmSheet.subtitle');
  }, [payload, facility, opponentName, locale, t]);

  const handleConfirm = useCallback(async () => {
    if (!payload || status === 'sending' || status === 'sent') return;
    setStatus('sending');
    setErrorMsg(null);

    try {
      const { data: caller } = await supabase.auth.getUser();
      const callerId = caller.user?.id;
      if (!callerId) {
        setStatus('error');
        setErrorMsg(t('inviteConfirmSheet.errorMessage'));
        errorHaptic();
        return;
      }

      const { data, error } = await supabase.rpc('validate_and_create_match_from_email_invite', {
        p_caller_id: callerId,
        p_opponent_id: payload.opponentId,
        p_sport_id: payload.sportId,
        p_facility_id: payload.facilityId,
        p_match_date: payload.matchDate,
        p_start_time: payload.startTime,
        p_end_time: payload.endTime,
        p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });

      if (error) {
        Logger.error('match-invite confirm rpc failed', error);
        setStatus('error');
        setErrorMsg(t('inviteConfirmSheet.errorMessage'));
        errorHaptic();
        return;
      }

      const result = data as ConfirmRpcResult;
      if (!result?.success) {
        const reason = result?.reason;
        const msg =
          reason === 'caller_busy'
            ? t('inviteConfirmSheet.callerBusyMessage')
            : t('inviteConfirmSheet.opponentBusyMessage');
        setStatus('error');
        setErrorMsg(msg);
        errorHaptic();
        return;
      }

      successHaptic();
      setStatus('sent');
      toastSuccess(t('inviteConfirmSheet.successToast'));
      queryClient.invalidateQueries({ queryKey: ['matches', 'list', 'player'] });
      queryClient.invalidateQueries({ queryKey: ['matches', 'list', 'nearby'] });
      queryClient.invalidateQueries({ queryKey: topSuggestionKeys.all });
      queryClient.invalidateQueries({ queryKey: justForYouKeys.all });
      // Brief delay so the user perceives the success state before dismiss.
      setTimeout(() => {
        SheetManager.hide('match-invite-confirm');
      }, 600);
    } catch (err) {
      Logger.error(
        'match-invite confirm threw',
        err instanceof Error ? err : new Error(String(err))
      );
      setStatus('error');
      setErrorMsg(t('inviteConfirmSheet.errorMessage'));
      errorHaptic();
    }
  }, [payload, status, toastSuccess, queryClient, t]);

  const handleCancel = useCallback(() => {
    lightHaptic();
    SheetManager.hide('match-invite-confirm');
  }, []);

  const handleSeeOtherSuggestions = useCallback(async () => {
    lightHaptic();
    await SheetManager.hide('match-invite-confirm');
    await SheetManager.show('match-suggestions');
  }, []);

  if (!payload) return null;

  const accent = isDark ? primary[400] : primary[500];

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={{ backgroundColor: colors.background }}
      indicatorStyle={{ backgroundColor: isDark ? neutral[600] : neutral[300] }}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <Ionicons name="send" size={22} color={accent} />
          <Text size="xl" weight="bold" color={colors.foreground} style={styles.title}>
            {t('inviteConfirmSheet.title')}
          </Text>
        </View>

        <Text size="sm" color={colors.textMuted} style={styles.subtitle}>
          {subtitle}
        </Text>

        {status === 'error' && errorMsg && (
          <View
            style={[
              styles.errorBanner,
              { backgroundColor: isDark ? '#7f1d1d44' : '#fee2e2', borderColor: '#dc2626' },
            ]}
          >
            <Ionicons name="alert-circle" size={16} color="#dc2626" />
            <Text size="sm" color="#dc2626" style={styles.errorText}>
              {errorMsg}
            </Text>
          </View>
        )}

        <View style={styles.actions}>
          {status === 'error' ? (
            <TouchableOpacity
              style={[styles.button, styles.primaryButton, { backgroundColor: accent }]}
              onPress={handleSeeOtherSuggestions}
              activeOpacity={0.8}
            >
              <Text size="sm" weight="bold" color="#ffffff">
                {t('inviteConfirmSheet.seeOtherSuggestions')}
              </Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[
                styles.button,
                styles.primaryButton,
                { backgroundColor: accent, opacity: status === 'sending' ? 0.7 : 1 },
              ]}
              onPress={handleConfirm}
              disabled={status === 'sending' || status === 'sent'}
              activeOpacity={0.8}
            >
              {status === 'sending' ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text size="sm" weight="bold" color="#ffffff">
                  {status === 'sent'
                    ? t('inviteConfirmSheet.successToast')
                    : t('inviteConfirmSheet.confirmButton')}
                </Text>
              )}
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[
              styles.button,
              styles.secondaryButton,
              { borderColor: isDark ? neutral[600] : neutral[300] },
            ]}
            onPress={handleCancel}
            activeOpacity={0.7}
          >
            <Text size="sm" weight="semibold" color={colors.foreground}>
              {t('inviteConfirmSheet.cancelButton')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </ActionSheet>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacingPixels[5],
    paddingTop: spacingPixels[4],
    paddingBottom: spacingPixels[6],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    marginBottom: spacingPixels[2],
  },
  title: {
    flexShrink: 1,
  },
  subtitle: {
    marginBottom: spacingPixels[4],
    lineHeight: 20,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    padding: spacingPixels[3],
    borderRadius: radiusPixels.md,
    borderWidth: 1,
    marginBottom: spacingPixels[4],
  },
  errorText: {
    flexShrink: 1,
  },
  actions: {
    gap: spacingPixels[3],
  },
  button: {
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[5],
    borderRadius: radiusPixels.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  primaryButton: {
    // colored at runtime via accent
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
  },
});

export default MatchInviteConfirmActionSheet;
