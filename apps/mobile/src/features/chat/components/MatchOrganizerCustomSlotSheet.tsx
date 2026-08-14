/**
 * MatchOrganizerCustomSlotSheet
 *
 * Propose your own time (and optionally a place) on a Match Organizer card.
 *
 * This is the organizer funnel's floor. The suggestion engine needs shared
 * availability and a facility it knows about; when a pair has neither, the card
 * has nothing to offer and would otherwise dead-end. Here the players name a
 * slot themselves and it becomes a normal votable option, so mutual agreement
 * and game creation work exactly as they do for an engine suggestion.
 *
 * Proposing counts as agreeing, so the server votes the proposer onto the slot.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { SheetManager, SheetProps } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Button, Text, VStack, useToast } from '@rallia/shared-components';
import {
  spacingPixels,
  radiusPixels,
  base,
  neutral,
  status as dsStatus,
} from '@rallia/design-system';
import { errorHaptic, lightHaptic, successHaptic } from '@rallia/shared-utils';
import { Logger } from '@rallia/shared-services';
import { useAddCustomOrganizerOption } from '@rallia/shared-hooks';

import { BaseActionSheet } from '#/components/BaseActionSheet';
import { SheetDateField } from '#/components/SheetDateField';
import { useThemeStyles, useTranslation } from '#/hooks';
import { formatTimeOfDay } from '#/utils/dateFormatting';

const PLACE_MAX = 120;

/** Next whole hour, so the default is always a valid future slot. */
function defaultSlot(): Date {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}

export function MatchOrganizerCustomSlotActionSheet(
  props: SheetProps<'match-organizer-custom-slot'>
) {
  const { colors, isDark } = useThemeStyles();
  const { t, locale } = useTranslation();
  const { success: toastSuccess } = useToast();
  const payload = props.payload;

  const [slot, setSlot] = useState<Date>(defaultSlot);
  const [place, setPlace] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const addOption = useAddCustomOrganizerOption();

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

  const dateLabel = useMemo(
    () => slot.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' }),
    [slot, locale]
  );

  // Keep the time-of-day when the date moves, and the date when the time moves.
  const handleDateChange = useCallback((next: Date) => {
    setSlot(prev => {
      const merged = new Date(next);
      merged.setHours(prev.getHours(), prev.getMinutes(), 0, 0);
      return merged;
    });
    setErrorMsg(null);
  }, []);

  const handleTimeChange = useCallback((next: Date) => {
    setSlot(prev => {
      const merged = new Date(prev);
      merged.setHours(next.getHours(), next.getMinutes(), 0, 0);
      return merged;
    });
    setErrorMsg(null);
  }, []);

  const handleClose = useCallback(() => {
    void lightHaptic();
    void SheetManager.hide('match-organizer-custom-slot');
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!payload || addOption.isPending) return;

    if (slot.getTime() <= Date.now()) {
      setErrorMsg(t('matchOrganizer.custom.errorPast'));
      void errorHaptic();
      return;
    }

    setErrorMsg(null);
    try {
      await addOption.mutateAsync({
        messageId: payload.messageId,
        slotStart: slot.toISOString(),
        placeName: place.trim() || null,
        conversationId: payload.conversationId,
      });
      void successHaptic();
      toastSuccess(t('matchOrganizer.custom.success'));
      void SheetManager.hide('match-organizer-custom-slot');
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      // Expected rejections, not bugs, so keep them out of Sentry's error stream.
      if (['SLOT_IN_PAST', 'CARD_ALREADY_SETTLED', 'NOT_A_PARTICIPANT'].includes(code)) {
        Logger.warn('Custom organizer option rejected', { reason: code });
      } else {
        Logger.error(
          'Custom organizer option failed',
          err instanceof Error ? err : new Error(String(err))
        );
      }
      setErrorMsg(
        code === 'SLOT_IN_PAST'
          ? t('matchOrganizer.custom.errorPast')
          : code === 'CARD_ALREADY_SETTLED'
            ? t('matchOrganizer.custom.errorSettled')
            : t('matchOrganizer.custom.errorGeneric')
      );
      void errorHaptic();
    }
  }, [payload, addOption, slot, place, t, toastSuccess]);

  if (!payload) return null;

  return (
    <BaseActionSheet
      title={t('matchOrganizer.custom.sheetTitle')}
      onClose={handleClose}
      flex={false}
      scrollable
      footer={
        <VStack spacing={spacingPixels[2]}>
          <Button
            variant="primary"
            onPress={() => {
              void handleSubmit();
            }}
            disabled={addOption.isPending}
            loading={addOption.isPending}
            isDark={isDark}
            themeColors={buttonThemeColors}
            leftIcon={<Ionicons name="add-circle-outline" size={16} color={base.white} />}
          >
            {t('matchOrganizer.custom.submit')}
          </Button>
          <Button
            variant="ghost"
            onPress={handleClose}
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
          {t('matchOrganizer.custom.sheetSubtitle')}
        </Text>

        <SheetDateField
          label={t('matchOrganizer.custom.dateLabel')}
          value={slot}
          displayValue={dateLabel}
          mode="date"
          minimumDate={new Date()}
          onChange={handleDateChange}
          colors={colors}
          isDark={isDark}
          testID="custom-slot-date"
        />

        <SheetDateField
          label={t('matchOrganizer.custom.timeLabel')}
          value={slot}
          displayValue={formatTimeOfDay(slot, locale)}
          mode="time"
          onChange={handleTimeChange}
          colors={colors}
          isDark={isDark}
          testID="custom-slot-time"
        />

        <VStack spacing={spacingPixels[2]}>
          <Text size="sm" weight="semibold" color={colors.text}>
            {t('matchOrganizer.custom.placeLabel')}
          </Text>
          <TextInput
            style={[
              styles.placeInput,
              {
                color: colors.text,
                borderColor: colors.border,
                backgroundColor: colors.buttonInactive,
              },
            ]}
            value={place}
            onChangeText={text => setPlace(text.slice(0, PLACE_MAX))}
            placeholder={t('matchOrganizer.custom.placePlaceholder')}
            placeholderTextColor={colors.textMuted}
            maxLength={PLACE_MAX}
            // Place names are proper nouns: autocorrect turns "Parc" into
            // "Part" on an English keyboard.
            autoCorrect={false}
            autoCapitalize="words"
            testID="custom-slot-place"
          />
          <Text size="xs" color={colors.textMuted}>
            {t('matchOrganizer.custom.placeHint')}
          </Text>
        </VStack>

        {errorMsg ? (
          <View
            style={[
              styles.errorBanner,
              {
                backgroundColor: isDark ? `${dsStatus.error.dark}44` : `${dsStatus.error.light}33`,
                borderColor: dsStatus.error.dark,
              },
            ]}
          >
            <Ionicons name="alert-circle" size={16} color={dsStatus.error.dark} />
            <Text size="sm" color={dsStatus.error.dark} style={styles.errorText}>
              {errorMsg}
            </Text>
          </View>
        ) : null}
      </VStack>
    </BaseActionSheet>
  );
}

export default MatchOrganizerCustomSlotActionSheet;

const styles = StyleSheet.create({
  placeInput: {
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
    borderWidth: 1,
    borderRadius: radiusPixels.md,
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
});
