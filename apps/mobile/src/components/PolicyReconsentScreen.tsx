/**
 * PolicyReconsentScreen — full-screen blocking gate shown when the signed-in
 * user has not accepted the current version of the Privacy Policy and/or
 * Terms of Use (policy_versions bumped since their last acceptance).
 *
 * Rendered by <ConsentGate> in App.tsx, so it doesn't sit inside any
 * navigation context — it's the only thing on the screen. Only shows a
 * checkbox for the policy_type(s) actually pending (not always both), reusing
 * the same icon-badge + card-checkbox visual as the onboarding ConsentStep.
 * Existing users are grandfathered via a migration backfill, so in practice
 * this only ever renders after a real policy version bump, never on rollout.
 */

import React, { useCallback, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text, Button } from '@rallia/shared-components';
import { spacingPixels } from '@rallia/design-system';
import {
  acceptPolicyConsent,
  Logger,
  type PendingPolicyConsent,
  type PolicyType,
} from '@rallia/shared-services';

import { useThemeStyles, useTranslation } from '#/hooks';
import { useAuth } from '#/context';
import { getPolicyUrl } from '#/utils/policyUrls';
import {
  PolicyConsentCheckbox,
  PolicyConsentIconBadge,
  getPolicyConsentTint,
} from '#/components/PolicyConsentCheckbox';

interface PolicyReconsentScreenProps {
  pending: PendingPolicyConsent[];
  onAccepted: () => void;
}

export function PolicyReconsentScreen({ pending, onAccepted }: PolicyReconsentScreenProps) {
  const { colors, isDark } = useThemeStyles();
  const { t, locale } = useTranslation();
  const { signOut } = useAuth();
  const { checkedTint } = getPolicyConsentTint(isDark);

  const [checked, setChecked] = useState<Partial<Record<PolicyType, boolean>>>({});
  const [isSaving, setIsSaving] = useState(false);

  const allChecked = pending.every(p => checked[p.policy_type]);

  const handleAccept = useCallback(async () => {
    setIsSaving(true);
    try {
      await Promise.all(pending.map(p => acceptPolicyConsent(p.policy_type, p.current_version)));
      onAccepted();
    } catch (error) {
      Logger.error('Failed to accept policy consent', error as Error);
      Alert.alert(t('alerts.error'), t('policyConsent.gate.acceptError'));
      setIsSaving(false);
    }
  }, [pending, onAccepted, t]);

  const handleSignOut = useCallback(() => {
    Alert.alert(
      t('policyConsent.gate.signOutConfirmTitle'),
      t('policyConsent.gate.signOutConfirmMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('auth.signOut'), style: 'destructive', onPress: () => signOut() },
      ]
    );
  }, [signOut, t]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.content}>
        <PolicyConsentIconBadge isDark={isDark} />

        <Text size="xl" weight="bold" color={colors.text} style={styles.title}>
          {t('policyConsent.gate.title')}
        </Text>
        <Text size="sm" color={colors.textSecondary} style={styles.subtitle}>
          {t('policyConsent.gate.subtitle')}
        </Text>

        <View style={styles.consentContainer}>
          {pending.some(p => p.policy_type === 'privacy') && (
            <PolicyConsentCheckbox
              checked={!!checked.privacy}
              onToggle={() => setChecked(c => ({ ...c, privacy: !c.privacy }))}
              prefix={t('auth.consent.privacyPrefix')}
              linkLabel={t('auth.consent.privacyLink')}
              suffix={t('auth.consent.privacySuffix')}
              url={getPolicyUrl('privacy', locale)}
              colors={colors}
              checkedTint={checkedTint}
            />
          )}
          {pending.some(p => p.policy_type === 'terms') && (
            <PolicyConsentCheckbox
              checked={!!checked.terms}
              onToggle={() => setChecked(c => ({ ...c, terms: !c.terms }))}
              prefix={t('auth.consent.termsPrefix')}
              linkLabel={t('auth.consent.termsLink')}
              suffix={t('auth.consent.termsSuffix')}
              url={getPolicyUrl('terms', locale)}
              colors={colors}
              checkedTint={checkedTint}
            />
          )}
        </View>
      </View>

      <View style={styles.footer}>
        <Button
          variant="primary"
          size="lg"
          onPress={handleAccept}
          disabled={!allChecked || isSaving}
          loading={isSaving}
          fullWidth
        >
          {t('policyConsent.gate.accept')}
        </Button>
        <TouchableOpacity onPress={handleSignOut} style={styles.signOutButton}>
          <Text size="sm" color={colors.textSecondary}>
            {t('auth.signOut')}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: spacingPixels[6],
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    textAlign: 'center',
    marginBottom: spacingPixels[2],
  },
  subtitle: {
    textAlign: 'center',
    marginBottom: spacingPixels[6],
    lineHeight: 20,
    paddingHorizontal: spacingPixels[2],
  },
  consentContainer: {
    width: '100%',
    gap: spacingPixels[3],
  },
  footer: {
    paddingBottom: spacingPixels[6],
    gap: spacingPixels[3],
  },
  signOutButton: {
    alignSelf: 'center',
    padding: spacingPixels[2],
  },
});

export default PolicyReconsentScreen;
