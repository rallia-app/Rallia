/**
 * FeedItemCard
 *
 * Renders a single item from a UnifiedFeedItem stream. Dispatches on the
 * `kind` discriminator to either MatchCard (real matches) or SuggestionCard
 * (matchup suggestions). Used by Home and Public Matches.
 */

import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { MatchCard } from '@rallia/shared-components';
import { neutral, spacingPixels } from '@rallia/design-system';
import type { UnifiedFeedItem, UnifiedFeedMatch, ThemeColors } from '@rallia/shared-hooks';

import { SportIcon } from '#/components/SportIcon';
import {
  SuggestionCard,
  type SuggestionCardLabels,
  InvitePayload,
  InviteState,
} from '#/components/SuggestionCard';
import type { SuggestionSource } from '#/services/analytics';

export interface FeedItemCardProps {
  item: UnifiedFeedItem;
  isDark: boolean;
  locale: string;
  t: (key: string, options?: Record<string, string | number | boolean>) => string;
  currentPlayerId?: string;
  themeColors: ThemeColors;
  suggestionLabels: SuggestionCardLabels;
  getInviteState: (opponentId: string, facilityId: string, startTime: Date | string) => InviteState;
  onMatchPress: (match: UnifiedFeedMatch) => void;
  onSendInvite: (payload: InvitePayload) => void;
  /** Surface hosting this feed — drives analytics source attribution. */
  suggestionSource: SuggestionSource;
  /** Pass false when the surface fires viewability-gated impressions itself. */
  trackSuggestionImpressionOnMount?: boolean;
  /** Optional sport context for suggestion analytics breakdowns. */
  sportId?: string;
  sportName?: string;
  /** Default match-type chip for SuggestionCard (mirrors MatchCard chips). */
  defaultMatchType?: 'competitive' | 'casual' | 'both';
}

function FeedItemCardImpl({
  item,
  isDark,
  locale,
  t,
  currentPlayerId,
  themeColors,
  suggestionLabels,
  getInviteState,
  onMatchPress,
  onSendInvite,
  suggestionSource,
  trackSuggestionImpressionOnMount,
  sportId,
  sportName,
  defaultMatchType,
}: FeedItemCardProps) {
  if (item.kind === 'match') {
    const match = item.data;
    return (
      <MatchCard
        match={match}
        isDark={isDark}
        t={t}
        locale={locale}
        currentPlayerId={currentPlayerId}
        sportIcon={
          <SportIcon
            sportName={match.sport?.name ?? 'tennis'}
            size={100}
            color={isDark ? neutral[600] : neutral[400]}
          />
        }
        onPress={() => onMatchPress(match)}
      />
    );
  }

  const suggestion = item.data;
  const inviteState = getInviteState(
    suggestion.opponentId,
    suggestion.facility.facilityId,
    suggestion.slot.datetime
  );
  return (
    <View style={styles.suggestionWrapper}>
      <SuggestionCard
        suggestion={suggestion}
        colors={{
          cardBackground: themeColors.cardBackground,
          text: themeColors.foreground,
          textSecondary: themeColors.textSecondary,
          textMuted: themeColors.textMuted,
          border: themeColors.border,
          buttonActive: themeColors.primary,
          buttonTextActive: '#ffffff',
        }}
        isDark={isDark}
        labels={suggestionLabels}
        locale={locale}
        onSendInvite={onSendInvite}
        inviteState={inviteState}
        source={suggestionSource}
        trackImpressionOnMount={trackSuggestionImpressionOnMount}
        sportId={sportId}
        sportName={sportName}
        defaultMatchType={defaultMatchType}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  suggestionWrapper: {
    paddingHorizontal: spacingPixels[4],
  },
});

export const FeedItemCard = memo(FeedItemCardImpl);
export default FeedItemCard;
