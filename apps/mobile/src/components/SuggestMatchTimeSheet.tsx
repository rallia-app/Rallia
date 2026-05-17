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
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import ActionSheet, { SheetManager, SheetProps } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useQueryClient } from '@tanstack/react-query';
import { Text, useToast } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, primary, neutral } from '@rallia/design-system';
import { errorHaptic, lightHaptic, successHaptic } from '@rallia/shared-utils';
import { Logger, suggestMatchTime, withdrawTimeSuggestion } from '@rallia/shared-services';
import { useThemeStyles, useTranslation } from '../hooks';

const NOTE_MAX = 280;

type SheetStatus = 'idle' | 'sending' | 'sent' | 'error';

function parseTimeToDate(time: string): Date {
  // Accept HH:MM or HH:MM:SS. Build a Date pinned to today.
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

  const accent = isDark ? primary[400] : primary[500];

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
  const sameAsCurrent = selectedTime === (payload?.currentStartTime ?? '');

  const openPicker = useCallback(() => {
    lightHaptic();
    setTempTime(parseTimeToDate(selectedTime));
    setShowPicker(true);
  }, [selectedTime]);

  const handlePickerChange = useCallback((_event: unknown, date?: Date) => {
    if (Platform.OS === 'android') {
      setShowPicker(false);
      if (date) {
        setSelectedTime(formatHHMM(date));
      }
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
      // then insert the new one. Two round-trips, but it keeps the partial
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
      const msg =
        err instanceof Error && err.message === 'already_pending'
          ? t('matchDetail.timeSuggestion.alreadyPending')
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

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={{ backgroundColor: colors.background }}
      indicatorStyle={{ backgroundColor: isDark ? neutral[600] : neutral[300] }}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <Ionicons name="time-outline" size={22} color={accent} />
          <Text size="xl" weight="bold" color={colors.foreground} style={styles.title}>
            {t('matchDetail.timeSuggestion.sheetTitle')}
          </Text>
        </View>

        <Text size="sm" color={colors.textMuted} style={styles.subtitle}>
          {t('matchDetail.timeSuggestion.sheetSubtitle')}
        </Text>

        <Text size="sm" color={colors.textMuted} style={styles.currentTime}>
          {t('matchDetail.timeSuggestion.currentTime', {
            time: formatTimeForDisplay(payload.currentStartTime, locale),
          })}
        </Text>

        <View style={styles.fieldGroup}>
          <Text size="sm" weight="semibold" color={colors.textSecondary} style={styles.label}>
            {t('matchDetail.timeSuggestion.newTimeLabel')}
          </Text>
          <TouchableOpacity
            style={[
              styles.pickerButton,
              { borderColor: colors.border, backgroundColor: colors.buttonInactive },
            ]}
            onPress={openPicker}
            activeOpacity={0.8}
          >
            <Ionicons name="time-outline" size={20} color={colors.buttonActive} />
            <Text size="base" color={colors.text}>
              {formatTimeForDisplay(selectedTime, locale)}
            </Text>
          </TouchableOpacity>

          {payload.matchTimezone && (
            <Text size="xs" color={colors.textMuted} style={styles.timezoneBanner}>
              {t('matchDetail.timeSuggestion.timezoneBanner', { tz: payload.matchTimezone })}
            </Text>
          )}
        </View>

        <View style={styles.fieldGroup}>
          <Text size="sm" weight="semibold" color={colors.textSecondary} style={styles.label}>
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
          />
        </View>

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
          <TouchableOpacity
            style={[
              styles.button,
              styles.primaryButton,
              { backgroundColor: accent, opacity: status === 'sending' || sameAsCurrent ? 0.6 : 1 },
            ]}
            onPress={handleSubmit}
            disabled={status === 'sending' || status === 'sent' || sameAsCurrent}
            activeOpacity={0.8}
          >
            {status === 'sending' ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text size="sm" weight="bold" color="#ffffff">
                {isEditing
                  ? t('matchDetail.timeSuggestion.submitUpdate')
                  : t('matchDetail.timeSuggestion.submit')}
              </Text>
            )}
          </TouchableOpacity>

          {isEditing && (
            <TouchableOpacity
              style={[styles.button, styles.secondaryButton, { borderColor: '#dc2626' }]}
              onPress={handleWithdraw}
              disabled={status === 'sending'}
              activeOpacity={0.7}
            >
              <Text size="sm" weight="semibold" color="#dc2626">
                {t('matchDetail.timeSuggestion.withdraw')}
              </Text>
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
              {t('common.cancel')}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Android picker renders inline as a one-shot dialog */}
        {showPicker && Platform.OS === 'android' && (
          <DateTimePicker
            value={tempTime}
            mode="time"
            display="spinner"
            onChange={handlePickerChange}
            minuteInterval={15}
          />
        )}

        {/* iOS picker uses a modal sheet — matches WhenFormatStep convention */}
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
                    <Text size="base" weight="semibold" color={accent}>
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
  title: { flexShrink: 1 },
  subtitle: { marginBottom: spacingPixels[3], lineHeight: 20 },
  currentTime: { marginBottom: spacingPixels[4] },
  fieldGroup: { marginBottom: spacingPixels[4] },
  label: { marginBottom: spacingPixels[2] },
  pickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
    borderWidth: 1,
    borderRadius: radiusPixels.md,
  },
  timezoneBanner: { marginTop: spacingPixels[2] },
  noteInput: {
    minHeight: 64,
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
    marginBottom: spacingPixels[4],
  },
  errorText: { flexShrink: 1 },
  actions: { gap: spacingPixels[3] },
  button: {
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[5],
    borderRadius: radiusPixels.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  primaryButton: {},
  secondaryButton: { backgroundColor: 'transparent', borderWidth: 1 },
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
