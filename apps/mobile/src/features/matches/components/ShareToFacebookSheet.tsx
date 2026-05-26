/**
 * ShareToFacebookSheet
 * Bottom sheet shown after match creation success to help the host post their
 * match into a Facebook group. Loads the match by id, generates an editable
 * preview message, and offers Copy + Open Facebook actions.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  Linking,
} from 'react-native';
import ActionSheet, { SheetManager, SheetProps, ScrollView } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Text, useToast } from '@rallia/shared-components';
import { useTheme } from '@rallia/shared-hooks';
import { getMatchWithDetails } from '@rallia/shared-services';
import {
  lightTheme,
  darkTheme,
  radiusPixels,
  primary,
  neutral,
  base,
  spacingPixels,
} from '@rallia/design-system';
import { lightHaptic, successHaptic } from '@rallia/shared-utils';

import { useTranslation } from '#/hooks';
import { generateFacebookPostMessage } from '#/utils/shareUtils';
import type { MatchDetailData } from '#/context';
import * as Analytics from '#/services/analytics';

const FACEBOOK_BLUE = '#1877F2';
const FACEBOOK_APP_URL = 'fb://';
const FACEBOOK_WEB_URL = 'https://www.facebook.com/';

export function ShareToFacebookActionSheet({ payload }: SheetProps<'share-to-facebook'>) {
  const matchId = payload?.matchId ?? '';

  const { theme } = useTheme();
  const { t, locale } = useTranslation();
  const toast = useToast();
  const isDark = theme === 'dark';

  const themeColors = isDark ? darkTheme : lightTheme;
  const colors = useMemo(
    () => ({
      cardBackground: themeColors.card,
      text: themeColors.foreground,
      textMuted: themeColors.mutedForeground,
      border: themeColors.border,
      muted: themeColors.muted,
      buttonActive: isDark ? primary[500] : primary[600],
      buttonInactive: themeColors.muted,
      buttonTextActive: base.white,
    }),
    [themeColors, isDark]
  );

  const [isLoading, setIsLoading] = useState(true);
  const [match, setMatch] = useState<MatchDetailData | null>(null);
  const [generatedMessage, setGeneratedMessage] = useState('');
  const [message, setMessage] = useState('');
  const [hasCopied, setHasCopied] = useState(false);

  // Fetch match + build initial message
  useEffect(() => {
    if (!matchId) return;
    let cancelled = false;
    (async () => {
      try {
        const fetched = await getMatchWithDetails(matchId);
        if (cancelled || !fetched) return;
        const matchData = fetched as MatchDetailData;
        const generated = generateFacebookPostMessage(matchData, { t, locale });
        setMatch(matchData);
        setGeneratedMessage(generated);
        setMessage(generated);
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load match for FB share:', error);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [matchId, t, locale]);

  const handleClose = useCallback(() => {
    lightHaptic();
    SheetManager.hide('share-to-facebook');
  }, []);

  const handleReset = useCallback(() => {
    lightHaptic();
    setMessage(generatedMessage);
  }, [generatedMessage]);

  const handleCopy = useCallback(async () => {
    if (!message) return;
    try {
      await Clipboard.setStringAsync(message);
      successHaptic();
      setHasCopied(true);
      toast.success(t('matchCreation.shareToFacebook.copied'));
      Analytics.invitationLinkGenerated({
        invitation_type: 'match',
        channel: 'facebook_copy',
      });
    } catch (error) {
      console.error('Clipboard write failed:', error);
      toast.error(t('matchCreation.shareToFacebook.copyError'));
    }
  }, [message, toast, t]);

  const handleOpenFacebook = useCallback(async () => {
    lightHaptic();
    try {
      const canOpenApp = await Linking.canOpenURL(FACEBOOK_APP_URL);
      await Linking.openURL(canOpenApp ? FACEBOOK_APP_URL : FACEBOOK_WEB_URL);
      Analytics.invitationLinkGenerated({
        invitation_type: 'match',
        channel: 'facebook_open',
      });
    } catch {
      // Last-resort fallback to web
      try {
        await Linking.openURL(FACEBOOK_WEB_URL);
        Analytics.invitationLinkGenerated({
          invitation_type: 'match',
          channel: 'facebook_open',
        });
      } catch {
        // Silently ignore — nothing else we can do
      }
    }
  }, []);

  const sportName = match?.sport?.name;

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={[
        styles.sheetBackground,
        styles.container,
        { backgroundColor: colors.cardBackground },
      ]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
    >
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View style={[styles.badge, { backgroundColor: FACEBOOK_BLUE }]}>
          <Ionicons name="logo-facebook" size={14} color={base.white} />
          <Text size="sm" weight="semibold" color={base.white}>
            {t('matchCreation.shareToFacebook.button')}
          </Text>
        </View>

        <TouchableOpacity onPress={handleClose} style={styles.closeButton} activeOpacity={0.7}>
          <Ionicons name="close-outline" size={24} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.contentContainer}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text weight="bold" size="lg" style={{ color: colors.text, marginBottom: 4 }}>
          {t('matchCreation.shareToFacebook.title')}
        </Text>
        <Text size="sm" style={{ color: colors.textMuted, marginBottom: spacingPixels[4] }}>
          {t('matchCreation.shareToFacebook.hint')}
        </Text>

        {isLoading ? (
          <View style={styles.loaderWrap}>
            <ActivityIndicator size="large" color={colors.buttonActive} />
          </View>
        ) : (
          <>
            <View style={styles.previewLabelRow}>
              <Text weight="semibold" size="sm" style={{ color: colors.text }}>
                {t('matchCreation.shareToFacebook.previewLabel')}
              </Text>
              {message !== generatedMessage && (
                <TouchableOpacity onPress={handleReset} activeOpacity={0.7}>
                  <Text size="sm" weight="semibold" color={colors.buttonActive}>
                    {t('matchCreation.shareToFacebook.reset')}
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            <TextInput
              style={[
                styles.messageInput,
                {
                  backgroundColor: isDark ? neutral[800] : neutral[50],
                  color: colors.text,
                  borderColor: colors.border,
                },
              ]}
              value={message}
              onChangeText={setMessage}
              multiline
              textAlignVertical="top"
              accessibilityLabel={
                sportName
                  ? `${t('matchCreation.shareToFacebook.previewLabel')} — ${sportName}`
                  : t('matchCreation.shareToFacebook.previewLabel')
              }
            />
          </>
        )}
      </ScrollView>

      {/* Footer: Copy + Open Facebook */}
      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <TouchableOpacity
          style={[
            styles.actionButton,
            {
              backgroundColor: hasCopied ? colors.buttonInactive : colors.buttonActive,
            },
            (!message || isLoading) && styles.buttonDisabled,
          ]}
          onPress={handleCopy}
          disabled={!message || isLoading}
          activeOpacity={0.8}
        >
          <Ionicons
            name={hasCopied ? 'checkmark-outline' : 'copy-outline'}
            size={20}
            color={hasCopied ? colors.buttonActive : colors.buttonTextActive}
          />
          <Text
            size="lg"
            weight="semibold"
            color={hasCopied ? colors.buttonActive : colors.buttonTextActive}
          >
            {hasCopied
              ? t('matchCreation.shareToFacebook.copied')
              : t('matchCreation.shareToFacebook.copy')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.actionButton,
            styles.facebookButton,
            { backgroundColor: hasCopied ? FACEBOOK_BLUE : `${FACEBOOK_BLUE}33` },
          ]}
          onPress={handleOpenFacebook}
          activeOpacity={0.8}
        >
          <Ionicons name="logo-facebook" size={20} color={base.white} />
          <Text size="lg" weight="semibold" color={base.white}>
            {t('matchCreation.shareToFacebook.openFacebook')}
          </Text>
        </TouchableOpacity>

        {hasCopied && (
          <Text
            size="xs"
            style={{
              color: colors.textMuted,
              textAlign: 'center',
              marginTop: spacingPixels[2],
            }}
          >
            {t('matchCreation.shareToFacebook.openFacebookHint')}
          </Text>
        )}
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
  container: {
    flex: 1,
  },
  handleIndicator: {
    width: spacingPixels[10],
    height: 4,
    borderRadius: 4,
    alignSelf: 'center',
  },
  header: {
    position: 'relative' as const,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    borderBottomWidth: 1,
  },
  closeButton: {
    position: 'absolute' as const,
    right: 16,
    padding: spacingPixels[1],
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[1.5],
    borderRadius: radiusPixels.full,
    gap: spacingPixels[1.5],
  },
  contentContainer: {
    flex: 1,
  },
  scrollContent: {
    padding: spacingPixels[4],
    paddingBottom: spacingPixels[6],
  },
  loaderWrap: {
    paddingVertical: spacingPixels[8],
    alignItems: 'center',
  },
  previewLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacingPixels[2],
  },
  messageInput: {
    borderRadius: radiusPixels.lg,
    padding: spacingPixels[3],
    minHeight: 220,
    borderWidth: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  footer: {
    padding: spacingPixels[4],
    borderTopWidth: 1,
    gap: spacingPixels[2],
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    gap: spacingPixels[2],
  },
  facebookButton: {
    // backgroundColor set inline based on hasCopied
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});

export default ShareToFacebookActionSheet;
