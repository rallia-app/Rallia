import React from 'react';
import { View, StyleSheet } from 'react-native';
import ActionSheet, { SheetManager, SheetProps } from 'react-native-actions-sheet';
import { Text, Button } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, primary } from '@rallia/design-system';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { lightHaptic } from '@rallia/shared-utils';
import { TIER_COLORS } from '@rallia/shared-services';
import { useThemeStyles, useTranslation } from '../../hooks';
import { ExplainerSection } from './ExplainerSection';

interface TierRowProps {
  color: string;
  label: string;
  range: string;
  mutedColor: string;
  textColor: string;
}

function TierRow({ color, label, range, mutedColor, textColor }: TierRowProps) {
  return (
    <View style={styles.tierRow}>
      <View style={[styles.tierDot, { backgroundColor: color }]} />
      <Text size="sm" weight="medium" color={textColor} style={styles.tierLabel}>
        {label}
      </Text>
      <Text size="sm" color={mutedColor}>
        {range}
      </Text>
    </View>
  );
}

function EventBullet({
  label,
  color,
  mutedColor,
}: {
  label: string;
  color: string;
  mutedColor: string;
}) {
  return (
    <View style={styles.eventRow}>
      <Text size="sm" color={color} style={styles.eventBullet}>
        {'\u2022'}
      </Text>
      <Text size="sm" color={mutedColor}>
        {label}
      </Text>
    </View>
  );
}

export function ReputationExplainerActionSheet(_props: SheetProps<'reputation-explainer'>) {
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const handleClose = () => {
    lightHaptic();
    SheetManager.hide('reputation-explainer');
  };

  const textColor = colors.foreground;
  const mutedColor = colors.textMuted;

  // Theme-aware icon colors
  const tealIcon = isDark ? primary[400] : primary[600];
  const tealBg = isDark ? `${primary[400]}20` : `${primary[600]}15`;
  const greenIcon = isDark ? '#4ADE80' : '#16A34A';
  const greenBg = isDark ? 'rgba(74, 222, 128, 0.15)' : 'rgba(22, 163, 74, 0.10)';
  const amberIcon = isDark ? '#FBBF24' : '#D97706';
  const amberBg = isDark ? 'rgba(251, 191, 36, 0.15)' : 'rgba(217, 119, 6, 0.10)';
  const goldIcon = isDark ? '#FBBF24' : '#B45309';
  const goldBg = isDark ? 'rgba(251, 191, 36, 0.15)' : 'rgba(180, 83, 9, 0.10)';

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={[styles.container, { backgroundColor: colors.card }]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
    >
      <View style={[styles.content, { paddingBottom: insets.bottom + spacingPixels[4] }]}>
        {/* Header */}
        <Text size="xl" weight="bold" color={textColor} style={styles.header}>
          {t('explainers.reputation.title')}
        </Text>

        {/* How Reputation Works */}
        <ExplainerSection
          icon="star"
          iconColor={tealIcon}
          iconBackgroundColor={tealBg}
          title={t('explainers.reputation.overview.title')}
          isDark={isDark}
          textColor={textColor}
          mutedColor={mutedColor}
        >
          <Text size="sm" color={mutedColor} style={styles.bodyText}>
            {t('explainers.reputation.overview.body')}
          </Text>
        </ExplainerSection>

        {/* Reputation Tiers */}
        <ExplainerSection
          icon="shield"
          iconColor={goldIcon}
          iconBackgroundColor={goldBg}
          title={t('explainers.reputation.tiers.title')}
          isDark={isDark}
          textColor={textColor}
          mutedColor={mutedColor}
        >
          <TierRow
            color={TIER_COLORS.unknown.text}
            label={t('explainers.reputation.tiers.unknown')}
            range={t('explainers.reputation.tiers.unknownRange')}
            mutedColor={mutedColor}
            textColor={textColor}
          />
          <TierRow
            color={TIER_COLORS.bronze.text}
            label={t('explainers.reputation.tiers.bronze')}
            range="0 – 59"
            mutedColor={mutedColor}
            textColor={textColor}
          />
          <TierRow
            color={TIER_COLORS.silver.text}
            label={t('explainers.reputation.tiers.silver')}
            range="60 – 74"
            mutedColor={mutedColor}
            textColor={textColor}
          />
          <TierRow
            color={TIER_COLORS.gold.text}
            label={t('explainers.reputation.tiers.gold')}
            range="75 – 89"
            mutedColor={mutedColor}
            textColor={textColor}
          />
          <TierRow
            color={TIER_COLORS.platinum.text}
            label={t('explainers.reputation.tiers.platinum')}
            range="90 – 100"
            mutedColor={mutedColor}
            textColor={textColor}
          />
        </ExplainerSection>

        {/* What Affects Your Score */}
        <ExplainerSection
          icon="trending-up"
          iconColor={greenIcon}
          iconBackgroundColor={greenBg}
          title={t('explainers.reputation.impacts.title')}
          isDark={isDark}
          textColor={textColor}
          mutedColor={mutedColor}
        >
          <Text size="xs" weight="semibold" color={textColor} style={styles.impactSubheader}>
            {t('explainers.reputation.impacts.positiveLabel')}
          </Text>
          <EventBullet
            label={t('explainers.reputation.impacts.matchCompleted')}
            color={greenIcon}
            mutedColor={mutedColor}
          />
          <EventBullet
            label={t('explainers.reputation.impacts.onTime')}
            color={greenIcon}
            mutedColor={mutedColor}
          />
          <EventBullet
            label={t('explainers.reputation.impacts.fiveStarReview')}
            color={greenIcon}
            mutedColor={mutedColor}
          />

          <Text size="xs" weight="semibold" color={textColor} style={styles.impactSubheader}>
            {t('explainers.reputation.impacts.negativeLabel')}
          </Text>
          <EventBullet
            label={t('explainers.reputation.impacts.noShow')}
            color={isDark ? '#F87171' : '#DC2626'}
            mutedColor={mutedColor}
          />
          <EventBullet
            label={t('explainers.reputation.impacts.lateCancellation')}
            color={isDark ? '#F87171' : '#DC2626'}
            mutedColor={mutedColor}
          />
          <EventBullet
            label={t('explainers.reputation.impacts.lateArrival')}
            color={isDark ? '#F87171' : '#DC2626'}
            mutedColor={mutedColor}
          />
          <EventBullet
            label={t('explainers.reputation.impacts.oneStarReview')}
            color={isDark ? '#F87171' : '#DC2626'}
            mutedColor={mutedColor}
          />
        </ExplainerSection>

        {/* Score Decay */}
        <ExplainerSection
          icon="time"
          iconColor={tealIcon}
          iconBackgroundColor={tealBg}
          title={t('explainers.reputation.decay.title')}
          isDark={isDark}
          textColor={textColor}
          mutedColor={mutedColor}
        >
          <Text size="sm" color={mutedColor} style={styles.bodyText}>
            {t('explainers.reputation.decay.body')}
          </Text>
        </ExplainerSection>

        {/* Tips */}
        <ExplainerSection
          icon="bulb"
          iconColor={amberIcon}
          iconBackgroundColor={amberBg}
          title={t('explainers.reputation.tips.title')}
          isDark={isDark}
          textColor={textColor}
          mutedColor={mutedColor}
        >
          <Text size="sm" color={mutedColor} style={styles.bodyText}>
            {t('explainers.reputation.tips.body')}
          </Text>
        </ExplainerSection>

        {/* Close Button */}
        <Button variant="primary" size="lg" fullWidth onPress={handleClose} isDark={isDark}>
          {t('common.gotIt')}
        </Button>
      </View>
    </ActionSheet>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopLeftRadius: radiusPixels['2xl'],
    borderTopRightRadius: radiusPixels['2xl'],
  },
  handleIndicator: {
    width: 40,
    height: 4,
    borderRadius: 2,
    marginTop: spacingPixels[2],
  },
  content: {
    paddingHorizontal: spacingPixels[5],
    paddingTop: spacingPixels[4],
  },
  header: {
    textAlign: 'center',
    marginBottom: spacingPixels[5],
  },
  bodyText: {
    lineHeight: 20,
  },
  tierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacingPixels[1.5],
  },
  tierDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: spacingPixels[2],
  },
  tierLabel: {
    marginRight: spacingPixels[2],
    minWidth: 70,
  },
  impactSubheader: {
    marginTop: spacingPixels[2],
    marginBottom: spacingPixels[1],
  },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacingPixels[0.5],
  },
  eventBullet: {
    marginRight: spacingPixels[1.5],
    fontSize: 16,
  },
});
