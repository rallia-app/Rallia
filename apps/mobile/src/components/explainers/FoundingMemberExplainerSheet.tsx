import React from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import ActionSheet, { SheetManager, SheetProps, ScrollView } from 'react-native-actions-sheet';
import { Text, Button } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, primary, secondary } from '@rallia/design-system';
import { lightHaptic } from '@rallia/shared-utils';

import { useThemeStyles, useTranslation } from '#/hooks';

import { ExplainerSection } from './ExplainerSection';

export function FoundingMemberExplainerActionSheet(
  _props: SheetProps<'founding-member-explainer'>
) {
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const { height: windowHeight } = useWindowDimensions();

  const handleClose = () => {
    lightHaptic();
    SheetManager.hide('founding-member-explainer');
  };

  const textColor = colors.foreground;
  const mutedColor = colors.textMuted;

  // Theme-aware icon colors — coral leads to match the badge
  const coralIcon = isDark ? secondary[400] : secondary[500];
  const coralBg = isDark ? `${secondary[400]}20` : `${secondary[500]}15`;
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
        {t('explainers.foundingMember.title')}
      </Text>

      <ScrollView
        style={[styles.scrollContent, { maxHeight: windowHeight * 0.6 }]}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* What it is */}
        <ExplainerSection
          icon="ribbon"
          iconColor={coralIcon}
          iconBackgroundColor={coralBg}
          title={t('explainers.foundingMember.overview.title')}
          isDark={isDark}
          textColor={textColor}
          mutedColor={mutedColor}
        >
          <Text size="sm" color={mutedColor} style={styles.bodyText}>
            {t('explainers.foundingMember.overview.body')}
          </Text>
        </ExplainerSection>

        {/* Closed for good */}
        <ExplainerSection
          icon="lock-closed"
          iconColor={tealIcon}
          iconBackgroundColor={tealBg}
          title={t('explainers.foundingMember.forever.title')}
          isDark={isDark}
          textColor={textColor}
          mutedColor={mutedColor}
        >
          <Text size="sm" color={mutedColor} style={styles.bodyText}>
            {t('explainers.foundingMember.forever.body')}
          </Text>
        </ExplainerSection>

        {/* Why it matters */}
        <ExplainerSection
          icon="heart"
          iconColor={greenIcon}
          iconBackgroundColor={greenBg}
          title={t('explainers.foundingMember.benefits.title')}
          isDark={isDark}
          textColor={textColor}
          mutedColor={mutedColor}
        >
          <Text size="sm" color={mutedColor} style={styles.bodyText}>
            {t('explainers.foundingMember.benefits.body')}
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
});
