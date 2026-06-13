/**
 * TournamentInviteSheet
 *
 * Organizer-facing share sheet for a tournament's invite link: QR code,
 * copyable link, native share, and link reset. Mirrors the groups
 * InviteLinkModal visual structure, minus the code tab (invite tokens are
 * not typeable). The link rides the unified /invite format, so the
 * organizer's referral code carries signup attribution.
 *
 * Spec: specs/17-leagues-tournaments/tournaments.md §Shareable invite links
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, TouchableOpacity, StyleSheet, Share, Alert, ActivityIndicator } from 'react-native';
import ActionSheet, { SheetManager, SheetProps, ScrollView } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { Text, useToast, Button } from '@rallia/shared-components';
import {
  useAuth,
  useReferral,
  useTournamentInviteLink,
  useResetTournamentInvite,
} from '@rallia/shared-hooks';
import { getTournamentInviteLink } from '@rallia/shared-services';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import { lightHaptic } from '@rallia/shared-utils';

import { useThemeStyles, useTranslation } from '../../../hooks';
import * as Analytics from '../../../services/analytics';

export function TournamentInviteSheet({ payload }: SheetProps<'tournament-invite'>) {
  const tournamentId = payload?.tournamentId ?? '';
  const tournamentName = payload?.tournamentName ?? '';

  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const toast = useToast();
  const { session } = useAuth();
  const [copied, setCopied] = useState(false);

  const { data: link, isLoading } = useTournamentInviteLink(tournamentId, !!tournamentId);
  const { code: referralCode } = useReferral(session?.user?.id);
  const reset = useResetTournamentInvite({
    onSuccess: () => toast.success(t('tournamentDetail.invite.resetDone')),
    onError: () => toast.error(t('tournamentDetail.invite.resetFailed')),
  });

  const inviteLink =
    link?.token && referralCode
      ? getTournamentInviteLink(link.token, tournamentId, referralCode, {
          utm_source: 'app_share',
          utm_medium: 'referral',
          utm_campaign: 'tournament_invite_2026',
          utm_content: 'invite_sheet',
        })
      : '';

  // One "link surfaced" signal per sheet open, once the link resolves.
  const surfacedRef = useRef(false);
  useEffect(() => {
    if (inviteLink && !surfacedRef.current) {
      surfacedRef.current = true;
      Analytics.invitationLinkGenerated({
        invitation_type: 'tournament',
        channel: 'share_sheet',
      });
    }
  }, [inviteLink]);

  const handleClose = useCallback(() => {
    setCopied(false);
    SheetManager.hide('tournament-invite');
  }, []);

  const handleCopyLink = useCallback(async () => {
    if (!inviteLink) return;
    try {
      await Clipboard.setStringAsync(inviteLink);
      setCopied(true);
      toast.success(t('common.copied'));
      Analytics.tournamentShared({ tournamentId, medium: 'link' });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t('common.error'));
    }
  }, [inviteLink, tournamentId, toast, t]);

  const handleShare = useCallback(async () => {
    if (!inviteLink) return;
    try {
      await Share.share({
        message: t('tournamentDetail.invite.shareMessage', {
          name: tournamentName,
          link: inviteLink,
        }),
        title: t('tournamentDetail.invite.shareTitle', { name: tournamentName }),
      });
      Analytics.tournamentShared({ tournamentId, medium: 'native' });
    } catch (error) {
      if (error instanceof Error && error.message !== 'User did not share') {
        toast.error(t('common.error'));
      }
    }
  }, [inviteLink, tournamentId, tournamentName, toast, t]);

  const handleReset = useCallback(() => {
    Alert.alert(t('tournamentDetail.invite.resetLink'), t('tournamentDetail.invite.resetWarning'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.reset'),
        style: 'destructive',
        onPress: () => {
          lightHaptic();
          reset.mutate({ tournamentId });
        },
      },
    ]);
  }, [tournamentId, reset, t]);

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={[styles.sheetBackground, { backgroundColor: colors.cardBackground }]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
    >
      <View style={styles.container}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={styles.headerSpacer} />
          <Text weight="semibold" size="lg" style={{ color: colors.text }}>
            {t('tournamentDetail.invite.title')}
          </Text>
          <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
            <Ionicons name="close-outline" size={24} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.content}
          contentContainerStyle={styles.contentContainer}
          keyboardShouldPersistTaps="handled"
        >
          {isLoading || !inviteLink ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.buttonActive} />
              <Text size="sm" color={colors.textMuted} style={styles.loadingText}>
                {t('tournamentDetail.invite.generating')}
              </Text>
            </View>
          ) : (
            <>
              <Text size="sm" color={colors.textSecondary} style={styles.description}>
                {t('tournamentDetail.invite.description')}
              </Text>

              <View style={[styles.qrContainer, { backgroundColor: colors.buttonInactive }]}>
                <View style={styles.qrCanvas}>
                  <QRCode
                    value={inviteLink}
                    size={220}
                    backgroundColor="#FFFFFF"
                    color="#000000"
                    ecl="M"
                  />
                </View>
                <Text size="xs" color={colors.textMuted} style={styles.qrHint}>
                  {t('tournamentDetail.invite.scanToRegister')}
                </Text>
              </View>

              <View
                style={[
                  styles.linkContainer,
                  { backgroundColor: colors.buttonInactive, borderColor: colors.border },
                ]}
              >
                <Text
                  numberOfLines={1}
                  size="sm"
                  color={colors.text}
                  style={styles.linkText}
                  testID="invite-link-text"
                >
                  {inviteLink}
                </Text>
                <TouchableOpacity
                  onPress={handleCopyLink}
                  style={[
                    styles.copyButton,
                    { backgroundColor: copied ? colors.buttonActive : colors.border },
                  ]}
                  testID="invite-copy-link"
                >
                  <Ionicons
                    name={copied ? 'checkmark' : 'copy-outline'}
                    size={18}
                    color={copied ? colors.buttonTextActive : colors.text}
                  />
                </TouchableOpacity>
              </View>

              <View style={styles.actions}>
                <Button
                  variant="primary"
                  size="md"
                  fullWidth
                  onPress={handleShare}
                  leftIcon={
                    <Ionicons name="share-outline" size={20} color={colors.buttonTextActive} />
                  }
                  isDark={isDark}
                >
                  {t('tournamentDetail.invite.share')}
                </Button>

                <TouchableOpacity
                  style={[styles.resetButton, { borderColor: colors.border }]}
                  onPress={handleReset}
                  disabled={reset.isPending}
                  testID="invite-reset-link"
                >
                  <Ionicons name="refresh-outline" size={18} color={colors.textSecondary} />
                  <Text size="sm" style={{ color: colors.textSecondary, marginLeft: 6 }}>
                    {t('tournamentDetail.invite.resetLink')}
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={styles.infoSection}>
                <Ionicons name="information-circle-outline" size={16} color={colors.textMuted} />
                <Text size="xs" style={{ color: colors.textMuted, marginLeft: 6, flex: 1 }}>
                  {t('tournamentDetail.invite.linkInfo')}
                </Text>
              </View>
            </>
          )}
        </ScrollView>
      </View>
    </ActionSheet>
  );
}

const styles = StyleSheet.create({
  sheetBackground: {
    flex: 1,
    borderTopLeftRadius: radiusPixels['2xl'],
    borderTopRightRadius: radiusPixels['2xl'],
  },
  handleIndicator: {
    width: spacingPixels[10],
    height: 4,
    borderRadius: 4,
    alignSelf: 'center',
  },
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacingPixels[4],
    borderBottomWidth: 1,
  },
  headerSpacer: {
    width: 24 + spacingPixels[1] * 2,
  },
  closeButton: {
    padding: spacingPixels[1],
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: spacingPixels[6],
    paddingBottom: spacingPixels[4],
  },
  loadingContainer: {
    alignItems: 'center',
    paddingVertical: spacingPixels[10],
  },
  loadingText: {
    marginTop: spacingPixels[3],
  },
  description: {
    textAlign: 'center',
    marginBottom: spacingPixels[6],
  },
  qrContainer: {
    alignItems: 'center',
    padding: 20,
    borderRadius: radiusPixels.lg,
    marginBottom: spacingPixels[4],
  },
  qrCanvas: {
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: radiusPixels.md,
  },
  qrHint: {
    marginTop: spacingPixels[2],
  },
  linkContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: radiusPixels.md,
    borderWidth: 1,
    marginBottom: spacingPixels[4],
  },
  linkText: {
    flex: 1,
  },
  copyButton: {
    padding: 8,
    borderRadius: 8,
    marginLeft: 12,
  },
  actions: {
    gap: spacingPixels[3],
    marginBottom: spacingPixels[6],
  },
  resetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacingPixels[2.5],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
  },
  infoSection: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacingPixels[2],
  },
});
