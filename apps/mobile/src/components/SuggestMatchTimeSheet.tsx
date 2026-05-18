/**
 * SuggestMatchTimeSheet
 *
 * Opened from MatchDetailSheet when a pending invitee or joined participant
 * wants to propose a different start time without committing to the original
 * one (or, if joined, without leaving). The match date and timezone stay
 * pinned to the existing match — only the time-of-day moves. Duration is
 * preserved server-side when the host accepts.
 *
 * If the caller already has a pending suggestion on this match, the sheet
 * opens in "update" mode with a Withdraw secondary action.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SheetManager, SheetProps } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Text, VStack, useToast } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, base, neutral, primary } from '@rallia/design-system';
import { errorHaptic, lightHaptic, successHaptic } from '@rallia/shared-utils';
import { Logger, suggestMatchTime, withdrawTimeSuggestion } from '@rallia/shared-services';

import { BaseActionSheet } from './BaseActionSheet';
import { useThemeStyles, useTranslation } from '../hooks';

const NOTE_MAX = 280;
type SheetStatus = 'idle' | 'sending' | 'sent' | 'error';

function parseTimeToDate(time: string): Date {
  const [hStr, mStr] = time.split(':');
  const d = new Date();
  d.setSeconds(0, 0);
  d.setHours(Number(hStr) || 0, Number(mStr) || 0);
  return d;
}

function formatHHMM(d: Date): string {
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

function formatTimeForDisplay(time: string, locale: string): string {
  const d = parseTimeToDate(time);
  return d.toLocaleTimeString(locale, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: !locale.startsWith('fr'),
  });
}

export function SuggestMatchTimeActionSheet(props: SheetProps<'suggest-match-time'>) {
  const { colors, isDark } = useThemeStyles();
  const { t, locale } = useTranslation();
  const { success: toastSuccess } = useToast();
  const queryClient = useQueryClient();
  const payload = props.payload;

  const initialTime = useMemo(() => {
    if (payload?.existingSuggestionTime) return payload.existingSuggestionTime;
    return payload?.currentStartTime ?? '12:00';
  }, [payload?.existingSuggestionTime, payload?.currentStartTime]);

  const [selectedTime, setSelectedTime] = useState<string>(initialTime);
  const [note, setNote] = useState<string>(payload?.existingNote ?? '');
  const [status, setStatus] = useState<SheetStatus>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [tempTime, setTempTime] = useState<Date>(parseTimeToDate(initialTime));

  // Re-seed local state when the sheet is reused for a different match.
  useEffect(() => {
    setSelectedTime(initialTime);
    setNote(payload?.existingNote ?? '');
    setStatus('idle');
    setErrorMsg(null);
  }, [initialTime, payload?.existingNote, payload?.matchId]);

  const isEditing = !!payload?.existingSuggestionId;
  // Normalize both sides to "HH:MM" — selectedTime is always HH:MM (from the
  // picker) but currentStartTime arrives as HH:MM:SS from Postgres, so a raw
  // string compare would never match.
  const currentTimeHHMM = (payload?.currentStartTime ?? '').slice(0, 5);
  const sameAsCurrent = selectedTime === currentTimeHHMM;

  // Theme tokens for the Button shared-component's themeColors prop. Matches
  // the convention used in ChoosePayoutsSheet.tsx.
  const buttonThemeColors = useMemo(
    () => ({
      primary: colors.primary,
      primaryForeground: base.white,
      buttonActive: colors.primary,
      buttonInactive: isDark ? neutral[700] : neutral[300],
      buttonTextActive: base.white,
      buttonTextInactive: isDark ? neutral[400] : neutral[500],
      text: colors.text,
      textMuted: colors.textMuted,
      border: colors.border,
      background: colors.cardBackground,
    }),
    [colors, isDark]
  );

  const openPicker = useCallback(() => {
    lightHaptic();
    setTempTime(parseTimeToDate(selectedTime));
    setShowPicker(true);
  }, [selectedTime]);

  const handlePickerChange = useCallback((_event: unknown, date?: Date) => {
    if (Platform.OS === 'android') {
      setShowPicker(false);
      if (date) setSelectedTime(formatHHMM(date));
      return;
    }
    if (date) setTempTime(date);
  }, []);

  const handlePickerDone = useCallback(() => {
    setSelectedTime(formatHHMM(tempTime));
    setShowPicker(false);
  }, [tempTime]);

  const handleSubmit = useCallback(async () => {
    if (!payload || status === 'sending') return;
    if (sameAsCurrent) {
      setErrorMsg(t('matchDetail.timeSuggestion.errorGeneric'));
      setStatus('error');
      errorHaptic();
      return;
    }

    setStatus('sending');
    setErrorMsg(null);

    try {
      // "Update" semantics: withdraw the existing pending suggestion first,
      // then insert the new one. Two round-trips, but keeps the partial
      // unique index and the audit trail clean.
      if (isEditing && payload.existingSuggestionId) {
        await withdrawTimeSuggestion(payload.existingSuggestionId);
      }

      await suggestMatchTime({
        matchId: payload.matchId,
        suggestedStartTime: selectedTime,
        note: note.trim() ? note.trim() : null,
      });

      successHaptic();
      setStatus('sent');
      toastSuccess(t('matchDetail.timeSuggestion.submitSuccess'));
      queryClient.invalidateQueries({ queryKey: ['matchTimeSuggestions', payload.matchId] });
      queryClient.invalidateQueries({ queryKey: ['match', payload.matchId] });
      setTimeout(() => {
        SheetManager.hide('suggest-match-time');
      }, 500);
    } catch (err) {
      Logger.error(
        'Suggest match time failed',
        err instanceof Error ? err : new Error(String(err))
      );
      const errMsg = err instanceof Error ? err.message : '';
      const msg =
        errMsg === 'already_pending'
          ? t('matchDetail.timeSuggestion.alreadyPending')
          : errMsg === 'same_as_current_time'
            ? t('matchDetail.timeSuggestion.sameAsCurrent')
            : t('matchDetail.timeSuggestion.errorGeneric');
      setStatus('error');
      setErrorMsg(msg);
      errorHaptic();
    }
  }, [payload, status, sameAsCurrent, isEditing, selectedTime, note, t, toastSuccess, queryClient]);

  const handleWithdraw = useCallback(async () => {
    if (!payload?.existingSuggestionId || status === 'sending') return;
    setStatus('sending');
    setErrorMsg(null);
    try {
      await withdrawTimeSuggestion(payload.existingSuggestionId);
      successHaptic();
      toastSuccess(t('matchDetail.timeSuggestion.withdrawSuccess'));
      queryClient.invalidateQueries({ queryKey: ['matchTimeSuggestions', payload.matchId] });
      SheetManager.hide('suggest-match-time');
    } catch (err) {
      Logger.error(
        'Withdraw suggestion failed',
        err instanceof Error ? err : new Error(String(err))
      );
      setStatus('error');
      setErrorMsg(t('matchDetail.timeSuggestion.errorGeneric'));
      errorHaptic();
    }
  }, [payload, status, toastSuccess, queryClient, t]);

  const handleCancel = useCallback(() => {
    lightHaptic();
    SheetManager.hide('suggest-match-time');
  }, []);

  if (!payload) return null;

  const submitDisabled = status === 'sending' || status === 'sent' || sameAsCurrent;

  return (
    <BaseActionSheet
      title={t('matchDetail.timeSuggestion.sheetTitle')}
      onClose={handleCancel}
      flex={false}
      scrollable
      footer={
        <VStack spacing={spacingPixels[2]}>
          <Button
            variant="primary"
            onPress={handleSubmit}
            disabled={submitDisabled}
            loading={status === 'sending'}
            isDark={isDark}
            themeColors={buttonThemeColors}
            leftIcon={<Ionicons name="paper-plane-outline" size={16} color={base.white} />}
          >
            {isEditing
              ? t('matchDetail.timeSuggestion.submitUpdate')
              : t('matchDetail.timeSuggestion.submit')}
          </Button>

          {isEditing && (
            <Button
              variant="outline"
              onPress={handleWithdraw}
              disabled={status === 'sending'}
              isDark={isDark}
              themeColors={{
                ...buttonThemeColors,
                primary: '#dc2626',
                buttonActive: '#dc2626',
                text: '#dc2626',
              }}
            >
              {t('matchDetail.timeSuggestion.withdraw')}
            </Button>
          )}

          <Button
            variant="ghost"
            onPress={handleCancel}
            isDark={isDark}
            themeColors={buttonThemeColors}
          >
            {t('common.cancel')}
          </Button>
        </VStack>
      }
    >
      <VStack spacing={spacingPixels[4]}>
        <Text size="sm" color={colors.textMuted}>
          {t('matchDetail.timeSuggestion.sheetSubtitle')}
        </Text>

        <View
          style={[
            styles.currentTimeChip,
            { backgroundColor: isDark ? `${primary[500]}14` : `${primary[500]}0A` },
          ]}
        >
          <Ionicons name="information-circle-outline" size={16} color={colors.primary} />
          <Text size="sm" color={colors.primary}>
            {t('matchDetail.timeSuggestion.currentTime', {
              time: formatTimeForDisplay(payload.currentStartTime, locale),
            })}
          </Text>
        </View>

        {/* New time picker */}
        <VStack spacing={spacingPixels[2]}>
          <Text size="sm" weight="semibold" color={colors.textSecondary}>
            {t('matchDetail.timeSuggestion.newTimeLabel')}
          </Text>
          <TouchableOpacity
            style={[
              styles.pickerButton,
              { borderColor: colors.border, backgroundColor: colors.buttonInactive },
            ]}
            onPress={openPicker}
            activeOpacity={0.7}
          >
            <Ionicons name="time-outline" size={20} color={colors.buttonActive} />
            <Text size="base" color={colors.text}>
              {formatTimeForDisplay(selectedTime, locale)}
            </Text>
          </TouchableOpacity>
          {payload.matchTimezone && (
            <Text size="xs" color={colors.textMuted}>
              {t('matchDetail.timeSuggestion.timezoneBanner', { tz: payload.matchTimezone })}
            </Text>
          )}
        </VStack>

        {/* Optional note */}
        <VStack spacing={spacingPixels[2]}>
          <Text size="sm" weight="semibold" color={colors.textSecondary}>
            {t('matchDetail.timeSuggestion.noteLabel')}
          </Text>
          <TextInput
            style={[
              styles.noteInput,
              {
                color: colors.text,
                borderColor: colors.border,
                backgroundColor: colors.buttonInactive,
              },
            ]}
            value={note}
            onChangeText={text => setNote(text.slice(0, NOTE_MAX))}
            placeholder={t('matchDetail.timeSuggestion.notePlaceholder')}
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={NOTE_MAX}
            textAlignVertical="top"
          />
        </VStack>

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
      </VStack>

      {/* Android picker: one-shot dialog rendered inline. */}
      {showPicker && Platform.OS === 'android' && (
        <DateTimePicker
          value={tempTime}
          mode="time"
          display="spinner"
          onChange={handlePickerChange}
          minuteInterval={15}
        />
      )}

      {/* iOS picker: modal sheet on top, matches the convention from
          features/matches/components/steps/WhenFormatStep.tsx. */}
      {Platform.OS === 'ios' && (
        <Modal
          visible={showPicker}
          transparent
          animationType="fade"
          onRequestClose={() => setShowPicker(false)}
        >
          <Pressable style={styles.modalOverlay} onPress={() => setShowPicker(false)}>
            <View style={[styles.pickerModal, { backgroundColor: colors.cardBackground }]}>
              <View style={[styles.pickerHeader, { borderBottomColor: colors.border }]}>
                <TouchableOpacity
                  onPress={() => setShowPicker(false)}
                  style={styles.pickerHeaderButton}
                >
                  <Text size="base" color={colors.textMuted}>
                    {t('common.cancel')}
                  </Text>
                </TouchableOpacity>
                <Text size="base" weight="semibold" color={colors.text}>
                  {t('matchDetail.timeSuggestion.newTimeLabel')}
                </Text>
                <TouchableOpacity onPress={handlePickerDone} style={styles.pickerHeaderButton}>
                  <Text size="base" weight="semibold" color={colors.primary}>
                    {t('common.done')}
                  </Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={tempTime}
                mode="time"
                display="spinner"
                onChange={handlePickerChange}
                minuteInterval={15}
                themeVariant={isDark ? 'dark' : 'light'}
                style={styles.iosPicker}
              />
            </View>
          </Pressable>
        </Modal>
      )}
    </BaseActionSheet>
  );
}

const styles = StyleSheet.create({
  currentTimeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    paddingVertical: spacingPixels[2],
    paddingHorizontal: spacingPixels[3],
    borderRadius: radiusPixels.md,
    alignSelf: 'flex-start',
  },
  pickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
    borderWidth: 1,
    borderRadius: radiusPixels.md,
  },
  noteInput: {
    minHeight: 72,
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
    borderWidth: 1,
    borderRadius: radiusPixels.md,
    textAlignVertical: 'top',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    padding: spacingPixels[3],
    borderRadius: radiusPixels.md,
    borderWidth: 1,
  },
  errorText: { flexShrink: 1 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pickerModal: {
    width: '80%',
    borderRadius: radiusPixels.lg,
    overflow: 'hidden',
  },
  pickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    borderBottomWidth: 1,
  },
  pickerHeaderButton: { paddingVertical: spacingPixels[1] },
  iosPicker: { width: '100%' },
});

export default SuggestMatchTimeActionSheet;
