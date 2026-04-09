import React from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import ActionSheet, { SheetManager, SheetProps, ScrollView } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text, Button } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, neutral, primary } from '@rallia/design-system';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { lightHaptic } from '@rallia/shared-utils';
import { useThemeStyles, useTranslation } from '../../hooks';
import { ExplainerSection } from './ExplainerSection';
import { CERTIFICATION_BADGE_COLORS } from '../RatingBadge';

function CertificationDot({
  color,
  label,
  mutedColor,
}: {
  color: string;
  label: string;
  mutedColor: string;
}) {
  return (
    <View style={styles.certRow}>
      <View style={[styles.certDot, { backgroundColor: color }]} />
      <Text size="sm" color={mutedColor}>
        {label}
      </Text>
    </View>
  );
}

export function RatingExplainerActionSheet({ payload }: SheetProps<'rating-explainer'>) {
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const sportName = payload?.sportName ?? 'tennis';

  const handleClose = () => {
    lightHaptic();
    SheetManager.hide('rating-explainer');
  };

  const textColor = colors.foreground;
  const mutedColor = colors.textMuted;

  // Theme-aware icon colors — lighter shades in dark mode for better contrast
  const tealIcon = isDark ? primary[400] : primary[600];
  const tealBg = isDark ? `${primary[400]}20` : `${primary[600]}15`;
  const greenIcon = isDark ? '#4ADE80' : '#16A34A';
  const greenBg = isDark ? 'rgba(74, 222, 128, 0.15)' : 'rgba(22, 163, 74, 0.10)';
  const amberIcon = isDark ? '#FBBF24' : '#D97706';
  const amberBg = isDark ? 'rgba(251, 191, 36, 0.15)' : 'rgba(217, 119, 6, 0.10)';

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={[styles.container, { backgroundColor: colors.card }]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
    >
      {/* Header */}
      <Text size="xl" weight="bold" color={textColor} style={styles.header}>
        {t('explainers.rating.title')}
      </Text>

      <ScrollView
        style={[styles.scrollContent, { maxHeight: windowHeight * 0.6 }]}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* How Ratings Work */}
        <ExplainerSection
          icon="analytics"
          iconColor={tealIcon}
          iconBackgroundColor={tealBg}
          title={t('explainers.rating.overview.title')}
          isDark={isDark}
          textColor={textColor}
          mutedColor={mutedColor}
        >
          <Text size="sm" color={mutedColor} style={styles.bodyText}>
            {t(
              sportName === 'tennis'
                ? 'explainers.rating.overview.bodyTennis'
                : 'explainers.rating.overview.bodyPickleball'
            )}
          </Text>
        </ExplainerSection>

        {/* Certification Levels */}
        <ExplainerSection
          icon="shield-checkmark"
          iconColor={greenIcon}
          iconBackgroundColor={greenBg}
          title={t('explainers.rating.certification.title')}
          isDark={isDark}
          textColor={textColor}
          mutedColor={mutedColor}
        >
          <CertificationDot
            color={CERTIFICATION_BADGE_COLORS.self_declared.bg}
            label={t('explainers.rating.certification.selfDeclared')}
            mutedColor={mutedColor}
          />
          <CertificationDot
            color={CERTIFICATION_BADGE_COLORS.certified.bg}
            label={t('explainers.rating.certification.certified')}
            mutedColor={mutedColor}
          />
          <CertificationDot
            color={CERTIFICATION_BADGE_COLORS.disputed.bg}
            label={t('explainers.rating.certification.disputed')}
            mutedColor={mutedColor}
          />
        </ExplainerSection>

        {/* How to Get Certified */}
        <ExplainerSection
          icon="ribbon"
          iconColor={tealIcon}
          iconBackgroundColor={tealBg}
          title={t('explainers.rating.howToCertify.title')}
          isDark={isDark}
          textColor={textColor}
          mutedColor={mutedColor}
        >
          <Text size="sm" color={mutedColor} style={styles.bodyText}>
            {t('explainers.rating.howToCertify.body')}
          </Text>
        </ExplainerSection>

        {/* Proof Types */}
        <ExplainerSection
          icon="document-text"
          iconColor={tealIcon}
          iconBackgroundColor={tealBg}
          title={t('explainers.rating.proofTypes.title')}
          isDark={isDark}
          textColor={textColor}
          mutedColor={mutedColor}
        >
          <Text size="sm" color={mutedColor} style={styles.bodyText}>
            {t('explainers.rating.proofTypes.body')}
          </Text>
        </ExplainerSection>

        {/* Tips */}
        <ExplainerSection
          icon="bulb"
          iconColor={amberIcon}
          iconBackgroundColor={amberBg}
          title={t('explainers.rating.tips.title')}
          isDark={isDark}
          textColor={textColor}
          mutedColor={mutedColor}
        >
          <Text size="sm" color={mutedColor} style={styles.bodyText}>
            {t('explainers.rating.tips.body')}
          </Text>
        </ExplainerSection>
      </ScrollView>

      {/* Sticky Footer */}
      <View
        style={[
          styles.footer,
          { borderTopColor: colors.border, paddingBottom: insets.bottom + spacingPixels[4] },
        ]}
      >
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
    paddingHorizontal: spacingPixels[5],
    paddingTop: spacingPixels[4],
    borderTopWidth: 1,
  },
  bodyText: {
    lineHeight: 20,
  },
  certRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacingPixels[1.5],
  },
  certDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: spacingPixels[2],
  },
});
