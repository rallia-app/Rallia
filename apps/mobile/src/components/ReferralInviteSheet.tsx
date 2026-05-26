import React, { useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import ActionSheet, { SheetManager, SheetProps } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, fontSizePixels } from '@rallia/design-system';

import { useThemedStyles, useTranslation, type ThemedStylesContext } from '#/hooks';
import { useActionsSheet } from '#/context';

export function ReferralInviteActionSheet(_props: SheetProps<'referral-invite'>) {
  const { styles, colors } = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const { openSheetForInvitePlayers } = useActionsSheet();

  const handleInvite = useCallback(async () => {
    await SheetManager.hide('referral-invite');
    setTimeout(() => {
      openSheetForInvitePlayers();
    }, 300);
  }, [openSheetForInvitePlayers]);

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={styles.sheetContainer}
      indicatorStyle={styles.handleIndicator}
    >
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <Ionicons name="people-circle-outline" size={56} color={colors.primary} />
        </View>

        <Text style={styles.title}>{t('referral.inviteModal.title')}</Text>

        <Text style={styles.subtitle}>{t('referral.inviteModal.subtitle')}</Text>

        <TouchableOpacity onPress={handleInvite} style={styles.ctaButton}>
          <Ionicons name="person-add-outline" size={20} color="#fff" style={styles.ctaIcon} />
          <Text style={styles.ctaButtonText}>{t('referral.inviteModal.selectContacts')}</Text>
        </TouchableOpacity>
      </View>
    </ActionSheet>
  );
}

// react-native/no-unused-styles can't trace styles through the useThemedStyles
// factory (they're consumed via the hook return, not a top-level `styles` const).
/* eslint-disable react-native/no-unused-styles */
const makeStyles = ({ colors }: ThemedStylesContext) =>
  StyleSheet.create({
    sheetContainer: {
      backgroundColor: colors.cardBackground,
      borderTopLeftRadius: radiusPixels['2xl'],
      borderTopRightRadius: radiusPixels['2xl'],
    },
    handleIndicator: {
      width: spacingPixels[10],
      height: 4,
      borderRadius: 4,
      alignSelf: 'center',
      backgroundColor: colors.border,
    },
    content: {
      padding: spacingPixels[5],
      paddingBottom: spacingPixels[8],
      alignItems: 'center',
    },
    iconContainer: {
      marginBottom: spacingPixels[3],
    },
    title: {
      fontSize: fontSizePixels.xl,
      fontWeight: '700',
      textAlign: 'center',
      marginBottom: spacingPixels[2],
      color: colors.foreground,
    },
    subtitle: {
      fontSize: fontSizePixels.sm,
      lineHeight: 20,
      textAlign: 'center',
      marginBottom: spacingPixels[5],
      paddingHorizontal: spacingPixels[2],
      color: colors.textMuted,
    },
    ctaButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      height: 48,
      borderRadius: radiusPixels.lg,
      width: '100%',
      backgroundColor: colors.primary,
    },
    ctaIcon: {
      marginRight: spacingPixels[2],
    },
    ctaButtonText: {
      color: '#fff',
      fontSize: fontSizePixels.base,
      fontWeight: '600',
    },
  });
