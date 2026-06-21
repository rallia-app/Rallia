import React from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ActionSheet, { SheetManager, SheetProps, ScrollView } from 'react-native-actions-sheet';
import { Text, Button } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, primary, accent } from '@rallia/design-system';
import { lightHaptic } from '@rallia/shared-utils';

import { useThemeStyles, useTranslation } from '#/hooks';

import { ExplainerSection } from './ExplainerSection';

function RequirementRow({
  icon,
  iconColor,
  label,
  detail,
  textColor,
  mutedColor,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  label: string;
  detail: string;
  textColor: string;
  mutedColor: string;
}) {
  return (
    <View style={styles.requirementRow}>
      <Ionicons name={icon} size={18} color={iconColor} style={styles.requirementIcon} />
      <View style={styles.requirementText}>
        <Text size="sm" weight="medium" color={textColor}>
          {label}
        </Text>
        <Text size="xs" color={mutedColor} style={styles.requirementDetail}>
          {detail}
        </Text>
      </View>
    </View>
  );
}

export function CovetedPlayerExplainerActionSheet(_props: SheetProps<'coveted-player-explainer'>) {
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const { height: windowHeight } = useWindowDimensions();

  const handleClose = () => {
    lightHaptic();
    SheetManager.hide('coveted-player-explainer');
  };

  const textColor = colors.foreground;
  const mutedColor = colors.textMuted;

  // Theme-aware icon colors
  const accentColor = isDark ? accent[400] : accent[500];
  const accentBg = isDark ? `${accent[400]}20` : `${accent[500]}15`;
  const tealIcon = isDark ? primary[400] : primary[600];
  const tealBg = isDark ? `${primary[400]}20` : `${primary[600]}15`;
  const greenIcon = isDark ? '#4ADE80' : '#16A34A';
  const greenBg = isDark ? 'rgba(74, 222, 128, 0.15)' : 'rgba(22, 163, 74, 0.10)';

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={[styles.container, { backgroundColor: colors.cardBackground }]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
    >
      {/* Header */}
      <Text size="xl" weight="bold" color={textColor} style={styles.header}>
        {t('explainers.covetedPlayer.title')}
      </Text>

      <ScrollView
        style={[styles.scrollContent, { maxHeight: windowHeight * 0.6 }]}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* What is a Coveted Player */}
        <ExplainerSection
          icon="star"
          iconColor={accentColor}
          iconBackgroundColor={accentBg}
          title={t('explainers.covetedPlayer.overview.title')}
          isDark={isDark}
          textColor={textColor}
          mutedColor={mutedColor}
        >
          <Text size="sm" color={mutedColor} style={styles.bodyText}>
            {t('explainers.covetedPlayer.overview.body')}
          </Text>
        </ExplainerSection>

        {/* How to become one */}
        <ExplainerSection
          icon="trophy"
          iconColor={tealIcon}
          iconBackgroundColor={tealBg}
          title={t('explainers.covetedPlayer.requirements.title')}
          isDark={isDark}
          textColor={textColor}
          mutedColor={mutedColor}
        >
          <RequirementRow
            icon="ribbon"
            iconColor={tealIcon}
            label={t('explainers.covetedPlayer.requirements.certified')}
            detail={t('explainers.covetedPlayer.requirements.certifiedDetail')}
            textColor={textColor}
            mutedColor={mutedColor}
          />
          <RequirementRow
            icon="shield-checkmark"
            iconColor={tealIcon}
            label={t('explainers.covetedPlayer.requirements.reputation')}
            detail={t('explainers.covetedPlayer.requirements.reputationDetail')}
            textColor={textColor}
            mutedColor={mutedColor}
          />
          <Text size="sm" color={mutedColor} style={styles.note}>
            {t('explainers.covetedPlayer.requirements.note')}
          </Text>
        </ExplainerSection>

        {/* Why it matters */}
        <ExplainerSection
          icon="trending-up"
          iconColor={greenIcon}
          iconBackgroundColor={greenBg}
          title={t('explainers.covetedPlayer.benefits.title')}
          isDark={isDark}
          textColor={textColor}
          mutedColor={mutedColor}
        >
          <Text size="sm" color={mutedColor} style={styles.bodyText}>
            {t('explainers.covetedPlayer.benefits.body')}
          </Text>
        </ExplainerSection>
      </ScrollView>

      {/* Sticky Footer */}
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
    marginBottom: spacingPixels[5],
  },
  footer: {
    padding: spacingPixels[4],
    borderTopWidth: 1,
  },
  bodyText: {
    lineHeight: 20,
  },
  note: {
    marginTop: spacingPixels[1],
    lineHeight: 20,
  },
  requirementRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacingPixels[3],
  },
  requirementIcon: {
    marginRight: spacingPixels[2],
    marginTop: 1,
  },
  requirementText: {
    flex: 1,
  },
  requirementDetail: {
    marginTop: spacingPixels[0.5],
    lineHeight: 16,
  },
});
