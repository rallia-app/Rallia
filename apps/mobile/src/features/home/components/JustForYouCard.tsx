/**
 * JustForYouCard
 *
 * Compact card used in the Home "Just for you" horizontal carousel. One card
 * is either a real match (tap → match detail) or a suggested matchup (tap CTA
 * → send invite). 240px wide so ~1.6 cards fit on a typical phone — good
 * affordance for horizontal scroll.
 */

import React, { useCallback, useMemo } from 'react';
import { StyleSheet, TouchableOpacity, View, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import type { SlotSuggestion, Scorable } from '@rallia/shared-services';
import { lightHaptic, formatIntuitiveDateInTimezone } from '@rallia/shared-utils';
import { SportIcon } from '../../../components/SportIcon';
import type {
  InvitePayload,
  InviteState,
  SuggestionCardLabels,
} from '../../../components/SuggestionCard';

const CARD_WIDTH = 240;

export type JustForYouItem =
  | { kind: 'match'; data: Scorable }
  | { kind: 'suggestion'; data: SlotSuggestion };

interface JustForYouCardColors {
  cardBackground: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  primary: string;
}

export interface JustForYouCardProps {
  item: JustForYouItem;
  colors: JustForYouCardColors;
  isDark: boolean;
  locale: string;
  t: (key: string, options?: Record<string, string | number | boolean>) => string;
  /** Localized labels for the suggestion variant. */
  suggestionLabels: SuggestionCardLabels;
  /** Resolved invite state for a suggestion (idle / sending / sent). */
  inviteState?: InviteState;
  onMatchPress?: (match: Scorable) => void;
  onSendInvite?: (payload: InvitePayload) => void;
  /** Sport context — used to render the sport icon when available. */
  sportName?: string;
}

function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// =============================================================================
// MATCH VARIANT
// =============================================================================

function MatchCardContent({
  match,
  colors,
  locale,
  t,
  sportName,
}: {
  match: Scorable;
  colors: JustForYouCardColors;
  locale: string;
  t: JustForYouCardProps['t'];
  sportName?: string;
}) {
  const dateLabel = useMemo(() => {
    if (!match.match_date) return '';
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const result = formatIntuitiveDateInTimezone(match.match_date, tz, locale);
    if (result.type === 'today') return t('common.time.today');
    if (result.type === 'tomorrow') return t('common.time.tomorrow');
    return result.label;
  }, [match.match_date, locale, t]);

  const timeLabel = useMemo(() => {
    if (!match.start_time) return '';
    const [h, m] = match.start_time.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  }, [match.start_time, locale]);

  const capacity = match.format === 'doubles' ? 4 : 2;
  const joined = match.participants?.filter(p => p.status === 'joined').length ?? 0;
  const spotsLeft = capacity - joined;
  const isFull = spotsLeft <= 0;

  const facilityName = match.facility?.name ?? t('home.justForYouCard.unknownFacility');
  const resolvedSportName = match.sport?.name ?? sportName ?? 'tennis';

  return (
    <>
      <View style={styles.header}>
        <View style={[styles.iconBubble, { backgroundColor: colors.primary + '15' }]}>
          <SportIcon sportName={resolvedSportName} size={16} color={colors.primary} />
        </View>
        <View style={styles.headerTextBlock}>
          <Text size="xs" weight="bold" color={colors.textMuted} style={styles.kindLabel}>
            {t('home.justForYouCard.matchLabel')}
          </Text>
        </View>
      </View>

      <Text size="sm" weight="bold" color={colors.text} numberOfLines={1} style={styles.titleLine}>
        {dateLabel} · {timeLabel}
      </Text>

      <Text size="xs" color={colors.textMuted} numberOfLines={1} style={styles.subtitleLine}>
        {facilityName}
      </Text>

      <View style={styles.footer}>
        <View
          style={[
            styles.spotsChip,
            {
              backgroundColor: isFull ? colors.textMuted + '22' : colors.primary + '15',
            },
          ]}
        >
          <Text size="xs" weight="semibold" color={isFull ? colors.textMuted : colors.primary}>
            {isFull
              ? t('home.justForYouCard.full')
              : t('home.justForYouCard.spotsLeft', { count: spotsLeft })}
          </Text>
        </View>
      </View>
    </>
  );
}

// =============================================================================
// SUGGESTION VARIANT
// =============================================================================

function SuggestionCardContent({
  suggestion,
  colors,
  locale,
  t,
  inviteState,
  onSendInvite,
  suggestionLabels,
}: {
  suggestion: SlotSuggestion;
  colors: JustForYouCardColors;
  locale: string;
  t: JustForYouCardProps['t'];
  inviteState: InviteState;
  onSendInvite?: (payload: InvitePayload) => void;
  suggestionLabels: SuggestionCardLabels;
}) {
  const slotStart = useMemo(
    () =>
      suggestion.slot.datetime instanceof Date
        ? suggestion.slot.datetime
        : new Date(suggestion.slot.datetime),
    [suggestion.slot.datetime]
  );

  const dateLabel = useMemo(() => {
    const key = localDateKey(slotStart);
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const result = formatIntuitiveDateInTimezone(key, tz, locale);
    if (result.type === 'today') return suggestionLabels.today;
    if (result.type === 'tomorrow') return suggestionLabels.tomorrow;
    return result.label;
  }, [slotStart, locale, suggestionLabels]);

  const timeLabel = slotStart.toLocaleTimeString(locale, {
    hour: 'numeric',
    minute: '2-digit',
  });

  const opponentName =
    `${suggestion.opponentFirstName} ${suggestion.opponentLastName}`.trim() ||
    suggestionLabels.unknownPlayer;
  const opponentInitials =
    (suggestion.opponentFirstName?.[0] ?? '') + (suggestion.opponentLastName?.[0] ?? '');

  const handlePress = useCallback(() => {
    if (!onSendInvite || inviteState !== 'idle') return;
    lightHaptic();
    onSendInvite({ suggestion });
  }, [onSendInvite, inviteState, suggestion]);

  const ctaLabel =
    inviteState === 'sent' ? suggestionLabels.inviteSent : suggestionLabels.sendInvite;

  return (
    <>
      <View style={styles.header}>
        {suggestion.opponentAvatar ? (
          <Image source={{ uri: suggestion.opponentAvatar }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatarFallback, { backgroundColor: colors.primary + '22' }]}>
            <Text size="xs" weight="bold" color={colors.primary}>
              {opponentInitials.toUpperCase()}
            </Text>
          </View>
        )}
        <View style={styles.headerTextBlock}>
          <Text size="xs" weight="bold" color={colors.textMuted} style={styles.kindLabel}>
            {t('home.justForYouCard.suggestionLabel')}
          </Text>
        </View>
      </View>

      <Text size="sm" weight="bold" color={colors.text} numberOfLines={1} style={styles.titleLine}>
        {opponentName}
      </Text>

      <Text size="xs" color={colors.textMuted} numberOfLines={1} style={styles.subtitleLine}>
        {dateLabel} · {timeLabel} · {suggestion.facility.facilityName}
      </Text>

      <TouchableOpacity
        style={[
          styles.cta,
          {
            backgroundColor: inviteState === 'sent' ? colors.textMuted + '22' : colors.primary,
            opacity: inviteState === 'sending' ? 0.7 : 1,
          },
        ]}
        onPress={handlePress}
        activeOpacity={0.8}
        disabled={inviteState !== 'idle'}
      >
        {inviteState === 'sent' && (
          <Ionicons
            name="checkmark"
            size={14}
            color={colors.textMuted}
            style={{ marginRight: 4 }}
          />
        )}
        <Text
          size="xs"
          weight="semibold"
          color={inviteState === 'sent' ? colors.textMuted : '#ffffff'}
        >
          {ctaLabel}
        </Text>
      </TouchableOpacity>
    </>
  );
}

// =============================================================================
// MAIN
// =============================================================================

export function JustForYouCard({
  item,
  colors,
  isDark,
  locale,
  t,
  suggestionLabels,
  inviteState = 'idle',
  onMatchPress,
  onSendInvite,
  sportName,
}: JustForYouCardProps) {
  const cardStyle = [
    styles.card,
    {
      backgroundColor: colors.cardBackground,
      borderColor: colors.border,
      shadowOpacity: isDark ? 0.4 : 0.08,
    },
  ];

  if (item.kind === 'match') {
    return (
      <TouchableOpacity
        style={cardStyle}
        onPress={() => onMatchPress?.(item.data)}
        activeOpacity={0.85}
      >
        <MatchCardContent
          match={item.data}
          colors={colors}
          locale={locale}
          t={t}
          sportName={sportName}
        />
      </TouchableOpacity>
    );
  }

  return (
    <View style={cardStyle}>
      <SuggestionCardContent
        suggestion={item.data}
        colors={colors}
        locale={locale}
        t={t}
        inviteState={inviteState}
        onSendInvite={onSendInvite}
        suggestionLabels={suggestionLabels}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    minHeight: 130,
    padding: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacingPixels[2],
    gap: spacingPixels[2],
  },
  iconBubble: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  avatarFallback: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextBlock: {
    flex: 1,
  },
  kindLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  titleLine: {
    marginBottom: spacingPixels[1],
  },
  subtitleLine: {
    marginBottom: spacingPixels[3],
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 'auto',
  },
  spotsChip: {
    paddingHorizontal: spacingPixels[2],
    paddingVertical: 4,
    borderRadius: radiusPixels.full,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[2],
    borderRadius: radiusPixels.md,
    marginTop: 'auto',
  },
});

export default JustForYouCard;
