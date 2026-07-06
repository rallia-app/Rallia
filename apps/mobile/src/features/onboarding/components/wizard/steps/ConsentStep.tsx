/**
 * ConsentStep Component
 *
 * First step of onboarding — privacy policy + terms of use consent.
 * Only ever shown to brand-new accounts (onboarding only runs before
 * onboarding_completed is set); existing users signing in skip straight
 * past the wizard and never see this step. Persistence happens in
 * OnboardingWizard's validateAndSaveStep, not here — this step is purely
 * presentational, driven by formData/onUpdateFormData.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { ScrollView as SheetScrollView } from 'react-native-actions-sheet';
import { Text } from '@rallia/shared-components';
import { spacingPixels } from '@rallia/design-system';
import type { TranslationKey } from '@rallia/shared-translations';

import type { OnboardingFormData } from '#/features/onboarding/hooks/useOnboardingWizard';
import {
  PolicyConsentCheckbox,
  PolicyConsentIconBadge,
  getPolicyConsentTint,
  type PolicyConsentColors,
} from '#/components/PolicyConsentCheckbox';

interface ConsentStepProps {
  formData: OnboardingFormData;
  onUpdateFormData: (updates: Partial<OnboardingFormData>) => void;
  colors: PolicyConsentColors;
  t: (key: TranslationKey) => string;
  isDark: boolean;
}

export const ConsentStep: React.FC<ConsentStepProps> = ({
  formData,
  onUpdateFormData,
  colors,
  t,
  isDark,
}) => {
  const { checkedTint } = getPolicyConsentTint(isDark);

  return (
    <SheetScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
    >
      <PolicyConsentIconBadge isDark={isDark} />

      <Text size="xl" weight="bold" color={colors.text} style={styles.title}>
        {t('onboarding.consentStep.title')}
      </Text>
      <Text size="sm" color={colors.textSecondary} style={styles.subtitle}>
        {t('onboarding.consentStep.subtitle')}
      </Text>

      <View style={styles.consentContainer}>
        <PolicyConsentCheckbox
          checked={formData.hasAcceptedPrivacy}
          onToggle={() => onUpdateFormData({ hasAcceptedPrivacy: !formData.hasAcceptedPrivacy })}
          prefix={t('auth.consent.privacyPrefix')}
          linkLabel={t('auth.consent.privacyLink')}
          suffix={t('auth.consent.privacySuffix')}
          url="https://rallia.ca/privacy"
          colors={colors}
          checkedTint={checkedTint}
        />
        <PolicyConsentCheckbox
          checked={formData.hasAcceptedTerms}
          onToggle={() => onUpdateFormData({ hasAcceptedTerms: !formData.hasAcceptedTerms })}
          prefix={t('auth.consent.termsPrefix')}
          linkLabel={t('auth.consent.termsLink')}
          suffix={t('auth.consent.termsSuffix')}
          url="https://rallia.ca/terms"
          colors={colors}
          checkedTint={checkedTint}
        />
      </View>
    </SheetScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    padding: spacingPixels[4],
    paddingBottom: spacingPixels[8],
    flexGrow: 1,
  },
  title: {
    textAlign: 'center',
    marginBottom: spacingPixels[2],
  },
  subtitle: {
    textAlign: 'center',
    marginBottom: spacingPixels[6],
    lineHeight: 20,
  },
  consentContainer: {
    gap: spacingPixels[3],
  },
});

export default ConsentStep;
