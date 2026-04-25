import React, { useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import ActionSheet, { SheetManager, SheetProps } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, fontSizePixels } from '@rallia/design-system';
import { useThemeStyles, useTranslation } from '../hooks';
import { useActionsSheet } from '../context';

export function ReferralInviteActionSheet(_props: SheetProps<'referral-invite'>) {
  const { colors } = useThemeStyles();
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
      containerStyle={[styles.sheetContainer, { backgroundColor: colors.cardBackground }]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
    >
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <Ionicons name="people-circle-outline" size={56} color={colors.primary} />
        </View>

        <Text style={[styles.title, { color: colors.foreground }]}>
          {t('referral.inviteModal.title')}
        </Text>

        <Text style={[styles.subtitle, { color: colors.textMuted }]}>
          {t('referral.inviteModal.subtitle')}
        </Text>

        <TouchableOpacity
          onPress={handleInvite}
          style={[styles.ctaButton, { backgroundColor: colors.primary }]}
        >
          <Ionicons name="person-add-outline" size={20} color="#fff" style={styles.ctaIcon} />
          <Text style={styles.ctaButtonText}>{t('referral.inviteModal.selectContacts')}</Text>
        </TouchableOpacity>
      </View>
    </ActionSheet>
  );
}

const styles = StyleSheet.create({
  sheetContainer: {
    borderTopLeftRadius: radiusPixels['2xl'],
    borderTopRightRadius: radiusPixels['2xl'],
  },
  handleIndicator: {
    width: spacingPixels[10],
    height: 4,
    borderRadius: 4,
    alignSelf: 'center',
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
  },
  subtitle: {
    fontSize: fontSizePixels.sm,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: spacingPixels[5],
    paddingHorizontal: spacingPixels[2],
  },
  ctaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 48,
    borderRadius: radiusPixels.lg,
    width: '100%',
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
