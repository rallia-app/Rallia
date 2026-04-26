/**
 * YourStoryCard
 *
 * The personal narrative card under the form strip: your rank, your form,
 * a one-line diagnostic, and a single actionable "next move" CTA.
 */

import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { neutral, primary, radiusPixels, spacingPixels, status } from '@rallia/design-system';
import type { NetworkPulseYourSummary } from '@rallia/shared-hooks';

import { useThemeStyles, useTranslation } from '../../../../hooks';
import type { TranslationKey } from '../../../../hooks';

import { FormLine } from './FormLine';

interface YourStoryCardProps {
  summary: NetworkPulseYourSummary;
  onCtaPress?: () => void;
  /** Whether the next-move CTA, if "challenge", should fire onCtaPress. Parent decides. */
}

export function YourStoryCard({ summary, onCtaPress }: YourStoryCardProps) {
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();

  const rankCopy =
    summary.rank_delta == null
      ? t('groups.leaderboard.yourStory.noPrev')
      : summary.rank_delta > 0
        ? t('groups.leaderboard.yourStory.rankUp', { count: summary.rank_delta })
        : summary.rank_delta < 0
          ? t('groups.leaderboard.yourStory.rankDown', { count: Math.abs(summary.rank_delta) })
          : t('groups.leaderboard.yourStory.rankSteady');

  const diagnostic = summary.diagnostic_key
    ? t(summary.diagnostic_key as TranslationKey, summary.diagnostic_params ?? {})
    : null;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: isDark ? `${primary[700]}26` : primary[50],
          borderColor: isDark ? primary[700] : primary[200],
        },
      ]}
    >
      {/* Rank line */}
      <View style={styles.headerRow}>
        <Text size="lg" weight="bold" style={{ color: colors.text }}>
          {summary.rank
            ? t('groups.leaderboard.yourRank', {
                rank: summary.rank,
                total: summary.rank_total,
              })
            : t('groups.leaderboard.yourStory.title')}
        </Text>
        <Text size="xs" weight="semibold" style={{ color: colors.primary, marginLeft: 8 }}>
          {rankCopy}
        </Text>
      </View>

      {/* Diagnostic + W-L */}
      <View style={styles.subRow}>
        <Text size="sm" style={{ color: colors.textSecondary }} numberOfLines={2}>
          {summary.wins}–{summary.losses}
          {diagnostic ? ` · ${diagnostic}` : ''}
        </Text>
      </View>

      {/* Form line + streak */}
      <View style={styles.formRow}>
        <FormLine outcomes={summary.last5} isDark={isDark} />
        {Math.abs(summary.current_streak) >= 2 && (
          <View
            style={[
              styles.streakChip,
              {
                backgroundColor:
                  summary.current_streak > 0
                    ? `${status.success.DEFAULT}22`
                    : `${status.info.DEFAULT}22`,
              },
            ]}
          >
            <Ionicons
              name={summary.current_streak > 0 ? 'flame' : 'snow-outline'}
              size={11}
              color={summary.current_streak > 0 ? status.success.DEFAULT : status.info.DEFAULT}
              style={{ marginRight: 3 }}
            />
            <Text
              size="xs"
              weight="semibold"
              style={{
                color: summary.current_streak > 0 ? status.success.DEFAULT : status.info.DEFAULT,
              }}
            >
              {summary.current_streak > 0
                ? t('groups.leaderboard.streakWins', { count: summary.current_streak })
                : t('groups.leaderboard.streakLosses', { count: -summary.current_streak })}
            </Text>
          </View>
        )}
      </View>

      {/* Next-move CTA */}
      {summary.next_move && (
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={onCtaPress}
          style={[
            styles.ctaRow,
            {
              backgroundColor: colors.cardBackground,
              borderColor: isDark ? neutral[700] : neutral[200],
            },
          ]}
        >
          <Ionicons name="sparkles-outline" size={14} color={colors.primary} />
          <Text size="xs" weight="semibold" style={{ color: colors.text, flex: 1, marginLeft: 6 }}>
            {t(summary.next_move.copy_key as TranslationKey, summary.next_move.copy_params ?? {})}
          </Text>
          <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
    borderRadius: radiusPixels.xl,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: spacingPixels[4],
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  subRow: {
    marginTop: spacingPixels[1],
  },
  formRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacingPixels[3],
    gap: spacingPixels[2],
  },
  streakChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radiusPixels.full,
  },
  ctaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacingPixels[3],
    paddingVertical: spacingPixels[2],
    paddingHorizontal: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
});

export default YourStoryCard;
