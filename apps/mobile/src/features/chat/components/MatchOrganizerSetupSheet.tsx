/**
 * MatchOrganizerSetupSheet
 *
 * Entry point for the chat Match Organizer. Resolves the sport the chat members
 * share, previews the top suggested time/place options, and posts a votable
 * organizer card into the conversation. Format is inferred from the participant
 * count (4 -> doubles, else singles).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import ActionSheet, { SheetManager, SheetProps } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text, Button } from '@rallia/shared-components';
import {
  spacingPixels,
  radiusPixels,
  primary,
  status as statusColors,
} from '@rallia/design-system';
import {
  useSharedSports,
  useMatchOrganizerOptions,
  usePostMatchOrganizerCard,
} from '@rallia/shared-hooks';

import { useThemeStyles, useTranslation } from '#/hooks';
import { formatTimeOfDay } from '#/utils/dateFormatting';

export function MatchOrganizerSetupActionSheet({ payload }: SheetProps<'match-organizer-setup'>) {
  const conversationId = payload?.conversationId;
  const organizerId = payload?.organizerId;
  const participantIds = useMemo(() => payload?.participantIds ?? [], [payload?.participantIds]);

  const { colors } = useThemeStyles();
  const { t, locale } = useTranslation();

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
    limit: 6,
  });

  const selectedSport = sharedSports.find(s => s.id === selectedSportId) ?? null;
  const post = usePostMatchOrganizerCard();

  const handleClose = useCallback(() => {
    void SheetManager.hide('match-organizer-setup');
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!conversationId || !organizerId || !selectedSportId || options.length === 0 || submitting) {
      return;
    }
    setSubmitting(true);
    try {
      await post.mutateAsync({
        conversationId,
        organizerId,
        sportId: selectedSportId,
        sportName: selectedSport?.name ?? null,
        format,
        participantIds,
        options,
        previewText: t('matchOrganizer.preview'),
      });
      await SheetManager.hide('match-organizer-setup');
    } catch (error) {
      console.error('Failed to post match organizer card:', error);
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
    options,
    format,
    participantIds,
    submitting,
    post,
    t,
  ]);

  const isLoadingPreview = optionsLoading || optionsFetching || (sportsLoading && !selectedSportId);
  const showEmpty = !!selectedSportId && !isLoadingPreview && options.length === 0;

  return (
    <ActionSheet
      id="match-organizer-setup"
      containerStyle={{ backgroundColor: colors.background, ...styles.sheet }}
      gestureEnabled
      indicatorStyle={{ backgroundColor: colors.border }}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <Text size="lg" weight="bold" color={colors.text}>
            {t('matchOrganizer.setup.title')}
          </Text>
          <Pressable onPress={handleClose} hitSlop={8}>
            <Ionicons name="close" size={24} color={colors.textMuted} />
          </Pressable>
        </View>

        {/* Sport picker */}
        {sharedSports.length > 0 ? (
          <View style={styles.section}>
            <Text size="xs" weight="semibold" color={colors.textMuted} style={styles.label}>
              {t('matchOrganizer.setup.sportLabel')}
            </Text>
            <View style={styles.chipsRow}>
              {sharedSports.map(sport => {
                const active = sport.id === selectedSportId;
                return (
                  <Pressable
                    key={sport.id}
                    onPress={() => setSelectedSportId(sport.id)}
                    style={[
                      styles.chip,
                      {
                        borderColor: active ? primary[500] : colors.border,
                        backgroundColor: active ? primary[500] : 'transparent',
                      },
                    ]}
                  >
                    <Text size="sm" weight="semibold" color={active ? '#fff' : colors.text}>
                      {sport.name}
                    </Text>
                  </Pressable>
                );
              })}
              <View style={styles.formatBadge}>
                <Text size="xs" color={colors.textMuted}>
                  {format === 'doubles'
                    ? t('matchOrganizer.setup.doubles')
                    : t('matchOrganizer.setup.singles')}
                </Text>
              </View>
            </View>
          </View>
        ) : null}

        {/* Preview */}
        <View style={styles.section}>
          <Text size="xs" weight="semibold" color={colors.textMuted} style={styles.label}>
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
            <ScrollView style={styles.previewList} nestedScrollEnabled>
              {options.map((option, index) => {
                const start = new Date(option.slot_start);
                const dateLabel = start.toLocaleDateString(locale, {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                });
                return (
                  <View
                    key={`${option.slot_start}-${option.facility_id}-${index}`}
                    style={[styles.previewRow, { borderColor: colors.border }]}
                  >
                    <View style={styles.previewInfo}>
                      <Text size="sm" weight="semibold" color={colors.text}>
                        {dateLabel} · {formatTimeOfDay(start, locale)}
                      </Text>
                      {option.facility_name ? (
                        <Text size="xs" color={colors.textMuted}>
                          {option.facility_name}
                        </Text>
                      ) : null}
                    </View>
                    {option.court_confirmed ? (
                      <View style={styles.previewBadge}>
                        <Ionicons
                          name="tennisball-outline"
                          size={12}
                          color={statusColors.success.DEFAULT}
                        />
                        <Text size="xs" color={statusColors.success.DEFAULT}>
                          {t('matchOrganizer.tier.courtAvailable')}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </ScrollView>
          )}
        </View>

        <Button
          onPress={handleSubmit}
          disabled={submitting || options.length === 0 || !selectedSportId}
          loading={submitting}
          fullWidth
        >
          {submitting ? t('matchOrganizer.setup.submitting') : t('matchOrganizer.setup.submit')}
        </Button>
      </View>
    </ActionSheet>
  );
}

export default MatchOrganizerSetupActionSheet;

const styles = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: radiusPixels.xl,
    borderTopRightRadius: radiusPixels.xl,
  },
  container: {
    padding: spacingPixels[5],
    gap: spacingPixels[4],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  section: {
    gap: spacingPixels[2],
  },
  label: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[2],
  },
  formatBadge: {
    marginLeft: 'auto',
  },
  previewMsg: {
    paddingVertical: spacingPixels[3],
  },
  previewList: {
    maxHeight: 260,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: radiusPixels.lg,
    paddingVertical: spacingPixels[2],
    paddingHorizontal: spacingPixels[3],
    marginBottom: spacingPixels[2],
  },
  previewInfo: {
    flex: 1,
    gap: 2,
  },
  previewBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
  },
});
