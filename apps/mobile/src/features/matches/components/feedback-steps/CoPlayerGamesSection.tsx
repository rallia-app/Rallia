/**
 * Co-Player Games Section
 *
 * Shown on the post-feedback "what's next" screen: upcoming open games from
 * the people you just played with. Joining one of theirs is a shorter path to
 * the next game than creating one from scratch, and recurring series make the
 * list reliable — the next occurrence is created the moment a game ends.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card, Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import type { CoPlayerUpcomingGame } from '@rallia/shared-services';
import type { Locale } from '@rallia/shared-translations';

import { formatTime } from '#/utils/dateFormatting';
import type { TranslationKey } from '#/hooks/useTranslation';

interface CoPlayerGamesSectionProps {
  games: CoPlayerUpcomingGame[];
  colors: {
    text: string;
    textMuted: string;
    border: string;
    buttonActive: string;
    cardBackground: string;
  };
  locale: Locale;
  t: (key: TranslationKey) => string;
  onSelect: (game: CoPlayerUpcomingGame) => void;
}

/**
 * Formats a YYYY-MM-DD match date as a short weekday + day label. Built from
 * the parts rather than `new Date(string)`, which parses as UTC and lands on
 * the previous day in western timezones.
 */
function formatGameDay(matchDate: string, locale: Locale): string {
  const [year, month, day] = matchDate.split('-').map(Number);
  if (!year || !month || !day) return matchDate;
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(year, month - 1, day));
}

export const CoPlayerGamesSection: React.FC<CoPlayerGamesSectionProps> = ({
  games,
  colors,
  locale,
  t,
  onSelect,
}) => {
  if (games.length === 0) return null;

  return (
    <View style={styles.container}>
      <Text size="sm" weight="semibold" color={colors.textMuted} style={styles.heading}>
        {t('matchFeedback.nextPrompt.coPlayerGamesTitle')}
      </Text>

      {games.map(game => (
        <Card
          key={game.matchId}
          variant="outlined"
          backgroundColor={colors.cardBackground}
          borderRadius={radiusPixels.lg}
          padding={spacingPixels[3]}
          onPress={() => onSelect(game)}
          style={{ ...styles.card, borderColor: colors.border }}
        >
          <View style={styles.cardRow}>
            <View style={styles.cardBody}>
              <View style={styles.cardTitleRow}>
                <Text size="base" weight="semibold" color={colors.text} numberOfLines={1}>
                  {formatGameDay(game.matchDate, locale)} · {formatTime(game.startTime, locale)}
                </Text>
                {game.isRecurring && (
                  <Ionicons name="repeat-outline" size={16} color={colors.buttonActive} />
                )}
              </View>
              <Text size="xs" color={colors.textMuted} numberOfLines={1}>
                {[game.hostName, game.locationLabel].filter(Boolean).join(' · ')}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </View>
        </Card>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignSelf: 'stretch',
    gap: spacingPixels[2],
    marginBottom: spacingPixels[2],
  },
  heading: {
    textAlign: 'center',
  },
  card: {
    paddingHorizontal: spacingPixels[4],
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
  },
  cardBody: {
    flex: 1,
    gap: spacingPixels[1],
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
});
