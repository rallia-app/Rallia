/**
 * ChoosePayoutsSheet
 *
 * First-time prompt for hosts: how do they want to handle court reimbursements
 * — Stripe (auto-collect via Apple/Google Pay) or Manual (track only)?
 *
 * Opens via SheetManager.show('choose-payouts', { payload: { onChoose, onLater } }).
 */

import React from 'react';
import { Platform } from 'react-native';
import { SheetManager, SheetProps } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text, Card, Button, VStack, HStack, Badge } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, primary, neutral, base } from '@rallia/design-system';
import { lightHaptic, selectionHaptic } from '@rallia/shared-utils';

import { BaseActionSheet } from './BaseActionSheet';
import { useThemeStyles, useTranslation, type TranslationKey } from '../hooks';

export function ChoosePayoutsActionSheet(props: SheetProps<'choose-payouts'>) {
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();

  const handleAuto = async () => {
    selectionHaptic();
    await SheetManager.hide('choose-payouts');
    props.payload?.onChoose?.('auto');
  };

  const handleManual = async () => {
    selectionHaptic();
    await SheetManager.hide('choose-payouts');
    props.payload?.onChoose?.('manual_only');
  };

  const handleLater = async () => {
    lightHaptic();
    await SheetManager.hide('choose-payouts');
    props.payload?.onLater?.();
  };

  const walletIcon = Platform.OS === 'android' ? 'logo-google' : 'logo-apple';

  return (
    <BaseActionSheet
      title={t('matchDetail.choosePayouts.title' as TranslationKey)}
      onClose={handleLater}
      flex={false}
    >
      <VStack spacing={spacingPixels[3]} style={{ padding: spacingPixels[4] }}>
        <Text size="sm" color={colors.textMuted}>
          {t('matchDetail.choosePayouts.subtitle' as TranslationKey)}
        </Text>

        {/* Stripe option (recommended) */}
        <Card
          variant="outlined"
          padding={spacingPixels[4]}
          borderRadius={radiusPixels.xl}
          backgroundColor={isDark ? `${primary[500]}14` : `${primary[500]}0A`}
          style={{
            borderColor: colors.primary,
            borderWidth: 2,
          }}
          onPress={handleAuto}
        >
          <VStack spacing={spacingPixels[2]} align="start">
            <HStack spacing={spacingPixels[2]} align="center">
              <Ionicons name={walletIcon} size={20} color={colors.primary} />
              <Text size="base" weight="semibold" color={colors.primary}>
                {t('matchDetail.choosePayouts.stripeOption' as TranslationKey)}
              </Text>
              <Badge variant="primary" size="sm">
                {t('matchDetail.choosePayouts.stripeBadge' as TranslationKey)}
              </Badge>
            </HStack>
            <Text size="xs" color={colors.textMuted}>
              {t('matchDetail.choosePayouts.stripeDescription' as TranslationKey)}
            </Text>
          </VStack>
        </Card>

        {/* Manual option */}
        <Card
          variant="outlined"
          padding={spacingPixels[4]}
          borderRadius={radiusPixels.xl}
          backgroundColor={colors.cardBackground}
          style={{
            borderColor: colors.border,
          }}
          onPress={handleManual}
        >
          <VStack spacing={spacingPixels[2]} align="start">
            <HStack spacing={spacingPixels[2]} align="center">
              <Ionicons name="hand-left-outline" size={20} color={colors.text} />
              <Text size="base" weight="semibold" color={colors.text}>
                {t('matchDetail.choosePayouts.manualOption' as TranslationKey)}
              </Text>
              <Badge variant="default" size="sm">
                {t('matchDetail.choosePayouts.manualBadge' as TranslationKey)}
              </Badge>
            </HStack>
            <Text size="xs" color={colors.textMuted}>
              {t('matchDetail.choosePayouts.manualDescription' as TranslationKey)}
            </Text>
          </VStack>
        </Card>

        {/* Later */}
        <Button
          variant="ghost"
          size="sm"
          onPress={handleLater}
          isDark={isDark}
          themeColors={{
            primary: colors.primary,
            primaryForeground: base.white,
            buttonActive: colors.primary,
            buttonInactive: isDark ? neutral[700] : neutral[300],
            buttonTextActive: base.white,
            buttonTextInactive: isDark ? neutral[400] : neutral[500],
            text: colors.textMuted,
            textMuted: colors.textMuted,
            border: colors.border,
            background: colors.cardBackground,
          }}
        >
          {t('matchDetail.choosePayouts.later' as TranslationKey)}
        </Button>
      </VStack>
    </BaseActionSheet>
  );
}

export default ChoosePayoutsActionSheet;
