/**
 * MatchOrganizerSetupSheet
 *
 * Entry point for the chat Match Organizer. Resolves the sport the chat members
 * share, previews the top suggested time/place options, and posts a votable
 * organizer card into the conversation. Format is inferred from the participant
 * count (4 -> doubles, else singles).
 *
 * Styling mirrors MatchCreationWizard: sport-badge chips, theme-aware primary
 * accent, and a full-width primary CTA. Dismiss is X-only (drag + backdrop
 * disabled) so an over-scroll can't close it mid-setup.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { SheetManager, SheetProps } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import {
  spacingPixels,
  radiusPixels,
  primary,
  status as statusColors,
} from '@rallia/design-system';
import {
  lightHaptic,
  selectionHaptic,
  successHaptic,
  warningHaptic,
  formatIntuitiveDateInTimezone,
} from '@rallia/shared-utils';
import {
  useSharedSports,
  useMatchOrganizerOptions,
  usePostMatchOrganizerCard,
} from '@rallia/shared-hooks';

import { BaseActionSheet } from '#/components/BaseActionSheet';
import { SportIcon } from '#/components/SportIcon';
import { useThemeStyles, useTranslation } from '#/hooks';
import { formatTimeOfDay } from '#/utils/dateFormatting';
import TennisCourtIcon from '../../../../assets/icons/tennis-court.svg';

const SHEET_ID = 'match-organizer-setup';
const BASE_WHITE = '#ffffff';

const optionKey = (slot: string, facilityId: string | null, index: number) =>
  `${slot}-${facilityId}-${index}`;

const localDateKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function MatchOrganizerSetupActionSheet({ payload }: SheetProps<'match-organizer-setup'>) {
  const conversationId = payload?.conversationId;
  const organizerId = payload?.organizerId;
  const participantIds = useMemo(() => payload?.participantIds ?? [], [payload?.participantIds]);

  const { colors, isDark } = useThemeStyles();
  const { t, locale } = useTranslation();

  // Match the wizard's primary accent (deeper in light mode, brighter in dark).
  const accent = isDark ? primary[500] : primary[600];

  const { data: sharedSports = [], isLoading: sportsLoading } = useSharedSports(participantIds);
  const [selectedSportId, setSelectedSportId] = useState<string | null>(
    payload?.defaultSportId ?? null
  );
  const [submitting, setSubmitting] = useState(false);

  // Default to the first shared sport once resolved.
  useEffect(() => {
    if (!selectedSportId && sharedSports.length > 0) {
      setSelectedSportId(sharedSports[0].id);
    }
  }, [sharedSports, selectedSportId]);

  const format: 'singles' | 'doubles' = participantIds.length === 4 ? 'doubles' : 'singles';

  const {
    data: options = [],
    isLoading: optionsLoading,
    isFetching: optionsFetching,
  } = useMatchOrganizerOptions(participantIds, selectedSportId ?? undefined, {
    enabled: !!selectedSportId,
    limit: 10,
  });

  const selectedSport = sharedSports.find(s => s.id === selectedSportId) ?? null;
  const post = usePostMatchOrganizerCard();

  // Which suggestions the organizer will actually post (default: all of them).
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const optionsSignature = options
    .map((o, i) => optionKey(o.slot_start, o.facility_id, i))
    .join('|');
  useEffect(() => {
    setSelectedKeys(new Set(options.map((o, i) => optionKey(o.slot_start, o.facility_id, i))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionsSignature]);

  const toggleOption = useCallback((key: string) => {
    void lightHaptic();
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const formatPrice = useCallback(
    (cents: number | null): string | null => {
      if (cents == null) return null;
      if (cents === 0) return t('matchOrganizer.cost.free');
      return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
    },
    [t]
  );

  // User-friendly date label: Today / Tomorrow / weekday / "Mon, Jan 6".
  const friendlyDate = useCallback(
    (date: Date): string => {
      const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const r = formatIntuitiveDateInTimezone(localDateKey(date), deviceTz, locale);
      return r.translationKey ? t(r.translationKey) : r.label;
    },
    [locale, t]
  );

  const handleClose = useCallback(() => {
    void lightHaptic();
    void SheetManager.hide(SHEET_ID);
  }, []);

  const handleSubmit = useCallback(async () => {
    const chosen = options.filter((o, i) =>
      selectedKeys.has(optionKey(o.slot_start, o.facility_id, i))
    );
    if (!conversationId || !organizerId || !selectedSportId || chosen.length === 0 || submitting) {
      return;
    }
    setSubmitting(true);
    try {
      await post.mutateAsync({
        conversationId,
        organizerId,
        sportId: selectedSportId,
        // Only label the card with the sport when the user actually chose one
        // (the picker is shown only for 2+ shared sports; a single sport is auto).
        sportName: sharedSports.length > 1 ? (selectedSport?.displayName ?? null) : null,
        format,
        participantIds,
        options: chosen,
        previewText: t('matchOrganizer.preview'),
      });
      void successHaptic();
      await SheetManager.hide(SHEET_ID);
    } catch (error) {
      console.error('Failed to post match organizer card:', error);
      void warningHaptic();
      // Toasts render behind the sheet — use Alert for in-sheet errors.
      Alert.alert(t('common.error'), t('matchOrganizer.setup.error'));
    } finally {
      setSubmitting(false);
    }
  }, [
    conversationId,
    organizerId,
    selectedSportId,
    selectedSport,
    sharedSports,
    options,
    selectedKeys,
    format,
    participantIds,
    submitting,
    post,
    t,
  ]);

  const isLoadingPreview = optionsLoading || optionsFetching || (sportsLoading && !selectedSportId);
  const showEmpty = !!selectedSportId && !isLoadingPreview && options.length === 0;
  const submitDisabled = submitting || selectedKeys.size === 0 || !selectedSportId;

  return (
    <BaseActionSheet
      title={t('matchOrganizer.setup.title')}
      onClose={handleClose}
      flex={false}
      scrollable
      gestureEnabled={false}
      closeOnTouchBackdrop={false}
      footer={
        <TouchableOpacity
          style={[styles.cta, { backgroundColor: accent }, submitDisabled && styles.ctaDisabled]}
          onPress={handleSubmit}
          disabled={submitDisabled}
          accessibilityRole="button"
          accessibilityLabel={t('matchOrganizer.setup.submit')}
        >
          {submitting ? (
            <ActivityIndicator color={BASE_WHITE} />
          ) : (
            <>
              <Text size="lg" weight="semibold" color={BASE_WHITE}>
                {t('matchOrganizer.setup.submit')}
              </Text>
              <Ionicons name="arrow-forward-outline" size={20} color={BASE_WHITE} />
            </>
          )}
        </TouchableOpacity>
      }
    >
      {/* Sport picker — only when there's an actual choice (2+ shared sports).
          A single shared sport is auto-selected, so the picker is hidden. */}
      {sharedSports.length > 1 ? (
        <View style={styles.section}>
          <Text size="sm" weight="semibold" color={colors.textSecondary} style={styles.label}>
            {t('matchOrganizer.setup.sportLabel')}
          </Text>
          <View style={styles.sportRow}>
            {sharedSports.map(sport => {
              const active = sport.id === selectedSportId;
              return (
                <Pressable
                  key={sport.id}
                  onPress={() => {
                    void selectionHaptic();
                    setSelectedSportId(sport.id);
                  }}
                  style={[
                    styles.sportCard,
                    {
                      borderColor: active ? accent : colors.border,
                      backgroundColor: active ? `${accent}15` : colors.buttonInactive,
                    },
                  ]}
                >
                  <SportIcon
                    sportName={sport.name}
                    size={24}
                    color={active ? accent : colors.textMuted}
                  />
                  <Text
                    size="sm"
                    weight={active ? 'semibold' : 'regular'}
                    color={active ? accent : colors.text}
                    style={styles.sportCardLabel}
                  >
                    {sport.displayName}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      {/* Preview — tap rows to choose which to suggest */}
      <View style={styles.section}>
        <Text size="sm" weight="semibold" color={colors.textSecondary} style={styles.label}>
          {t('matchOrganizer.setup.previewTitle')}
        </Text>

        {isLoadingPreview ? (
          <Text size="sm" color={colors.textMuted} style={styles.previewMsg}>
            {t('matchOrganizer.setup.previewLoading')}
          </Text>
        ) : showEmpty ? (
          <Text size="sm" color={colors.textMuted} style={styles.previewMsg}>
            {t('matchOrganizer.setup.previewEmpty')}
          </Text>
        ) : (
          <>
            <Text size="xs" color={colors.textMuted} style={styles.previewHint}>
              {t('matchOrganizer.setup.previewHint')}
            </Text>
            {options.map((option, index) => {
              const key = optionKey(option.slot_start, option.facility_id, index);
              const selected = selectedKeys.has(key);
              const start = new Date(option.slot_start);
              const dateLabel = friendlyDate(start);
              const priceLabel = formatPrice(option.price_cents);
              const courtCount = option.court_count ?? 0;
              const courtLabel = !option.court_confirmed
                ? t('matchOrganizer.tier.usuallyFree')
                : courtCount > 1
                  ? t('matchOrganizer.tier.courtsMany').replace('{count}', String(courtCount))
                  : courtCount === 1
                    ? t('matchOrganizer.tier.courtsOne')
                    : t('matchOrganizer.tier.courtAvailable');

              return (
                <Pressable
                  key={key}
                  onPress={() => toggleOption(key)}
                  style={[
                    styles.previewRow,
                    {
                      borderColor: selected ? accent : colors.border,
                      backgroundColor: selected ? `${accent}15` : colors.buttonInactive,
                    },
                  ]}
                >
                  <Ionicons
                    name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                    size={22}
                    color={selected ? accent : colors.textMuted}
                  />
                  <View style={styles.previewInfo}>
                    <Text size="sm" weight="semibold" color={colors.text}>
                      {dateLabel} · {formatTimeOfDay(start, locale)}
                    </Text>
                    {option.facility_name ? (
                      <Text size="xs" color={colors.textMuted}>
                        {option.facility_name}
                      </Text>
                    ) : null}
                    <View
                      style={[
                        styles.courtPill,
                        {
                          backgroundColor: option.court_confirmed
                            ? statusColors.success.DEFAULT + '1A'
                            : colors.border + '66',
                        },
                      ]}
                    >
                      {option.court_confirmed ? (
                        <TennisCourtIcon
                          width={13}
                          height={13}
                          stroke={statusColors.success.DEFAULT}
                          style={styles.courtIcon}
                        />
                      ) : (
                        <Ionicons name="time-outline" size={12} color={colors.textMuted} />
                      )}
                      <Text
                        size="xs"
                        weight="semibold"
                        color={
                          option.court_confirmed ? statusColors.success.DEFAULT : colors.textMuted
                        }
                      >
                        {courtLabel}
                        {option.court_confirmed && priceLabel ? ` · ${priceLabel}` : ''}
                      </Text>
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </>
        )}
      </View>
    </BaseActionSheet>
  );
}

export default MatchOrganizerSetupActionSheet;

const styles = StyleSheet.create({
  section: {
    marginBottom: spacingPixels[5],
  },
  label: {
    marginBottom: spacingPixels[2],
  },
  sportRow: {
    flexDirection: 'row',
    gap: spacingPixels[2],
  },
  sportCard: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[1],
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[2],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    minHeight: 70,
  },
  sportCardLabel: {
    textAlign: 'center',
  },
  previewMsg: {
    paddingVertical: spacingPixels[3],
  },
  previewHint: {
    marginBottom: spacingPixels[2],
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
    borderWidth: 1,
    borderRadius: radiusPixels.xl,
    padding: spacingPixels[4],
    marginBottom: spacingPixels[1.5],
  },
  previewInfo: {
    flex: 1,
    gap: 2,
  },
  courtPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacingPixels[1],
    borderRadius: 999,
    paddingHorizontal: spacingPixels[2],
    paddingVertical: 3,
    marginTop: spacingPixels[1],
  },
  courtIcon: {
    transform: [{ rotate: '90deg' }],
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    gap: spacingPixels[2],
  },
  ctaDisabled: {
    opacity: 0.6,
  },
});
