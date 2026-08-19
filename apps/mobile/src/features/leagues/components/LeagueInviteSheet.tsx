/**
 * LeagueInviteSheet
 *
 * Share sheet for a league's invite link: QR code, copyable link, native
 * share, and (organizer links only) link reset. Mirrors TournamentInviteSheet.
 * The link rides the unified /invite format, so the sharer's referral code
 * carries signup attribution. When opened from a session, the link carries the
 * session id so recipients land on that sheet once they're in.
 *
 * Spec: specs/17-leagues-tournaments/leagues.md §Shareable invite links
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, TouchableOpacity, StyleSheet, Share, Alert, ActivityIndicator } from 'react-native';
import ActionSheet, { SheetManager, SheetProps, ScrollView } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { Text, useToast, Button, ToastOverlay } from '@rallia/shared-components';
import {
  useAuth,
  useReferral,
  useLeagueInviteLink,
  useResetLeagueInvite,
} from '@rallia/shared-hooks';
import { getLeagueShareLink } from '@rallia/shared-services';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import { lightHaptic } from '@rallia/shared-utils';

import { useThemeStyles, useTranslation, type TranslationKey } from '../../../hooks';
import * as Analytics from '../../../services/analytics';

/**
 * Map a link-minting failure to a user-facing reason: the RPC refuses closed
 * leagues, and player links only exist where sharing is safe.
 */
function inviteErrorKey(message: string | undefined): TranslationKey {
  if (message?.includes('LEAGUE_NOT_ACTIVE')) return 'leagueDetail.invite.errors.notActive';
  if (message?.includes('LEAGUE_NOT_FOUND')) return 'leagueDetail.invite.errors.notFound';
  if (message?.includes('SHARING_NOT_AVAILABLE'))
    return 'leagueDetail.invite.errors.sharingUnavailable';
  return 'leagueDetail.invite.errors.generic';
}

export function LeagueInviteSheet({ payload }: SheetProps<'league-invite'>) {
  const leagueId = payload?.leagueId ?? '';
  const leagueName = payload?.leagueName ?? '';
  const sessionId = payload?.sessionId;
  const sessionLabel = payload?.sessionLabel;

  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const toast = useToast();
  const { session } = useAuth();
  const [copied, setCopied] = useState(false);

  const {
    data: link,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useLeagueInviteLink(leagueId, !!leagueId);
  const { code: referralCode, codeLoading } = useReferral(session?.user?.id);
  const reset = useResetLeagueInvite({
    onSuccess: () => toast.success(t('leagueDetail.invite.resetDone')),
    onError: () => toast.error(t('leagueDetail.invite.resetFailed')),
  });

  const inviteLink =
    link?.token && referralCode
      ? getLeagueShareLink(link.token, leagueId, referralCode, {
          sessionId,
          utm: {
            utm_source: 'app_share',
            utm_medium: 'referral',
            utm_campaign: 'league_invite_2026',
            utm_content: sessionId ? 'session_share' : 'invite_sheet',
          },
        })
      : '';

  // A player-shared link redeems through the normal rules, so it promises the
  // recipient something different from the organizer's skeleton key, and reset
  // is organizer-only.
  const isPlayerLink = link?.kind === 'player';

  // Spin only while we lack a link AND something is still in flight; once
  // nothing is in flight and we still have no link, name the failure instead
  // of spinning forever. Keyed off the absence of a link so a background
  // refetch never pulls the QR code out from under the user.
  const isPreparing = !inviteLink && (isLoading || codeLoading || isFetching);
  const hasFailed = !inviteLink && !isPreparing;

  // One "link surfaced" signal per sheet open, once the link resolves.
  const surfacedRef = useRef(false);
  useEffect(() => {
    if (inviteLink && !surfacedRef.current) {
      surfacedRef.current = true;
      Analytics.invitationLinkGenerated({
        invitation_type: 'league',
        channel: 'share_sheet',
      });
    }
  }, [inviteLink]);

  const handleClose = useCallback(() => {
    setCopied(false);
    SheetManager.hide('league-invite');
  }, []);

  const handleCopyLink = useCallback(async () => {
    if (!inviteLink) return;
    try {
      await Clipboard.setStringAsync(inviteLink);
      setCopied(true);
      toast.success(t('common.copied'));
      Analytics.leagueShared({ leagueId, medium: 'link', sessionId });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t('common.error'));
    }
  }, [inviteLink, leagueId, sessionId, toast, t]);

  const handleShare = useCallback(async () => {
    if (!inviteLink) return;
    try {
      await Share.share({
        message: sessionLabel
          ? t('leagueDetail.invite.shareMessageSession', {
              name: leagueName,
              session: sessionLabel,
              link: inviteLink,
            })
          : t('leagueDetail.invite.shareMessage', { name: leagueName, link: inviteLink }),
        title: t('leagueDetail.invite.shareTitle', { name: leagueName }),
      });
      Analytics.leagueShared({ leagueId, medium: 'native', sessionId });
    } catch (error) {
      if (error instanceof Error && error.message !== 'User did not share') {
        toast.error(t('common.error'));
      }
    }
  }, [inviteLink, leagueId, leagueName, sessionId, sessionLabel, toast, t]);

  const handleReset = useCallback(() => {
    Alert.alert(t('leagueDetail.invite.resetLink'), t('leagueDetail.invite.resetWarning'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.reset'),
        style: 'destructive',
        onPress: () => {
          lightHaptic();
          reset.mutate({ leagueId });
        },
      },
    ]);
  }, [leagueId, reset, t]);

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={[styles.sheetBackground, { backgroundColor: colors.cardBackground }]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
      // Without this the reset/copy toasts render behind the sheet, so the
      // confirmation never reaches the person who just tapped.
      ExtraOverlayComponent={<ToastOverlay />}
    >
      <View style={styles.container}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={styles.headerSpacer} />
          <Text weight="semibold" size="lg" style={{ color: colors.text }}>
            {t('leagueDetail.invite.title')}
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
          {isPreparing ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.buttonActive} />
              <Text size="sm" color={colors.textMuted} style={styles.loadingText}>
                {t('leagueDetail.invite.generating')}
              </Text>
            </View>
          ) : hasFailed ? (
            <View style={styles.loadingContainer} testID="league-invite-link-error">
              <Ionicons name="link-outline" size={40} color={colors.textMuted} />
              <Text size="base" weight="semibold" color={colors.text} style={styles.errorTitle}>
                {t('leagueDetail.invite.errors.title')}
              </Text>
              <Text size="sm" color={colors.textMuted} style={styles.errorBody}>
                {t(inviteErrorKey(error?.message))}
              </Text>
              <Button
                variant="secondary"
                size="md"
                onPress={() => {
                  void lightHaptic();
                  void refetch();
                }}
                isDark={isDark}
              >
                {t('common.retry')}
              </Button>
            </View>
          ) : (
            <>
              <Text size="sm" color={colors.textSecondary} style={styles.description}>
                {t(
                  isPlayerLink
                    ? 'leagueDetail.invite.descriptionPlayer'
                    : 'leagueDetail.invite.description'
                )}
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
                  {t('leagueDetail.invite.scanToJoin')}
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
                  testID="league-invite-link-text"
                >
                  {inviteLink}
                </Text>
                <TouchableOpacity
                  onPress={handleCopyLink}
                  style={[
                    styles.copyButton,
                    { backgroundColor: copied ? colors.buttonActive : colors.border },
                  ]}
                  testID="league-invite-copy-link"
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
                  {t('leagueDetail.invite.share')}
                </Button>

                {!isPlayerLink && (
                  <TouchableOpacity
                    style={[styles.resetButton, { borderColor: colors.border }]}
                    onPress={handleReset}
                    disabled={reset.isPending}
                    testID="league-invite-reset-link"
                  >
                    <Ionicons name="refresh-outline" size={18} color={colors.textSecondary} />
                    <Text size="sm" style={{ color: colors.textSecondary, marginLeft: 6 }}>
                      {t('leagueDetail.invite.resetLink')}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>

              <View style={styles.infoSection}>
                <Ionicons name="information-circle-outline" size={16} color={colors.textMuted} />
                <Text size="xs" style={{ color: colors.textMuted, marginLeft: 6, flex: 1 }}>
                  {t(
                    isPlayerLink
                      ? 'leagueDetail.invite.linkInfoPlayer'
                      : 'leagueDetail.invite.linkInfo'
                  )}
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
  errorTitle: {
    marginTop: spacingPixels[3],
    textAlign: 'center',
  },
  errorBody: {
    marginTop: spacingPixels[2],
    marginBottom: spacingPixels[4],
    textAlign: 'center',
    paddingHorizontal: spacingPixels[4],
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
