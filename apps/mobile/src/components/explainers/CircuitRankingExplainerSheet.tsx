import React from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import ActionSheet, { SheetManager, SheetProps, ScrollView } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text, Button } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, primary } from '@rallia/design-system';
import { lightHaptic } from '@rallia/shared-utils';

import { useThemeStyles, useTranslation } from '#/hooks';

import { ExplainerSection } from './ExplainerSection';

/** One placement → points pill. The champion pill is accented; the rest are
 *  quiet, so the descending sequence reads as "further you go, more you earn". */
function PlacementChip({
  label,
  accent,
  accentBg,
  accentText,
  mutedBg,
  mutedText,
}: {
  label: string;
  accent: boolean;
  accentBg: string;
  accentText: string;
  mutedBg: string;
  mutedText: string;
}) {
  return (
    <View style={[styles.chip, { backgroundColor: accent ? accentBg : mutedBg }]}>
      <Text
        size="xs"
        weight={accent ? 'semibold' : 'medium'}
        color={accent ? accentText : mutedText}
      >
        {label}
      </Text>
    </View>
  );
}

export function CircuitRankingExplainerActionSheet(
  _props: SheetProps<'circuit-ranking-explainer'>
) {
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const { height: windowHeight } = useWindowDimensions();

  const handleClose = () => {
    lightHaptic();
    SheetManager.hide('circuit-ranking-explainer');
  };

  const textColor = colors.foreground;
  const mutedColor = colors.textMuted;

  const tealIcon = isDark ? primary[400] : primary[600];
  const tealBg = isDark ? `${primary[400]}20` : `${primary[600]}15`;
  const accentChipBg = isDark ? `${primary[400]}26` : `${primary[600]}18`;
  const accentChipText = isDark ? primary[300] : primary[700];
  const mutedChipBg = isDark ? `${colors.foreground}12` : `${colors.foreground}0D`;

  // Champion is highlighted; the rest descend in muted pills.
  const placements: { key: string; label: string; accent: boolean }[] = [
    { key: 'champion', label: t('explainers.circuitRanking.placements.champion'), accent: true },
    { key: 'finalist', label: t('explainers.circuitRanking.placements.finalist'), accent: false },
    { key: 'semifinal', label: t('explainers.circuitRanking.placements.semifinal'), accent: false },
    {
      key: 'quarterfinal',
      label: t('explainers.circuitRanking.placements.quarterfinal'),
      accent: false,
    },
    { key: 'played', label: t('explainers.circuitRanking.placements.played'), accent: false },
  ];

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={[styles.container, { backgroundColor: colors.cardBackground }]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
    >
      <Text size="xl" weight="bold" color={textColor} style={styles.header}>
        {t('explainers.circuitRanking.title')}
      </Text>
      <Text size="sm" color={mutedColor} style={styles.intro}>
        {t('explainers.circuitRanking.intro')}
      </Text>

      <ScrollView
        style={[styles.scrollContent, { maxHeight: windowHeight * 0.55 }]}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* How far you get — placement points */}
        <ExplainerSection
          icon="trending-up"
          iconColor={tealIcon}
          iconBackgroundColor={tealBg}
          title={t('explainers.circuitRanking.placement.title')}
          isDark={isDark}
          textColor={textColor}
          mutedColor={mutedColor}
        >
          <View style={styles.chipRow}>
            {placements.map(p => (
              <PlacementChip
                key={p.key}
                label={p.label}
                accent={p.accent}
                accentBg={accentChipBg}
                accentText={accentChipText}
                mutedBg={mutedChipBg}
                mutedText={mutedColor}
              />
            ))}
          </View>
          <Text size="xs" color={mutedColor} style={styles.chipNote}>
            {t('explainers.circuitRanking.placement.note')}
          </Text>
        </ExplainerSection>

        {/* What a tournament is worth — draw size + level */}
        <ExplainerSection
          icon="expand"
          iconColor={tealIcon}
          iconBackgroundColor={tealBg}
          title={t('explainers.circuitRanking.worth.title')}
          isDark={isDark}
          textColor={textColor}
          mutedColor={mutedColor}
        >
          <Text size="sm" color={mutedColor} style={styles.bodyText}>
            {t('explainers.circuitRanking.worth.body')}
          </Text>
        </ExplainerSection>

        {/* Your season score — best 8 */}
        <ExplainerSection
          icon="medal"
          iconColor={tealIcon}
          iconBackgroundColor={tealBg}
          title={t('explainers.circuitRanking.season.title')}
          isDark={isDark}
          textColor={textColor}
          mutedColor={mutedColor}
        >
          <Text size="sm" color={mutedColor} style={styles.bodyText}>
            {t('explainers.circuitRanking.season.body')}
          </Text>
        </ExplainerSection>

        {/* Fine print — certified organizer + seasons */}
        <View style={[styles.finePrint, { backgroundColor: mutedChipBg }]}>
          <Ionicons
            name="shield-checkmark-outline"
            size={16}
            color={mutedColor}
            style={styles.finePrintIcon}
          />
          <Text size="xs" color={mutedColor} style={styles.finePrintText}>
            {t('explainers.circuitRanking.finePrint')}
          </Text>
        </View>
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: colors.border }]}>
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
    width: spacingPixels[10],
    height: 4,
    borderRadius: 4,
    alignSelf: 'center',
  },
  scrollContent: {},
  content: {
    paddingHorizontal: spacingPixels[5],
  },
  header: {
    textAlign: 'center',
    paddingTop: spacingPixels[4],
    paddingHorizontal: spacingPixels[5],
    marginBottom: spacingPixels[1],
  },
  intro: {
    textAlign: 'center',
    paddingHorizontal: spacingPixels[5],
    marginBottom: spacingPixels[5],
    lineHeight: 20,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacingPixels[1.5],
  },
  chip: {
    paddingVertical: spacingPixels[1],
    paddingHorizontal: spacingPixels[2.5],
    borderRadius: radiusPixels.full,
  },
  chipNote: {
    marginTop: spacingPixels[2],
    lineHeight: 18,
  },
  bodyText: {
    lineHeight: 20,
  },
  footer: {
    padding: spacingPixels[4],
    borderTopWidth: 1,
  },
  finePrint: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacingPixels[2],
    padding: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    marginBottom: spacingPixels[2],
  },
  finePrintIcon: {
    marginTop: 1,
  },
  finePrintText: {
    flex: 1,
    lineHeight: 18,
  },
});
