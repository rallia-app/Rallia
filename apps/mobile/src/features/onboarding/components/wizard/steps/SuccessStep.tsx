/**
 * SuccessStep Component
 *
 * Final success screen of onboarding - animated celebration with invite flow.
 * Offers an inline contacts picker (multi-select + SMS) and a native share
 * sheet fallback. Once the user has sent at least one batch of invitations,
 * the muted "Maybe later" link is replaced by a primary "Continue" button.
 */

import React, { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  View,
  Share,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { ScrollView as SheetScrollView } from 'react-native-actions-sheet';
import * as SMS from 'expo-sms';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withDelay,
} from 'react-native-reanimated';
import LottieView from 'lottie-react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text, useToast } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import { useReferral, useAuth } from '@rallia/shared-hooks';
import { getReferralLink } from '@rallia/shared-services';
import { lightHaptic, selectionHaptic, successHaptic } from '@rallia/shared-utils';

import * as Analytics from '#/services/analytics';
import { SearchBar } from '#/components/SearchBar';
import { ContactRow, ContactSelectionCheck } from '#/components/ContactRow';
import { useDeviceContacts } from '#/hooks/useDeviceContacts';
import { formatContactSubtitle } from '#/utils/contactDisplay';

const BASE_WHITE = '#ffffff';
const CONTACT_LIST_MAX_HEIGHT = 280;
const CONTACTS_PAGE_SIZE = 20;

import type { TranslationKey } from '@rallia/shared-translations';

interface ThemeColors {
  background: string;
  cardBackground: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  buttonActive: string;
  buttonInactive: string;
  buttonTextActive: string;
  success: string;
}

export interface Sport {
  id: string;
  name: string;
  display_name: string;
  icon_url?: string | null;
}

interface SuccessStepProps {
  onComplete: () => void;
  onAdvanceToSuggestions: () => void;
  colors: ThemeColors;
  t: (key: TranslationKey) => string;
  isDark: boolean;
  selectedSports: Sport[];
  currentSport: Sport | null;
  onSelectInitialSport: (sport: Sport) => void | Promise<void>;
  playerId?: string | null;
}

export const SuccessStep: React.FC<SuccessStepProps> = ({
  onAdvanceToSuggestions,
  colors,
  t,
  isDark,
  selectedSports,
  currentSport,
  onSelectInitialSport,
  playerId,
}) => {
  const toast = useToast();
  const hasAutoSelected = useRef(false);

  // Prefer the live session id over the wizard's async `successPlayerId` prop,
  // which can lag/stale across multiple onboardings in one app session — that
  // would generate a referral code for the wrong player. Mirrors the games step.
  const { session } = useAuth();
  const effectivePlayerId = session?.user?.id ?? playerId ?? null;

  const { code: referralCode, codeLoading: referralLoading } = useReferral(
    effectivePlayerId ?? undefined
  );
  const referralLink = referralCode
    ? getReferralLink(referralCode, {
        utm_source: 'app_share',
        utm_medium: 'referral',
        utm_campaign: 'onboarding_invite_2026',
        utm_content: 'success_step',
      })
    : undefined;

  const {
    permissionStatus,
    isLoading: contactsLoading,
    contacts,
    selectedCount,
    requestAndLoad,
    toggle,
    toggleAllInIds,
    clearSelection,
  } = useDeviceContacts();

  const [searchQuery, setSearchQuery] = useState('');
  const [invitesSentCount, setInvitesSentCount] = useState(0);
  const [isSendingSms, setIsSendingSms] = useState(false);
  const [visibleCount, setVisibleCount] = useState(CONTACTS_PAGE_SIZE);

  // Reset pagination when the search changes so the top N always reflects the
  // current query.
  useEffect(() => {
    setVisibleCount(CONTACTS_PAGE_SIZE);
  }, [searchQuery]);

  // Auto-select initial sport based on current selection
  useEffect(() => {
    if (hasAutoSelected.current || selectedSports.length === 0) return;

    const currentStillSelected = currentSport && selectedSports.some(s => s.id === currentSport.id);

    if (currentStillSelected) {
      onSelectInitialSport(currentSport);
    } else {
      onSelectInitialSport(selectedSports[0]);
    }

    hasAutoSelected.current = true;
  }, [selectedSports, currentSport, onSelectInitialSport]);

  // Animation values
  const iconScale = useSharedValue(0);
  const iconOpacity = useSharedValue(0);
  const textOpacity = useSharedValue(0);
  const shareCardOpacity = useSharedValue(0);
  const shareCardTranslateY = useSharedValue(20);
  const skipOpacity = useSharedValue(0);

  useEffect(() => {
    iconScale.value = withDelay(200, withSpring(1, { damping: 40, stiffness: 300 }));
    iconOpacity.value = withDelay(200, withTiming(1, { duration: 300 }));
    textOpacity.value = withDelay(500, withTiming(1, { duration: 400 }));
    shareCardOpacity.value = withDelay(900, withTiming(1, { duration: 400 }));
    shareCardTranslateY.value = withDelay(900, withSpring(0, { damping: 40, stiffness: 300 }));
    skipOpacity.value = withDelay(1200, withTiming(1, { duration: 400 }));
  }, [iconScale, iconOpacity, textOpacity, shareCardOpacity, shareCardTranslateY, skipOpacity]);

  const iconAnimatedStyle = useAnimatedStyle(() => ({
    opacity: iconOpacity.value,
    transform: [{ scale: iconScale.value }],
  }));
  const textAnimatedStyle = useAnimatedStyle(() => ({ opacity: textOpacity.value }));
  const shareCardAnimatedStyle = useAnimatedStyle(() => ({
    opacity: shareCardOpacity.value,
    transform: [{ translateY: shareCardTranslateY.value }],
  }));
  const skipAnimatedStyle = useAnimatedStyle(() => ({ opacity: skipOpacity.value }));

  const filteredContacts = useMemo(() => {
    if (!searchQuery.trim()) return contacts;
    const q = searchQuery.toLowerCase();
    return contacts.filter(
      c =>
        c.name.toLowerCase().includes(q) ||
        c.phone?.includes(q) ||
        c.email?.toLowerCase().includes(q)
    );
  }, [contacts, searchQuery]);

  const filteredIds = useMemo(() => new Set(filteredContacts.map(c => c.id)), [filteredContacts]);
  const allFilteredSelected =
    filteredContacts.length > 0 && filteredContacts.every(c => c.selected);
  const visibleContacts = useMemo(
    () => filteredContacts.slice(0, visibleCount),
    [filteredContacts, visibleCount]
  );
  const remainingCount = Math.max(0, filteredContacts.length - visibleContacts.length);

  const buildShareMessage = useCallback(() => {
    if (!referralLink) return null;
    const sportName =
      currentSport?.display_name?.toLowerCase() ??
      selectedSports[0]?.display_name?.toLowerCase() ??
      'sports';
    return t('referral.shareMessage').replace('{sport}', sportName).replace('{link}', referralLink);
  }, [currentSport, selectedSports, t, referralLink]);

  const handleNativeShare = useCallback(async () => {
    const message = buildShareMessage();
    if (!message) return;
    try {
      lightHaptic();
      const result = await Share.share({
        message,
        title: t('referral.shareTitle'),
      });
      if (result.action === Share.sharedAction) {
        Analytics.invitationLinkGenerated({
          invitation_type: 'referral',
          channel: 'share_sheet',
        });
        successHaptic();
      }
    } catch {
      // User cancelled share — no-op
    }
  }, [buildShareMessage, t]);

  const handleRequestContacts = useCallback(async () => {
    lightHaptic();
    await requestAndLoad();
  }, [requestAndLoad]);

  const handleToggle = useCallback(
    (id: string) => {
      selectionHaptic();
      toggle(id);
    },
    [toggle]
  );

  const handleToggleAll = useCallback(() => {
    lightHaptic();
    toggleAllInIds(filteredIds);
  }, [toggleAllInIds, filteredIds]);

  const handleSendSmsInvites = useCallback(async () => {
    if (selectedCount === 0 || isSendingSms) return;
    const message = buildShareMessage();
    if (!message) return;

    const phones = contacts
      .filter(c => c.selected)
      .map(c => c.phone)
      .filter((p): p is string => p != null);

    if (phones.length === 0) {
      toast.warning(t('referral.contacts.selectAtLeastOne'));
      return;
    }

    setIsSendingSms(true);
    try {
      const isAvailable = await SMS.isAvailableAsync();
      if (!isAvailable) {
        toast.error(t('referral.contacts.failedToSend'));
        return;
      }
      const { result } = await SMS.sendSMSAsync(phones, message);
      if (result === 'sent') {
        Analytics.invitationLinkGenerated({
          invitation_type: 'referral',
          channel: 'sms_contacts',
        });
        successHaptic();
        clearSelection();
        setInvitesSentCount(c => c + 1);
        toast.success(t('onboarding.success.invitesSentToast'));
      }
    } catch {
      toast.error(t('referral.contacts.failedToSend'));
    } finally {
      setIsSendingSms(false);
    }
  }, [selectedCount, isSendingSms, buildShareMessage, contacts, toast, t, clearSelection]);

  const handleContinue = useCallback(() => {
    Analytics.onboardingShareSkipped();
    onAdvanceToSuggestions();
  }, [onAdvanceToSuggestions]);

  const hasInvited = invitesSentCount > 0;
  const showContactList = permissionStatus === 'granted';
  const showDeniedState = permissionStatus === 'denied' || permissionStatus === 'undetermined';

  return (
    <View style={styles.wrapper}>
      <View style={styles.confetti} pointerEvents="none">
        <LottieView
          source={require('../../../../../../assets/animations/confetti.json')}
          autoPlay
          loop={false}
          speed={0.8}
          resizeMode="cover"
          style={StyleSheet.absoluteFill}
        />
      </View>

      <SheetScrollView
        style={styles.scrollContainer}
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Success Icon */}
        <Animated.View
          style={[
            styles.iconContainer,
            { backgroundColor: colors.buttonActive },
            iconAnimatedStyle,
          ]}
        >
          <Ionicons name="checkmark-outline" size={48} color={BASE_WHITE} />
        </Animated.View>

        {/* Success Text */}
        <Animated.View style={textAnimatedStyle}>
          <Text size="xl" weight="bold" color={colors.text} style={styles.title}>
            {t('onboarding.success.title')}
          </Text>
          <Text size="base" color={colors.textMuted} style={styles.subtitle}>
            {t('onboarding.success.subtitle')}
          </Text>
        </Animated.View>

        {/* Invite Card */}
        <Animated.View style={[styles.inviteCardWrapper, shareCardAnimatedStyle]}>
          <View
            style={[
              styles.inviteCard,
              { backgroundColor: colors.cardBackground, borderColor: colors.border },
            ]}
          >
            <Ionicons name="people-outline" size={28} color={colors.buttonActive} />
            <Text size="base" weight="semibold" color={colors.text} style={styles.inviteTitle}>
              {t('onboarding.success.contactsTitle')}
            </Text>
            <Text size="sm" color={colors.textMuted} style={styles.inviteSubtitle}>
              {t('onboarding.success.contactsSubtitle')}
            </Text>

            {/* PRE-PERMISSION: persuasive primary CTA */}
            {permissionStatus === null && (
              <>
                <TouchableOpacity
                  style={[styles.primaryButton, { backgroundColor: colors.buttonActive }]}
                  onPress={handleRequestContacts}
                  activeOpacity={0.8}
                  disabled={contactsLoading}
                >
                  {contactsLoading ? (
                    <ActivityIndicator size="small" color={BASE_WHITE} />
                  ) : (
                    <>
                      <Ionicons
                        name="person-add-outline"
                        size={20}
                        color={colors.buttonTextActive}
                      />
                      <Text
                        size="base"
                        weight="semibold"
                        color={colors.buttonTextActive}
                        style={styles.primaryButtonText}
                      >
                        {t('onboarding.success.findFromContacts')}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.secondaryButton, { borderColor: colors.border }]}
                  onPress={handleNativeShare}
                  activeOpacity={0.7}
                  disabled={referralLoading || !referralLink}
                >
                  <Ionicons name="share-outline" size={18} color={colors.text} />
                  <Text
                    size="sm"
                    weight="semibold"
                    color={colors.text}
                    style={styles.secondaryButtonText}
                  >
                    {t('onboarding.success.shareLinkInstead')}
                  </Text>
                </TouchableOpacity>
              </>
            )}

            {/* GRANTED: searchable list + send */}
            {showContactList && (
              <View style={styles.contactsArea}>
                <SearchBar
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder={t('onboarding.success.searchPlaceholder')}
                  colors={colors}
                  style={styles.searchBar}
                />

                {filteredContacts.length > 0 && (
                  <View style={styles.listHeaderRow}>
                    <Text
                      size="xs"
                      weight="semibold"
                      color={colors.textMuted}
                      style={styles.listHeaderLabel}
                    >
                      {remainingCount > 0
                        ? `${visibleContacts.length} / ${filteredContacts.length} ${t('onboarding.success.contactPlural')}`
                        : `${filteredContacts.length} ${
                            filteredContacts.length === 1
                              ? t('onboarding.success.contactSingular')
                              : t('onboarding.success.contactPlural')
                          }`}
                    </Text>
                    <TouchableOpacity onPress={handleToggleAll} activeOpacity={0.6} hitSlop={8}>
                      <Text size="xs" weight="semibold" color={colors.buttonActive}>
                        {allFilteredSelected ? t('common.deselectAll') : t('common.selectAll')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}

                <ScrollView
                  style={styles.contactList}
                  nestedScrollEnabled
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                >
                  {filteredContacts.length === 0 ? (
                    <View style={styles.emptySearchState}>
                      <Ionicons name="search-outline" size={28} color={colors.textMuted} />
                      <Text size="sm" color={colors.textMuted} style={styles.noContacts}>
                        {t('onboarding.success.noContacts')}
                      </Text>
                    </View>
                  ) : (
                    visibleContacts.map((item, index) => {
                      const subtitle = formatContactSubtitle(item.phone, item.email);
                      const isLast = index === visibleContacts.length - 1 && remainingCount === 0;
                      return (
                        <ContactRow
                          key={item.id}
                          name={item.name}
                          subtitle={subtitle || undefined}
                          avatarSeed={item.id}
                          isLast={isLast}
                          isDark={isDark}
                          selected={item.selected}
                          onPress={() => handleToggle(item.id)}
                          nameColor={colors.text}
                          subtitleColor={colors.textMuted}
                          trailing={
                            <ContactSelectionCheck selected={item.selected} isDark={isDark} />
                          }
                        />
                      );
                    })
                  )}
                  {remainingCount > 0 && (
                    <TouchableOpacity
                      style={styles.showMoreButton}
                      onPress={() => {
                        lightHaptic();
                        setVisibleCount(c => c + CONTACTS_PAGE_SIZE);
                      }}
                      activeOpacity={0.7}
                    >
                      <Text size="sm" weight="semibold" color={colors.buttonActive}>
                        {t('onboarding.success.showMoreCount').replace(
                          '{count}',
                          String(Math.min(CONTACTS_PAGE_SIZE, remainingCount))
                        )}
                      </Text>
                      <Ionicons name="chevron-down" size={16} color={colors.buttonActive} />
                    </TouchableOpacity>
                  )}
                </ScrollView>

                <TouchableOpacity
                  style={[
                    styles.primaryButton,
                    {
                      backgroundColor:
                        selectedCount === 0 ? colors.buttonInactive : colors.buttonActive,
                    },
                  ]}
                  onPress={handleSendSmsInvites}
                  activeOpacity={0.8}
                  disabled={selectedCount === 0 || isSendingSms}
                >
                  {isSendingSms ? (
                    <ActivityIndicator size="small" color={BASE_WHITE} />
                  ) : (
                    <>
                      <Ionicons
                        name="send-outline"
                        size={18}
                        color={selectedCount === 0 ? colors.textMuted : colors.buttonTextActive}
                      />
                      <Text
                        size="base"
                        weight="semibold"
                        color={selectedCount === 0 ? colors.textMuted : colors.buttonTextActive}
                        style={styles.primaryButtonText}
                      >
                        {t('onboarding.success.sendInvitesCount').replace(
                          '{count}',
                          String(selectedCount)
                        )}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.secondaryButton, { borderColor: colors.border }]}
                  onPress={handleNativeShare}
                  activeOpacity={0.7}
                  disabled={referralLoading || !referralLink}
                >
                  <Ionicons name="share-outline" size={18} color={colors.text} />
                  <Text
                    size="sm"
                    weight="semibold"
                    color={colors.text}
                    style={styles.secondaryButtonText}
                  >
                    {t('onboarding.success.shareLinkInstead')}
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* DENIED: fallback to share link */}
            {showDeniedState && (
              <View style={styles.deniedArea}>
                <Text size="sm" weight="semibold" color={colors.text} style={styles.deniedTitle}>
                  {t('onboarding.success.permissionDenied')}
                </Text>
                <Text size="xs" color={colors.textMuted} style={styles.deniedHint}>
                  {t('onboarding.success.permissionDeniedHint')}
                </Text>

                <TouchableOpacity
                  style={[styles.primaryButton, { backgroundColor: colors.buttonActive }]}
                  onPress={handleNativeShare}
                  activeOpacity={0.8}
                  disabled={referralLoading || !referralLink}
                >
                  {referralLoading ? (
                    <ActivityIndicator size="small" color={BASE_WHITE} />
                  ) : (
                    <>
                      <Ionicons name="share-outline" size={20} color={colors.buttonTextActive} />
                      <Text
                        size="base"
                        weight="semibold"
                        color={colors.buttonTextActive}
                        style={styles.primaryButtonText}
                      >
                        {t('onboarding.success.shareButton')}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.openSettingsLink}
                  onPress={() => Linking.openSettings()}
                  activeOpacity={0.6}
                >
                  <Text size="xs" color={colors.buttonActive}>
                    {t('onboarding.success.openSettings')}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </Animated.View>

        {/* Skip / Continue */}
        <Animated.View style={[skipAnimatedStyle, hasInvited && styles.continueWrapper]}>
          {hasInvited ? (
            <TouchableOpacity
              style={[styles.continueButton, { backgroundColor: colors.buttonActive }]}
              onPress={handleContinue}
              activeOpacity={0.8}
            >
              <Text
                size="base"
                weight="semibold"
                color={colors.buttonTextActive}
                style={styles.continueText}
              >
                {t('common.continue')}
              </Text>
              <Ionicons name="arrow-forward" size={18} color={colors.buttonTextActive} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={handleContinue}
              activeOpacity={0.6}
              style={styles.skipButton}
            >
              <Text size="sm" color={colors.textMuted} style={styles.maybeLater}>
                {t('onboarding.success.maybeLater')}
              </Text>
            </TouchableOpacity>
          )}
        </Animated.View>
      </SheetScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
  },
  confetti: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
  },
  scrollContainer: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacingPixels[6],
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: radiusPixels.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacingPixels[4],
  },
  title: {
    textAlign: 'center',
    marginBottom: spacingPixels[2],
  },
  subtitle: {
    textAlign: 'center',
    marginBottom: spacingPixels[6],
  },
  inviteCardWrapper: {
    width: '100%',
  },
  inviteCard: {
    width: '100%',
    alignItems: 'center',
    padding: spacingPixels[5],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    marginBottom: spacingPixels[4],
  },
  inviteTitle: {
    marginTop: spacingPixels[2],
    textAlign: 'center',
  },
  inviteSubtitle: {
    textAlign: 'center',
    marginTop: spacingPixels[1],
    marginBottom: spacingPixels[4],
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    width: '100%',
    gap: spacingPixels[2],
  },
  primaryButtonText: {},
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    width: '100%',
    borderWidth: 1,
    marginTop: spacingPixels[3],
    gap: spacingPixels[2],
  },
  secondaryButtonText: {},
  contactsArea: {
    width: '100%',
  },
  searchBar: {
    marginBottom: spacingPixels[2],
  },
  listHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacingPixels[1],
    paddingVertical: spacingPixels[2],
  },
  listHeaderLabel: {
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  contactList: {
    maxHeight: CONTACT_LIST_MAX_HEIGHT,
    marginBottom: spacingPixels[2],
  },
  emptySearchState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[8],
    gap: spacingPixels[2],
  },
  showMoreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[3],
    gap: spacingPixels[1],
  },
  noContacts: {
    textAlign: 'center',
  },
  deniedArea: {
    width: '100%',
    alignItems: 'center',
  },
  deniedTitle: {
    textAlign: 'center',
    marginBottom: spacingPixels[1],
  },
  deniedHint: {
    textAlign: 'center',
    marginBottom: spacingPixels[4],
  },
  openSettingsLink: {
    paddingVertical: spacingPixels[3],
  },
  skipButton: {
    paddingVertical: spacingPixels[3],
  },
  maybeLater: {
    textAlign: 'center',
  },
  continueWrapper: {
    width: '100%',
  },
  continueButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    width: '100%',
    gap: spacingPixels[2],
  },
  continueText: {},
});

export default SuccessStep;
