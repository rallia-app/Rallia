/**
 * PaidEntryConfirmSheet
 *
 * Point-of-sale confirmation for a PAID tournament entry, and the gate that
 * records participation consent.
 *
 * Replaces the Alert.alert this flow used to run. An Alert can carry the price
 * disclosure but not a checkbox or tappable document links, and Jean's
 * conditions générales + décharge need an explicit acceptance act to be part
 * of the contract (specs/17-leagues-tournaments/participation-consent.md).
 * The disclosure text is carried over unchanged: breakdown, refund policy,
 * non-refundable service fee, liability notice.
 *
 * One tick covers both documents, each opening in the browser. Paying is
 * disabled until it is ticked, and the accepted version rides along with the
 * payment call so the server can stamp it on the registration row.
 */

import React, { useCallback, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import ActionSheet, { SheetManager, SheetProps, ScrollView } from 'react-native-actions-sheet';
import { Button, Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import { lightHaptic } from '@rallia/shared-utils';

import { useThemeStyles, useTranslation } from '#/hooks';
import { PolicyConsentCheckbox, getPolicyConsentTint } from '#/components/PolicyConsentCheckbox';

export const PAID_ENTRY_CONFIRM_SHEET = 'paid-entry-confirm';

export function PaidEntryConfirmSheet({ payload }: SheetProps<'paid-entry-confirm'>) {
  const { colors, isDark } = useThemeStyles();
  const { t, locale } = useTranslation();
  const [accepted, setAccepted] = useState(false);

  const lines = payload?.disclosureLines ?? [];
  const totalLabel = payload?.totalLabel;
  const terms = payload?.terms;
  const onConfirm = payload?.onConfirm;

  // No terms row published yet: the server still admits an unstamped entry
  // while the gate is off, so fall back to the old behaviour rather than
  // stranding the player behind a checkbox that cannot be satisfied.
  const requiresConsent = !!terms;
  const canPay = !requiresConsent || accepted;

  const handleConfirm = useCallback(() => {
    if (!canPay) return;
    void SheetManager.hide(PAID_ENTRY_CONFIRM_SHEET);
    onConfirm?.(terms?.version);
  }, [canPay, onConfirm, terms]);

  const handleCancel = useCallback(() => {
    void lightHaptic();
    void SheetManager.hide(PAID_ENTRY_CONFIRM_SHEET);
  }, []);

  const termsUrl = locale === 'fr-CA' ? terms?.urlFr : terms?.urlEn;
  // Both documents live at sibling paths and each links to the other; the
  // waiver URL is the terms URL with the last segment swapped.
  const waiverUrl = termsUrl?.replace(/participation-terms$/, 'liability-waiver');

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={[styles.sheet, { backgroundColor: colors.cardBackground }]}
      indicatorStyle={[styles.indicator, { backgroundColor: colors.border }]}
    >
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text size="lg" weight="semibold" color={colors.text}>
          {t('tournamentDetail.payments.confirmTitle')}
        </Text>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        {lines.map((line, i) => (
          <Text key={i} size="sm" color={colors.textMuted} style={styles.line}>
            {line}
          </Text>
        ))}

        {requiresConsent && termsUrl && waiverUrl ? (
          <View style={styles.consent}>
            <PolicyConsentCheckbox
              checked={accepted}
              onToggle={() => setAccepted(v => !v)}
              prefix={t('tournamentDetail.payments.consentPrefix')}
              linkLabel={t('tournamentDetail.payments.consentTermsLink')}
              middle={t('tournamentDetail.payments.consentMiddle')}
              secondLinkLabel={t('tournamentDetail.payments.consentWaiverLink')}
              suffix={t('tournamentDetail.payments.consentSuffix')}
              url={termsUrl}
              secondUrl={waiverUrl}
              colors={colors}
              checkedTint={getPolicyConsentTint(isDark).checkedTint}
            />
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <Button
          variant="primary"
          disabled={!canPay}
          onPress={handleConfirm}
          testID="paid-entry-confirm-pay"
        >
          {totalLabel
            ? `${t('tournamentDetail.payments.confirmPay')} · ${totalLabel}`
            : t('tournamentDetail.payments.confirmPay')}
        </Button>
        <Button variant="ghost" onPress={handleCancel}>
          {t('common.cancel')}
        </Button>
      </View>
    </ActionSheet>
  );
}

const styles = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: radiusPixels['2xl'],
    borderTopRightRadius: radiusPixels['2xl'],
  },
  indicator: {
    width: spacingPixels[10],
    height: 4,
    borderRadius: 4,
    alignSelf: 'center',
  },
  header: {
    alignItems: 'center',
    padding: spacingPixels[4],
    borderBottomWidth: 1,
  },
  body: {
    maxHeight: 420,
  },
  bodyContent: {
    padding: spacingPixels[4],
  },
  line: {
    lineHeight: 20,
    marginBottom: spacingPixels[3],
  },
  consent: {
    marginTop: spacingPixels[2],
  },
  footer: {
    padding: spacingPixels[4],
    borderTopWidth: 1,
    gap: spacingPixels[2],
  },
});

export default PaidEntryConfirmSheet;
