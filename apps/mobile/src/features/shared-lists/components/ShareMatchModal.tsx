/**
 * ShareMatchModal Component
 * Modal for sharing matches with contacts from shared lists
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Share,
  Linking,
  FlatList,
  ScrollView,
  Keyboard,
  Dimensions,
  Image,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import ActionSheet, { SheetManager, SheetProps } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text, useToast } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, fontSizePixels } from '@rallia/design-system';
import { primary, neutral, base } from '@rallia/design-system';
import { lightHaptic, getProfilePictureUrl } from '@rallia/shared-utils';
import {
  getSharedContactLists,
  getSharedContacts,
  shareMatchWithContacts,
  type SharedContactList,
  type SharedContact,
  type ShareChannel,
} from '@rallia/shared-services';
import { usePlayerMatches } from '@rallia/shared-hooks';
import { SportIcon } from '../../../components/SportIcon';
import { useThemeStyles, useTranslation, type TranslationKey } from '../../../hooks';

// Local interface to ensure TypeScript recognizes match properties
// (workaround for TS language server cache issues with extended types)
interface MatchItem {
  id: string;
  match_date: string;
  start_time: string;
  format?: string | null;
  location_name?: string | null;
  facility?: { name: string } | null;
  sport?: { name: string } | null;
  participants?: Array<{
    status: string;
    is_host?: boolean;
    player?: {
      profile?: {
        profile_picture_url?: string | null;
      } | null;
    } | null;
  }> | null;
}

type Step = 'select-match' | 'select-contacts' | 'confirm';
const TOTAL_STEPS = 3;
const STEP_NUMBER: Record<Step, number> = {
  'select-match': 1,
  'select-contacts': 2,
  confirm: 3,
};
const STEP_NAME_KEYS: Record<Step, TranslationKey> = {
  'select-match': 'sharedLists.share.stepNames.selectMatch',
  'select-contacts': 'sharedLists.share.stepNames.selectContacts',
  confirm: 'sharedLists.share.stepNames.confirm',
};

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const STEP_INDEX: Record<Step, number> = {
  'select-match': 0,
  'select-contacts': 1,
  confirm: 2,
};

interface SelectedContact {
  id: string;
  listId?: string;
  name: string;
  phone?: string;
  email?: string;
}

// =============================================================================
// PROGRESS BAR COMPONENT
// =============================================================================

interface ProgressBarProps {
  currentStep: number;
  totalSteps: number;
  stepName: string;
  colors: {
    primary: string;
    textMuted: string;
    border: string;
    progressActive: string;
    progressInactive: string;
  };
  t: (key: TranslationKey) => string;
}

const ProgressBar: React.FC<ProgressBarProps> = ({
  currentStep,
  totalSteps,
  stepName,
  colors,
  t,
}) => {
  const progress = useSharedValue((currentStep / totalSteps) * 100);

  useEffect(() => {
    progress.value = withTiming((currentStep / totalSteps) * 100, { duration: 300 });
  }, [currentStep, totalSteps, progress]);

  const animatedProgressStyle = useAnimatedStyle(() => ({
    width: `${progress.value}%`,
  }));

  return (
    <View style={styles.progressContainer}>
      <View style={styles.progressHeader}>
        <Text size="sm" weight="semibold" color={colors.textMuted}>
          {t('sharedLists.share.step')
            .replace('{current}', String(currentStep))
            .replace('{total}', String(totalSteps))}
        </Text>
        <Text size="sm" weight="bold" color={colors.primary}>
          {stepName}
        </Text>
      </View>
      <View style={[styles.progressBarBg, { backgroundColor: colors.progressInactive }]}>
        <Animated.View
          style={[
            styles.progressBarFill,
            { backgroundColor: colors.progressActive },
            animatedProgressStyle,
          ]}
        />
      </View>
    </View>
  );
};

// =============================================================================
// WIZARD HEADER COMPONENT
// =============================================================================

interface WizardHeaderProps {
  step: Step;
  onBack: () => void;
  onClose: () => void;
  colors: { primary: string; textMuted: string; border: string; text: string };
  t: (key: TranslationKey) => string;
}

const WizardHeader: React.FC<WizardHeaderProps> = ({ step, onBack, onClose, colors, t }) => {
  return (
    <View style={[styles.header, { borderBottomColor: colors.border }]}>
      <View style={styles.headerLeft}>
        {step !== 'select-match' && (
          <TouchableOpacity
            onPress={() => {
              Keyboard.dismiss();
              lightHaptic();
              onBack();
            }}
            style={styles.headerButton}
            accessibilityLabel={t('common.back')}
            accessibilityRole="button"
          >
            <Ionicons name="chevron-back-outline" size={24} color={colors.primary} />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.headerCenter} />

      <View style={styles.headerRight}>
        <TouchableOpacity
          onPress={() => {
            Keyboard.dismiss();
            lightHaptic();
            onClose();
          }}
          style={styles.headerButton}
          accessibilityLabel={t('common.close')}
          accessibilityRole="button"
        >
          <Ionicons name="close-outline" size={24} color={colors.textMuted} />
        </TouchableOpacity>
      </View>
    </View>
  );
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function ShareMatchActionSheet({ payload }: SheetProps<'share-match'>) {
  const playerId = payload?.playerId ?? '';

  const { colors, isDark } = useThemeStyles();
  const toast = useToast();
  const { t, locale } = useTranslation();

  // State
  const [step, setStep] = useState<Step>('select-match');
  const [highestStepVisited, setHighestStepVisited] = useState(0);
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [selectedContacts, setSelectedContacts] = useState<SelectedContact[]>([]);
  const [lists, setLists] = useState<SharedContactList[]>([]);
  const [expandedListId, setExpandedListId] = useState<string | null>(null);
  const [listContacts, setListContacts] = useState<Record<string, SharedContact[]>>({});
  const [isLoadingLists, setIsLoadingLists] = useState(false);
  const [isLoadingContacts, setIsLoadingContacts] = useState<Record<string, boolean>>({});

  // Animation values
  const translateX = useSharedValue(0);

  const animatedStepStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  // Animate step changes
  useEffect(() => {
    const stepIndex = STEP_INDEX[step];
    setHighestStepVisited(prev => Math.max(prev, stepIndex));
    translateX.value = withSpring(-stepIndex * SCREEN_WIDTH, {
      damping: 80,
      stiffness: 600,
      overshootClamping: false,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Fetch upcoming matches created by this player
  const { matches: upcomingMatches, isLoading: isLoadingMatches } = usePlayerMatches({
    userId: playerId,
    timeFilter: 'upcoming',
    statusFilter: 'hosting',
  });

  // Fetch shared lists
  const fetchLists = useCallback(async () => {
    setIsLoadingLists(true);
    try {
      const data = await getSharedContactLists();
      setLists(data);
    } catch (error) {
      console.error('Failed to fetch lists:', error);
    } finally {
      setIsLoadingLists(false);
    }
  }, []);

  // Fetch contacts for a list
  const fetchListContacts = useCallback(
    async (listId: string) => {
      if (listContacts[listId]) return; // Already loaded

      setIsLoadingContacts(prev => ({ ...prev, [listId]: true }));
      try {
        const contacts = await getSharedContacts(listId);
        setListContacts(prev => ({ ...prev, [listId]: contacts }));
      } catch (error) {
        console.error('Failed to fetch contacts:', error);
      } finally {
        setIsLoadingContacts(prev => ({ ...prev, [listId]: false }));
      }
    },
    [listContacts]
  );

  // Load lists when we're on contact selection step
  useEffect(() => {
    if (step === 'select-contacts') {
      fetchLists();
    }
  }, [step, fetchLists]);

  // Get the selected match details
  const selectedMatch = useMemo(() => {
    if (!selectedMatchId) return null;
    return (upcomingMatches as MatchItem[] | undefined)?.find(m => m.id === selectedMatchId);
  }, [selectedMatchId, upcomingMatches]);

  const resetState = useCallback(() => {
    setStep('select-match');
    setHighestStepVisited(0);
    translateX.value = 0;
    setSelectedMatchId(null);
    setSelectedContacts([]);
    setExpandedListId(null);
  }, [translateX]);

  const handleClose = useCallback(() => {
    resetState();
    SheetManager.hide('share-match');
  }, [resetState]);

  // Toggle list expansion
  const handleToggleList = useCallback(
    (listId: string) => {
      if (expandedListId === listId) {
        setExpandedListId(null);
      } else {
        setExpandedListId(listId);
        fetchListContacts(listId);
      }
    },
    [expandedListId, fetchListContacts]
  );

  // Toggle contact selection
  const handleToggleContact = useCallback((contact: SharedContact, listId: string) => {
    setSelectedContacts(prev => {
      const existing = prev.find(c => c.id === contact.id);
      if (existing) {
        return prev.filter(c => c.id !== contact.id);
      } else {
        return [
          ...prev,
          {
            id: contact.id,
            listId,
            name: contact.name,
            phone: contact.phone || undefined,
            email: contact.email || undefined,
          },
        ];
      }
    });
  }, []);

  // Select all contacts from a list
  const handleSelectAllFromList = useCallback(
    (list: SharedContactList) => {
      const contacts = listContacts[list.id] || [];
      const allSelected = contacts.every(c => selectedContacts.some(sc => sc.id === c.id));

      if (allSelected) {
        // Deselect all from this list
        setSelectedContacts(prev => prev.filter(sc => sc.listId !== list.id));
      } else {
        // Select all from this list
        const newContacts = contacts
          .filter(c => !selectedContacts.some(sc => sc.id === c.id))
          .map(c => ({
            id: c.id,
            listId: list.id,
            name: c.name,
            phone: c.phone || undefined,
            email: c.email || undefined,
          }));
        setSelectedContacts(prev => [...prev, ...newContacts]);
      }
    },
    [listContacts, selectedContacts]
  );

  // Share via native share sheet
  const handleShare = useCallback(
    async (channel: ShareChannel) => {
      if (!selectedMatch || selectedContacts.length === 0) return;

      try {
        const result = await shareMatchWithContacts({
          matchId: selectedMatch.id,
          channel,
          contacts: selectedContacts.map(c => ({
            contactId: c.id,
            listId: c.listId,
            name: c.name,
            phone: c.phone,
            email: c.email,
          })),
        });

        if (channel === 'share_sheet' || channel === 'copy_link') {
          await Share.share({
            message: result.shareMessage,
            title: t('sharedLists.share.shareGame'),
          });
        } else if (channel === 'sms') {
          const phones = selectedContacts
            .filter(c => c.phone)
            .map(c => c.phone)
            .join(',');
          if (phones) {
            const smsUrl = `sms:${phones}?body=${encodeURIComponent(result.shareMessage)}`;
            await Linking.openURL(smsUrl);
          }
        } else if (channel === 'whatsapp') {
          const firstPhone = selectedContacts.find(c => c.phone)?.phone;
          if (firstPhone) {
            const cleanPhone = firstPhone.replace(/\D/g, '');
            const waUrl = `whatsapp://send?phone=${cleanPhone}&text=${encodeURIComponent(result.shareMessage)}`;
            await Linking.openURL(waUrl);
          }
        } else if (channel === 'email') {
          const emails = selectedContacts
            .filter(c => c.email)
            .map(c => c.email)
            .join(',');
          if (emails) {
            const subject = encodeURIComponent(t('sharedLists.share.gameInvitation'));
            const body = encodeURIComponent(result.shareMessage);
            const mailUrl = `mailto:${emails}?subject=${subject}&body=${body}`;
            await Linking.openURL(mailUrl);
          }
        }
      } catch (error) {
        console.error('Failed to share:', error);
        toast.error(t('sharedLists.share.failedToShare'));
      }
    },
    [selectedMatch, selectedContacts, toast, t]
  );

  // Render match item
  const renderMatchItem = useCallback(
    ({ item }: { item: MatchItem }) => {
      const isSelected = selectedMatchId === item.id;
      const matchDate = new Date(item.match_date).toLocaleDateString(locale, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });
      const startTime = item.start_time?.substring(0, 5) || '';

      // Build participant slots (joined only)
      const totalSlots = item.format === 'doubles' ? 4 : 2;
      const joined = item.participants?.filter(p => p.status === 'joined') ?? [];
      const host = joined.find(p => p.is_host);
      const others = joined.filter(p => !p.is_host);
      const orderedParticipants = host ? [host, ...others] : others;

      return (
        <TouchableOpacity
          style={[
            styles.matchItem,
            {
              backgroundColor: isSelected ? `${colors.buttonActive}15` : colors.buttonInactive,
              borderColor: isSelected ? colors.buttonActive : colors.border,
            },
          ]}
          onPress={() => {
            lightHaptic();
            setSelectedMatchId(item.id);
          }}
          activeOpacity={0.7}
        >
          <View
            style={[
              styles.matchIconContainer,
              { backgroundColor: isSelected ? colors.buttonActive : colors.border },
            ]}
          >
            <SportIcon
              sportName={item.sport?.name || 'tennis'}
              size={24}
              color={isSelected ? colors.buttonTextActive : colors.textMuted}
            />
          </View>
          <View style={styles.matchInfo}>
            <Text
              size="base"
              weight={isSelected ? 'semibold' : 'regular'}
              color={isSelected ? colors.buttonActive : colors.text}
            >
              {matchDate} {t('matchPage.at')} {startTime}
            </Text>
            <Text size="xs" color={colors.textMuted}>
              {item.location_name || item.facility?.name || 'Location TBD'}
            </Text>
            {/* Participant avatars */}
            <View style={styles.slotsRow}>
              {Array.from({ length: totalSlots }).map((_, i) => {
                const participant = orderedParticipants[i];
                const isHost = participant?.is_host ?? false;
                const avatarUrl = participant
                  ? getProfilePictureUrl(participant.player?.profile?.profile_picture_url)
                  : null;
                const avatarBorderColor = isDark ? primary[400] : primary[500];
                return (
                  <View key={i} style={styles.slotWrapper}>
                    <View
                      style={[
                        styles.slot,
                        i > 0 && { marginLeft: -8 },
                        participant
                          ? {
                              backgroundColor: avatarUrl
                                ? isDark
                                  ? primary[400]
                                  : primary[500]
                                : isDark
                                  ? neutral[700]
                                  : neutral[200],
                              borderWidth: 2,
                              borderColor: avatarBorderColor,
                              shadowColor: avatarBorderColor,
                              shadowOffset: { width: 0, height: 2 },
                              shadowOpacity: 0.3,
                              shadowRadius: 4,
                              elevation: 3,
                            }
                          : {
                              backgroundColor: isDark ? neutral[800] : neutral[100],
                              borderWidth: 2,
                              borderStyle: 'dashed' as const,
                              borderColor: isDark ? neutral[600] : neutral[300],
                            },
                      ]}
                    >
                      {participant ? (
                        avatarUrl ? (
                          <Image source={{ uri: avatarUrl }} style={styles.slotAvatar} />
                        ) : (
                          <Ionicons
                            name="person-outline"
                            size={14}
                            color={isDark ? neutral[400] : neutral[500]}
                          />
                        )
                      ) : (
                        <Ionicons
                          name="add-outline"
                          size={16}
                          color={isDark ? neutral[600] : neutral[300]}
                        />
                      )}
                    </View>
                    {isHost && (
                      <View
                        style={[
                          styles.hostIndicator,
                          { backgroundColor: isDark ? primary[400] : primary[500] },
                        ]}
                      >
                        <Ionicons name="star" size={8} color={base.white} />
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          </View>
          {isSelected && <Ionicons name="checkmark-circle" size={22} color={colors.buttonActive} />}
        </TouchableOpacity>
      );
    },
    [selectedMatchId, colors, isDark, locale, t]
  );

  // Render list item with contacts
  const renderListItem = useCallback(
    ({ item }: { item: SharedContactList }) => {
      const isExpanded = expandedListId === item.id;
      const contacts = listContacts[item.id] || [];
      const isLoadingThisList = isLoadingContacts[item.id];
      const allSelected =
        contacts.length > 0 && contacts.every(c => selectedContacts.some(sc => sc.id === c.id));
      const someSelected =
        contacts.length > 0 && contacts.some(c => selectedContacts.some(sc => sc.id === c.id));

      return (
        <View>
          <TouchableOpacity
            style={[
              styles.matchItem,
              {
                backgroundColor: someSelected ? `${colors.buttonActive}15` : colors.buttonInactive,
                borderColor: someSelected ? colors.buttonActive : colors.border,
                marginBottom: isExpanded ? 0 : spacingPixels[3],
                borderBottomLeftRadius: isExpanded ? 0 : radiusPixels.xl,
                borderBottomRightRadius: isExpanded ? 0 : radiusPixels.xl,
              },
            ]}
            onPress={() => {
              lightHaptic();
              handleToggleList(item.id);
            }}
            activeOpacity={0.7}
          >
            <View
              style={[
                styles.matchIconContainer,
                { backgroundColor: someSelected ? colors.buttonActive : colors.border },
              ]}
            >
              <Ionicons
                name="people-outline"
                size={24}
                color={someSelected ? colors.buttonTextActive : colors.textMuted}
              />
            </View>
            <View style={styles.matchInfo}>
              <Text
                size="base"
                weight={someSelected ? 'semibold' : 'regular'}
                color={someSelected ? colors.buttonActive : colors.text}
              >
                {item.name}
              </Text>
              <Text size="xs" color={colors.textMuted}>
                {item.contact_count === 1
                  ? t('sharedLists.contacts.contactCountSingular', {
                      count: item.contact_count,
                    })
                  : t('sharedLists.contacts.contactCount', {
                      count: item.contact_count,
                    })}
              </Text>
            </View>
            <Ionicons
              name={isExpanded ? 'chevron-up' : 'chevron-down'}
              size={20}
              color={someSelected ? colors.buttonActive : colors.textMuted}
            />
          </TouchableOpacity>

          {isExpanded && (
            <View
              style={[
                styles.contactsContainer,
                {
                  backgroundColor: someSelected
                    ? `${colors.buttonActive}08`
                    : colors.buttonInactive,
                  borderColor: someSelected ? colors.buttonActive : colors.border,
                  borderWidth: 1,
                  borderTopWidth: 0,
                  borderBottomLeftRadius: radiusPixels.xl,
                  borderBottomRightRadius: radiusPixels.xl,
                  marginBottom: spacingPixels[3],
                },
              ]}
            >
              {isLoadingThisList ? (
                <ActivityIndicator size="small" color={colors.primary} style={styles.loader} />
              ) : contacts.length === 0 ? (
                <Text size="sm" style={[styles.emptyText, { color: colors.textMuted }]}>
                  {t('sharedLists.contacts.noContactsInList')}
                </Text>
              ) : (
                <>
                  <TouchableOpacity
                    style={[
                      styles.selectAllButton,
                      {
                        borderBottomColor: isDark ? neutral[700] : neutral[200],
                      },
                    ]}
                    onPress={() => handleSelectAllFromList(item)}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name={allSelected ? 'checkmark-circle' : 'ellipse-outline'}
                      size={22}
                      color={allSelected ? colors.primary : colors.textMuted}
                    />
                    <Text
                      size="sm"
                      weight="semibold"
                      color={allSelected ? colors.primary : colors.text}
                    >
                      {t('common.selectAll')}
                    </Text>
                  </TouchableOpacity>
                  {contacts.map((contact, index) => {
                    const isSelected = selectedContacts.some(sc => sc.id === contact.id);
                    const isLast = index === contacts.length - 1;
                    const initials = contact.name
                      .split(' ')
                      .map(n => n[0])
                      .join('')
                      .substring(0, 2)
                      .toUpperCase();
                    return (
                      <TouchableOpacity
                        key={contact.id}
                        style={[
                          styles.contactRow,
                          !isLast && {
                            borderBottomWidth: 1,
                            borderBottomColor: isDark ? neutral[700] : neutral[200],
                          },
                        ]}
                        onPress={() => handleToggleContact(contact, item.id)}
                        activeOpacity={0.7}
                      >
                        <View
                          style={[
                            styles.contactAvatar,
                            {
                              backgroundColor: isSelected
                                ? isDark
                                  ? primary[800]
                                  : primary[100]
                                : isDark
                                  ? neutral[700]
                                  : neutral[200],
                            },
                          ]}
                        >
                          <Text
                            size="xs"
                            weight="bold"
                            color={
                              isSelected ? (isDark ? primary[300] : primary[600]) : colors.textMuted
                            }
                          >
                            {initials}
                          </Text>
                        </View>
                        <View style={styles.contactInfo}>
                          <Text
                            size="sm"
                            weight={isSelected ? 'semibold' : 'regular'}
                            color={colors.text}
                          >
                            {contact.name}
                          </Text>
                          {contact.phone && (
                            <Text size="xs" color={colors.textMuted}>
                              {contact.phone}
                            </Text>
                          )}
                        </View>
                        <Ionicons
                          name={isSelected ? 'checkmark-circle' : 'ellipse-outline'}
                          size={22}
                          color={isSelected ? colors.primary : colors.textMuted}
                        />
                      </TouchableOpacity>
                    );
                  })}
                </>
              )}
            </View>
          )}
        </View>
      );
    },
    [
      expandedListId,
      listContacts,
      isLoadingContacts,
      selectedContacts,
      colors,
      isDark,
      handleToggleList,
      handleToggleContact,
      handleSelectAllFromList,
      t,
    ]
  );

  // Navigation buttons
  const canProceed = () => {
    switch (step) {
      case 'select-match':
        return !!selectedMatchId;
      case 'select-contacts':
        return selectedContacts.length > 0;
      default:
        return false;
    }
  };

  const handleNext = () => {
    if (step === 'select-match') {
      setStep('select-contacts');
    } else if (step === 'select-contacts') {
      setStep('confirm');
    }
  };

  const handleBack = () => {
    if (step === 'select-contacts') {
      setStep('select-match');
    } else if (step === 'confirm') {
      setStep('select-contacts');
    }
  };

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
      <WizardHeader step={step} onBack={handleBack} onClose={handleClose} colors={colors} t={t} />

      {/* Progress bar */}
      <ProgressBar
        currentStep={STEP_NUMBER[step]}
        totalSteps={TOTAL_STEPS}
        stepName={t(STEP_NAME_KEYS[step])}
        colors={colors}
        t={t}
      />

      {/* Content */}
      <View style={styles.stepsViewport}>
        <Animated.View
          style={[styles.stepsContainer, { width: SCREEN_WIDTH * TOTAL_STEPS }, animatedStepStyle]}
        >
          {/* Step 1: Select Match */}
          <View style={[styles.stepWrapper, { width: SCREEN_WIDTH }]}>
            <View style={styles.stepContent}>
              <Text
                weight="semibold"
                size="lg"
                style={{ color: colors.text, marginBottom: spacingPixels[3] }}
              >
                {t('sharedLists.share.selectMatch')}
              </Text>
              {isLoadingMatches ? (
                <ActivityIndicator size="large" color={colors.primary} style={styles.loader} />
              ) : !upcomingMatches || upcomingMatches.length === 0 ? (
                <View style={styles.emptyState}>
                  <Ionicons name="calendar-outline" size={48} color={colors.textMuted} />
                  <Text style={[styles.emptyTitle, { color: colors.text }]}>
                    {t('sharedLists.share.noUpcomingMatches')}
                  </Text>
                  <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
                    {t('sharedLists.share.createMatchFirst')}
                  </Text>
                </View>
              ) : (
                <FlatList
                  data={upcomingMatches as MatchItem[] | undefined}
                  renderItem={renderMatchItem}
                  keyExtractor={item => item.id}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={styles.matchList}
                />
              )}
            </View>
          </View>

          {/* Step 2: Select Contacts (lazy mounted) */}
          <View style={[styles.stepWrapper, { width: SCREEN_WIDTH }]}>
            {highestStepVisited >= 1 && (
              <View style={styles.stepContent}>
                <Text
                  weight="semibold"
                  size="lg"
                  style={{ color: colors.text, marginBottom: spacingPixels[3] }}
                >
                  {t('sharedLists.share.selectContacts')}
                </Text>
                {selectedContacts.length > 0 && (
                  <View
                    style={[
                      styles.selectedBadge,
                      { backgroundColor: isDark ? primary[900] : primary[50] },
                    ]}
                  >
                    <Text size="sm" style={{ color: colors.primary }}>
                      {t('sharedLists.share.contactsSelected', {
                        count: selectedContacts.length,
                      })}
                    </Text>
                  </View>
                )}
                {isLoadingLists ? (
                  <ActivityIndicator size="large" color={colors.primary} style={styles.loader} />
                ) : lists.length === 0 ? (
                  <View style={styles.emptyState}>
                    <Ionicons name="people-outline" size={48} color={colors.textMuted} />
                    <Text style={[styles.emptyTitle, { color: colors.text }]}>
                      {t('sharedLists.share.noSharedLists')}
                    </Text>
                    <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
                      {t('sharedLists.share.createListFirst')}
                    </Text>
                  </View>
                ) : (
                  <FlatList
                    data={lists}
                    renderItem={renderListItem}
                    keyExtractor={item => item.id}
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={styles.listContainer}
                  />
                )}
              </View>
            )}
          </View>

          {/* Step 3: Confirm & Share (lazy mounted) */}
          <View style={[styles.stepWrapper, { width: SCREEN_WIDTH }]}>
            {highestStepVisited >= 2 && (
              <ScrollView style={styles.stepContent} showsVerticalScrollIndicator={false}>
                <Text
                  weight="semibold"
                  size="lg"
                  style={{ color: colors.text, marginBottom: spacingPixels[3] }}
                >
                  {t('sharedLists.share.howToShare')}
                </Text>

                {/* Match summary - same card style as step 1 */}
                {selectedMatch &&
                  (() => {
                    const matchDate = new Date(selectedMatch.match_date).toLocaleDateString(
                      locale,
                      {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                      }
                    );
                    const startTime = selectedMatch.start_time?.substring(0, 5) || '';
                    const totalSlots = selectedMatch.format === 'doubles' ? 4 : 2;
                    const joined =
                      selectedMatch.participants?.filter(p => p.status === 'joined') ?? [];
                    const host = joined.find(p => p.is_host);
                    const others = joined.filter(p => !p.is_host);
                    const orderedParticipants = host ? [host, ...others] : others;

                    return (
                      <View
                        style={[
                          styles.matchItem,
                          {
                            backgroundColor: colors.buttonInactive,
                            borderColor: colors.border,
                          },
                        ]}
                      >
                        <View
                          style={[styles.matchIconContainer, { backgroundColor: colors.border }]}
                        >
                          <SportIcon
                            sportName={selectedMatch.sport?.name || 'tennis'}
                            size={24}
                            color={colors.textMuted}
                          />
                        </View>
                        <View style={styles.matchInfo}>
                          <Text size="base" weight="regular" color={colors.text}>
                            {matchDate} {t('matchPage.at')} {startTime}
                          </Text>
                          <Text size="xs" color={colors.textMuted}>
                            {selectedMatch.location_name ||
                              selectedMatch.facility?.name ||
                              'Location TBD'}
                          </Text>
                          <View style={styles.slotsRow}>
                            {Array.from({ length: totalSlots }).map((_, i) => {
                              const participant = orderedParticipants[i];
                              const isHost = participant?.is_host ?? false;
                              const avatarUrl = participant
                                ? getProfilePictureUrl(
                                    participant.player?.profile?.profile_picture_url
                                  )
                                : null;
                              const avatarBorderColor = isDark ? primary[400] : primary[500];
                              return (
                                <View key={i} style={styles.slotWrapper}>
                                  <View
                                    style={[
                                      styles.slot,
                                      i > 0 && { marginLeft: -8 },
                                      participant
                                        ? {
                                            backgroundColor: avatarUrl
                                              ? isDark
                                                ? primary[400]
                                                : primary[500]
                                              : isDark
                                                ? neutral[700]
                                                : neutral[200],
                                            borderWidth: 2,
                                            borderColor: avatarBorderColor,
                                            shadowColor: avatarBorderColor,
                                            shadowOffset: { width: 0, height: 2 },
                                            shadowOpacity: 0.3,
                                            shadowRadius: 4,
                                            elevation: 3,
                                          }
                                        : {
                                            backgroundColor: isDark ? neutral[800] : neutral[100],
                                            borderWidth: 2,
                                            borderStyle: 'dashed' as const,
                                            borderColor: isDark ? neutral[600] : neutral[300],
                                          },
                                    ]}
                                  >
                                    {participant ? (
                                      avatarUrl ? (
                                        <Image
                                          source={{ uri: avatarUrl }}
                                          style={styles.slotAvatar}
                                        />
                                      ) : (
                                        <Ionicons
                                          name="person-outline"
                                          size={14}
                                          color={isDark ? neutral[400] : neutral[500]}
                                        />
                                      )
                                    ) : (
                                      <Ionicons
                                        name="add-outline"
                                        size={16}
                                        color={isDark ? neutral[600] : neutral[300]}
                                      />
                                    )}
                                  </View>
                                  {isHost && (
                                    <View
                                      style={[
                                        styles.hostIndicator,
                                        { backgroundColor: isDark ? primary[400] : primary[500] },
                                      ]}
                                    >
                                      <Ionicons name="star" size={8} color={base.white} />
                                    </View>
                                  )}
                                </View>
                              );
                            })}
                          </View>
                        </View>
                      </View>
                    );
                  })()}

                {/* Recipients summary */}
                <View
                  style={[
                    styles.matchItem,
                    {
                      backgroundColor: colors.buttonInactive,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <View style={[styles.matchIconContainer, { backgroundColor: colors.border }]}>
                    <Ionicons name="people-outline" size={24} color={colors.textMuted} />
                  </View>
                  <View style={styles.matchInfo}>
                    <Text size="base" weight="regular" color={colors.text}>
                      {t('sharedLists.share.recipients', {
                        count: selectedContacts.length,
                      })}
                    </Text>
                    <Text size="xs" color={colors.textMuted} numberOfLines={1}>
                      {selectedContacts
                        .slice(0, 3)
                        .map(c => c.name)
                        .join(', ')}
                      {selectedContacts.length > 3
                        ? ` +${t('common.more', { count: selectedContacts.length - 3 })}`
                        : ''}
                    </Text>
                  </View>
                </View>

                {/* Share options */}
                <View style={styles.shareOptions}>
                  <TouchableOpacity
                    style={[styles.shareOption, { backgroundColor: colors.primary }]}
                    onPress={() => handleShare('share_sheet')}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="share-outline" size={20} color={colors.buttonTextActive} />
                    <Text size="sm" weight="semibold" color={colors.buttonTextActive}>
                      {t('common.share')}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.shareOption,
                      {
                        backgroundColor: selectedContacts.some(c => c.phone)
                          ? colors.primary
                          : colors.border,
                      },
                    ]}
                    onPress={() => handleShare('sms')}
                    disabled={!selectedContacts.some(c => c.phone)}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name="chatbubble-outline"
                      size={20}
                      color={
                        selectedContacts.some(c => c.phone)
                          ? colors.buttonTextActive
                          : colors.textMuted
                      }
                    />
                    <Text
                      size="sm"
                      weight="semibold"
                      color={
                        selectedContacts.some(c => c.phone)
                          ? colors.buttonTextActive
                          : colors.textMuted
                      }
                    >
                      SMS
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.shareOption,
                      {
                        backgroundColor: selectedContacts.some(c => c.phone)
                          ? '#25D366'
                          : colors.border,
                      },
                    ]}
                    onPress={() => handleShare('whatsapp')}
                    disabled={!selectedContacts.some(c => c.phone)}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name="logo-whatsapp"
                      size={20}
                      color={selectedContacts.some(c => c.phone) ? base.white : colors.textMuted}
                    />
                    <Text
                      size="sm"
                      weight="semibold"
                      color={selectedContacts.some(c => c.phone) ? base.white : colors.textMuted}
                    >
                      WhatsApp
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.shareOption,
                      {
                        backgroundColor: selectedContacts.some(c => c.email)
                          ? colors.primary
                          : colors.border,
                      },
                    ]}
                    onPress={() => handleShare('email')}
                    disabled={!selectedContacts.some(c => c.email)}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name="mail-outline"
                      size={20}
                      color={
                        selectedContacts.some(c => c.email)
                          ? colors.buttonTextActive
                          : colors.textMuted
                      }
                    />
                    <Text
                      size="sm"
                      weight="semibold"
                      color={
                        selectedContacts.some(c => c.email)
                          ? colors.buttonTextActive
                          : colors.textMuted
                      }
                    >
                      Email
                    </Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            )}
          </View>
        </Animated.View>
      </View>

      {/* Footer with Next button */}
      {step !== 'confirm' && (
        <View style={[styles.footer, { borderTopColor: colors.border }]}>
          <TouchableOpacity
            style={[
              styles.nextButton,
              { backgroundColor: canProceed() ? colors.primary : colors.border },
            ]}
            onPress={handleNext}
            disabled={!canProceed()}
          >
            <Text
              size="lg"
              weight="semibold"
              color={canProceed() ? colors.buttonTextActive : colors.textMuted}
            >
              {step === 'select-match'
                ? t('sharedLists.share.selectContactsButton')
                : t('common.continue')}
            </Text>
            <Ionicons
              name="arrow-forward"
              size={20}
              color={canProceed() ? colors.buttonTextActive : colors.textMuted}
            />
          </TouchableOpacity>
        </View>
      )}
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
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    borderBottomWidth: 1,
  },
  headerLeft: {
    width: 40,
  },
  headerRight: {
    width: 40,
    alignItems: 'flex-end' as const,
  },
  headerButton: {
    padding: spacingPixels[1],
  },
  headerCenter: {
    flex: 1,
  },
  progressContainer: {
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacingPixels[2],
  },
  progressBarBg: {
    height: 4,
    borderRadius: radiusPixels.full,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: radiusPixels.full,
  },
  stepsViewport: {
    flex: 1,
    overflow: 'hidden',
  },
  stepsContainer: {
    flexDirection: 'row',
    flex: 1,
    height: '100%',
  },
  stepWrapper: {
    height: '100%',
  },
  stepContent: {
    flex: 1,
    paddingHorizontal: spacingPixels[4],
  },
  matchList: {
    paddingBottom: spacingPixels[4],
  },
  matchItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacingPixels[4],
    borderRadius: radiusPixels.xl,
    borderWidth: 1,
    marginBottom: spacingPixels[3],
    gap: spacingPixels[3],
  },
  matchIconContainer: {
    width: 44,
    height: 44,
    borderRadius: radiusPixels.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  matchInfo: {
    flex: 1,
  },
  slotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacingPixels[1.5],
  },
  slotWrapper: {
    position: 'relative',
    alignItems: 'center',
  },
  slot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  slotAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  hostIndicator: {
    position: 'absolute',
    bottom: -2,
    left: -2,
    width: 14,
    height: 14,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 4,
  },
  listContainer: {
    paddingBottom: spacingPixels[4],
  },
  contactsContainer: {
    paddingHorizontal: spacingPixels[3],
    paddingBottom: spacingPixels[3],
  },
  selectAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacingPixels[2.5],
    paddingHorizontal: spacingPixels[1],
    gap: spacingPixels[2.5],
    borderBottomWidth: 1,
    marginBottom: spacingPixels[1],
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacingPixels[2.5],
    paddingHorizontal: spacingPixels[1],
    gap: spacingPixels[3],
  },
  contactAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactInfo: {
    flex: 1,
  },
  selectedBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.full,
    marginBottom: spacingPixels[3],
  },
  shareOptions: {
    flexDirection: 'column',
    gap: spacingPixels[2],
    marginTop: spacingPixels[4],
    paddingBottom: spacingPixels[4],
  },
  shareOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[3.5],
    paddingHorizontal: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    gap: spacingPixels[2],
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[8],
  },
  emptyTitle: {
    fontSize: fontSizePixels.lg,
    fontWeight: '600',
    marginTop: spacingPixels[3],
  },
  emptySubtitle: {
    fontSize: fontSizePixels.sm,
    textAlign: 'center',
    marginTop: spacingPixels[2],
    paddingHorizontal: spacingPixels[4],
  },
  emptyText: {
    textAlign: 'center',
    paddingVertical: spacingPixels[3],
  },
  loader: {
    marginVertical: spacingPixels[4],
  },
  footer: {
    padding: spacingPixels[4],
    borderTopWidth: 1,
    paddingBottom: spacingPixels[4],
  },
  nextButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    gap: spacingPixels[2],
  },
});

// Keep default export for backwards compatibility during migration
export default ShareMatchActionSheet;
