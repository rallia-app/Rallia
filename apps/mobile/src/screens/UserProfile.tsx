import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useFocusEffect, useRoute, type RouteProp } from '@react-navigation/native';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { SheetManager } from 'react-native-actions-sheet';
import {
  Text,
  Skeleton,
  SkeletonAvatar,
  useToast,
  Card,
  Button,
  VStack,
  HStack,
} from '@rallia/shared-components';
import { supabase, Logger, OnboardingService } from '@rallia/shared-services';
import { useProfile, usePlayer, useProfileCompleteness } from '@rallia/shared-hooks';
import type { CompletenessItem } from '@rallia/shared-hooks';
import {
  getProfilePictureUrl,
  lightHaptic,
  mediumHaptic,
  successHaptic,
  errorHaptic,
  getHumanName,
} from '@rallia/shared-utils';
import type { DayEnum, Sport } from '@rallia/shared-types';
import {
  spacingPixels,
  radiusPixels,
  fontSizePixels,
  fontWeightNumeric,
  primary,
  neutral,
  status,
  base,
} from '@rallia/design-system';

import { useAppNavigation } from '#/navigation/hooks';
import { replaceImage } from '#/services/imageUpload';
import {
  useImagePicker,
  useThemeStyles,
  useTranslation,
  useTourSequence,
  useSportSetup,
  useScrollBottomInset,
  type TranslationKey,
} from '#/hooks';
import { useActionsSheet, useSport } from '#/context';
import * as Analytics from '#/services/analytics';
import { CopilotStep, WalkthroughableView } from '#/context/TourContext';
import { withTimeout, getNetworkErrorMessage } from '#/utils/networkTimeout';
import { formatDate as formatDateUtil, formatDateMonthYear } from '#/utils/dateFormatting';
import {
  HourlyAvailabilityGrid,
  cellKey,
  emptyGrid,
  type HourGrid,
} from '#/features/onboarding/components/HourlyAvailabilityGrid';
import type { RootStackParamList } from '#/navigation/types';
import { ConfirmationModal } from '#/components/ConfirmationModal';
import RatingBadge from '#/components/RatingBadge';
import ReputationBadge from '#/components/ReputationBadge';
import HeroBadgeRow from '#/components/HeroBadgeRow';
import SportIcon from '#/components/SportIcon';
import ProfileCompletionChecklist from '#/features/profile/components/ProfileCompletionChecklist';

interface SportWithRating extends Sport {
  isActive: boolean;
  isPrimary: boolean;
  ratingLabel?: string;
}

// Hourly availability — see HourlyAvailabilityGrid for the data shape.
// The flat Set of `${day}-${hour}` cell keys flows end-to-end (state,
// overlay payload, save).
const MIN_AVAILABILITIES = 6;

const UserProfile = () => {
  const navigation = useAppNavigation();
  const { colors, isDark } = useThemeStyles();
  const { t, locale } = useTranslation();
  const bottomInset = useScrollBottomInset();
  const toast = useToast();
  const { profile, loading: profileLoading, refetch: refetchProfile } = useProfile();
  const {
    player,
    primaryRating,
    sportRatings,
    loading: playerLoading,
    refetch: refetchPlayer,
    reputationDisplay,
    reputationTotalEvents,
  } = usePlayer();
  const { userSports, refetch: refetchSportContext } = useSport();
  const { openSheetForInvitePlayers } = useActionsSheet();
  const loadingCore = profileLoading || playerLoading;

  const handleInviteQrPress = useCallback(() => {
    void lightHaptic();
    Analytics.referralInviteOpened({ source: 'profile_header' });
    openSheetForInvitePlayers();
  }, [openSheetForInvitePlayers]);

  // Profile completeness
  const profileCompleteness = useProfileCompleteness();

  // Theme-aware skeleton colors (aligned with FacilitiesDirectory for consistent, sleek loading UI)
  const skeletonBg = isDark ? neutral[800] : '#E1E9EE';
  const skeletonHighlight = isDark ? neutral[700] : '#F2F8FC';

  const [uploadingImage, setUploadingImage] = useState(false);
  const [allSports, setAllSports] = useState<Sport[]>([]);
  const [loadingAllSports, setLoadingAllSports] = useState(true);
  const [availabilities, setAvailabilities] = useState<HourGrid>(emptyGrid());
  // Most-recent last_confirmed_at across the player's rows — drives the
  // staleness banner in the edit overlay.
  const [availabilityLastConfirmedAt, setAvailabilityLastConfirmedAt] = useState<string | null>(
    null
  );
  const [loadingAvailabilities, setLoadingAvailabilities] = useState(true);

  // Auto-open the availability edit overlay when arriving via the Home
  // "refresh your availability" banner (or any future caller passing
  // `openSheet: 'availability'`). Waits for the availability rows to load so
  // the overlay opens with the player's actual schedule prefilled; fires
  // exactly once per navigation so backgrounding/foregrounding doesn't
  // re-open it.
  const route = useRoute<RouteProp<RootStackParamList, 'UserProfile'>>();
  const shouldAutoOpenAvailabilitySheet = route.params?.openSheet === 'availability';
  const autoOpenedAvailabilitySheetRef = useRef(false);
  const [reactivateConfirm, setReactivateConfirm] = useState<{
    visible: boolean;
    sport: SportWithRating | null;
    recordId: string | null;
  }>({ visible: false, sport: null, recordId: null });

  // Derive sport cards from shared contexts (updated automatically by SportProfile)
  const sports: SportWithRating[] = useMemo(() => {
    if (allSports.length === 0) return [];
    const activeIds = new Set(userSports.map(s => s.id));
    return allSports.map(sport => ({
      ...sport,
      isActive: activeIds.has(sport.id),
      isPrimary: false, // Not displayed in sport cards
      ratingLabel: sportRatings[sport.id]?.label,
    }));
  }, [allSports, userSports, sportRatings]);

  // Profile screen tour - triggers after main navigation tour is completed
  useTourSequence({
    screenId: 'profile',
    isReady: !loadingCore,
    delay: 800,
    autoStart: true,
  });

  // Use custom hook for image picker (for profile picture editing)
  const { image: newProfileImage, openPicker } = useImagePicker({
    title: t('profile.profilePicture'),
    cameraLabel: t('profile.takePhoto'),
    galleryLabel: t('profile.chooseFromGallery'),
  });

  // Sport activation setup hook (first-time activation flow)
  const { startSetup, isSettingUp } = useSportSetup({
    userId: player?.id || '',
    onComplete: (sportId, sportName) => {
      navigation.navigate('SportProfile', {
        sportId,
        sportName: sportName as 'tennis' | 'pickleball',
      });
    },
    onCancel: () => {
      // Sport setup was cancelled — nothing extra needed
    },
  });

  // Handle sport card press — activation logic for inactive sports
  const handleSportCardPress = useCallback(
    async (sport: SportWithRating) => {
      if (sport.isActive) {
        // Active sport — navigate to SportProfile
        navigation.navigate('SportProfile', {
          sportId: sport.id,
          sportName: sport.name as 'tennis' | 'pickleball',
        });
        return;
      }

      // Inactive sport — attempt activation
      void mediumHaptic();

      if (!player?.id) {
        Alert.alert(t('alerts.error'), t('errors.userNotAuthenticated'));
        return;
      }

      try {
        // Check if a player_sport record exists (previously active but deactivated)
        const { data: existingRecord, error } = await withTimeout(
          (async () =>
            supabase
              .from('player_sport')
              .select('id, is_active')
              .eq('player_id', player.id)
              .eq('sport_id', sport.id)
              .maybeSingle())(),
          10000,
          'Failed to check sport status - connection timeout'
        );

        if (error) throw error;

        if (existingRecord) {
          // Previously active — ask for confirmation before reactivating
          setReactivateConfirm({ visible: true, sport, recordId: existingRecord.id });
        } else {
          // Never activated — start mandatory setup flow
          startSetup(sport.id, sport.name as 'tennis' | 'pickleball');
        }
      } catch (err) {
        Logger.error('Failed to activate sport', err as Error, { sportId: sport.id });
        toast.error(getNetworkErrorMessage(err));
      }
    },
    [player?.id, navigation, startSetup, refetchSportContext, refetchPlayer, toast, t]
  );

  // Confirm reactivation of a previously active sport
  const [reactivating, setReactivating] = useState(false);
  const handleConfirmReactivate = useCallback(async () => {
    const { sport, recordId } = reactivateConfirm;
    if (!sport || !recordId) return;

    try {
      setReactivating(true);
      const updateResult = await withTimeout(
        (async () =>
          supabase.from('player_sport').update({ is_active: true }).eq('id', recordId))(),
        10000,
        'Failed to activate sport - connection timeout'
      );

      if (updateResult.error) throw updateResult.error;

      await refetchSportContext();
      await refetchPlayer();
      toast.success(t('alerts.sportActivated', { sport: sport.display_name }));
      setReactivateConfirm({ visible: false, sport: null, recordId: null });
      navigation.navigate('SportProfile', {
        sportId: sport.id,
        sportName: sport.name as 'tennis' | 'pickleball',
      });
    } catch (err) {
      Logger.error('Failed to reactivate sport', err as Error, { sportId: sport.id });
      toast.error(getNetworkErrorMessage(err));
    } finally {
      setReactivating(false);
    }
  }, [reactivateConfirm, refetchSportContext, refetchPlayer, toast, t, navigation]);

  // Check authentication on mount and fetch section data once. Profile/player come from
  // context (fetched by providers). Sports active/rating state comes from shared contexts
  // (SportContext + PlayerContext) which SportProfile updates after changes.
  useEffect(() => {
    const checkAuth = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        // User is not authenticated, go back
        toast.error(t('errors.unauthorized'));
        navigation.goBack();
        return;
      }
      fetchProfileSections();
    };
    checkAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh completeness when returning from SportProfile (e.g. after
  // editing favorite facilities, rating, or play style). The first focus is
  // skipped: ProfileCompletenessProvider already fetches on mount, so
  // refetching here doubled 4 Supabase queries on every screen open.
  const hasFocusedOnceRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!hasFocusedOnceRef.current) {
        hasFocusedOnceRef.current = true;
        return;
      }
      profileCompleteness.refetch();
    }, [profileCompleteness.refetch])
  );

  // Upload profile picture when a new image is selected
  useEffect(() => {
    if (newProfileImage && profile?.id) {
      uploadProfilePicture(newProfileImage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newProfileImage]);

  const uploadProfilePicture = async (imageUri: string) => {
    try {
      setUploadingImage(true);

      // Get current user
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        toast.error(t('errors.unauthorized'));
        return;
      }

      // Upload new image and delete the old one (if exists) using replaceImage
      const oldImageUrl = profile?.profile_picture_url;
      const { url, error: uploadError } = await replaceImage(
        imageUri,
        oldImageUrl,
        'profile-pictures',
        user.id
      );

      if (uploadError) throw uploadError;
      if (!url) throw new Error('Failed to get upload URL');

      // Update profile with new picture URL
      const updateResult = await withTimeout(
        (async () =>
          supabase.from('profile').update({ profile_picture_url: url }).eq('id', user.id))(),
        10000,
        'Failed to update profile - connection timeout'
      );

      if (updateResult.error) throw updateResult.error;

      toast.success(t('profile.profilePictureUpdated'));

      // Refresh profile context so completeness checklist updates
      refetchProfile();
    } catch (error) {
      Logger.error('Failed to upload profile picture', error as Error, { userId: profile?.id });
      toast.error(getNetworkErrorMessage(error));
    } finally {
      setUploadingImage(false);
    }
  };

  // Refresh just the availability set (used after the overlay saves so we
  // don't re-fetch the whole profile). Populates the hour grid one cell per
  // active row and tracks the freshest last_confirmed_at for the stale UI.
  const refetchAvailabilities = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    try {
      setLoadingAvailabilities(true);
      const availResult = await withTimeout(
        (async () =>
          supabase
            .from('player_availability')
            .select('day, hour_of_day, is_active, last_confirmed_at')
            .eq('player_id', user.id)
            .eq('is_active', true))(),
        15000,
        'Failed to load availability - connection timeout'
      );
      if (availResult.error && availResult.error.code !== 'PGRST116') {
        throw availResult.error;
      }
      const availData = availResult.data;
      const grid: Set<string> = new Set();
      let mostRecentConfirmedAt: string | null = null;
      (availData || []).forEach(avail => {
        grid.add(cellKey(avail.day, avail.hour_of_day as number));
        if (
          avail.last_confirmed_at &&
          (!mostRecentConfirmedAt || avail.last_confirmed_at > mostRecentConfirmedAt)
        ) {
          mostRecentConfirmedAt = avail.last_confirmed_at;
        }
      });
      setAvailabilities(grid);
      setAvailabilityLastConfirmedAt(mostRecentConfirmedAt);
    } catch (error) {
      Logger.error('Failed to fetch availabilities', error as Error);
      toast.error(getNetworkErrorMessage(error));
    } finally {
      setLoadingAvailabilities(false);
    }
  };

  const fetchProfileSections = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    setLoadingAllSports(true);
    setLoadingAvailabilities(true);

    // Fetch all sports (static data). Active/rating status is derived from shared contexts.
    const fetchSports = async () => {
      try {
        const sportsResult = await withTimeout(
          (async () => supabase.from('sport').select('*').eq('is_active', true).order('name'))(),
          15000,
          'Failed to load sports - connection timeout'
        );
        if (sportsResult.error) throw sportsResult.error;
        setAllSports(sportsResult.data || []);
      } catch (error) {
        Logger.error('Failed to fetch sports', error as Error);
        toast.error(getNetworkErrorMessage(error));
      } finally {
        setLoadingAllSports(false);
      }
    };

    // Availabilities — hourly rows straight into the cell-key Set.
    const fetchAvailabilities = async () => {
      try {
        const availResult = await withTimeout(
          (async () =>
            supabase
              .from('player_availability')
              .select('day, hour_of_day, is_active, last_confirmed_at')
              .eq('player_id', user.id)
              .eq('is_active', true))(),
          15000,
          'Failed to load availability - connection timeout'
        );
        if (availResult.error && availResult.error.code !== 'PGRST116') {
          throw availResult.error;
        }
        const availData = availResult.data;
        const grid: Set<string> = new Set();
        let mostRecentConfirmedAt: string | null = null;
        (availData || []).forEach(avail => {
          grid.add(cellKey(avail.day, avail.hour_of_day as number));
          if (
            avail.last_confirmed_at &&
            (!mostRecentConfirmedAt || avail.last_confirmed_at > mostRecentConfirmedAt)
          ) {
            mostRecentConfirmedAt = avail.last_confirmed_at;
          }
        });
        setAvailabilities(grid);
        setAvailabilityLastConfirmedAt(mostRecentConfirmedAt);
      } catch (error) {
        Logger.error('Failed to fetch availabilities', error as Error);
        toast.error(getNetworkErrorMessage(error));
      } finally {
        setLoadingAvailabilities(false);
      }
    };

    await Promise.all([fetchSports(), fetchAvailabilities()]);
  };

  // Persist the hour grid returned by the overlay. Every save is routed
  // through OnboardingService.saveAvailability, which diff-syncs the
  // requested cells and stamps last_confirmed_at on every row touched
  // (including no-op "refresh only" re-saves from the weekly prompt).
  const handleSaveAvailabilities = async (grid: HourGrid) => {
    if (grid.size < MIN_AVAILABILITIES) {
      toast.error(t('alerts.minAvailabilitiesRequired'));
      return;
    }

    try {
      const availabilityData = Array.from(grid).map(key => {
        const sepIdx = key.lastIndexOf('-');
        const day = key.slice(0, sepIdx) as DayEnum;
        const hour = Number(key.slice(sepIdx + 1));
        return { day, hour_of_day: hour, is_active: true };
      });

      const { error: saveError } = await OnboardingService.saveAvailability(availabilityData);
      if (saveError) throw new Error(saveError.message);

      // Adopt the saved grid into local state (no extra fetch) and refresh
      // the staleness signal — saveAvailability set last_confirmed_at = NOW().
      setAvailabilities(new Set(grid));
      setAvailabilityLastConfirmedAt(new Date().toISOString());

      SheetManager.hide('player-availabilities');
      toast.success(t('alerts.availabilitiesUpdated'));
      profileCompleteness.refetch();
    } catch (error) {
      Logger.error('Failed to save availabilities', error as Error, { playerId: player?.id });
      toast.error(getNetworkErrorMessage(error));
    }
  };

  // Auto-open the availability edit overlay when navigation arrives with
  // `openSheet: 'availability'`. Waits for the availability rows to load so
  // the overlay opens prefilled, and guards against re-firing on rerenders.
  useEffect(() => {
    if (!shouldAutoOpenAvailabilitySheet) return;
    if (loadingAvailabilities) return;
    if (autoOpenedAvailabilitySheetRef.current) return;
    autoOpenedAvailabilitySheetRef.current = true;
    SheetManager.show('player-availabilities', {
      payload: {
        mode: 'edit',
        initialData: availabilities,
        initialLastConfirmedAt: availabilityLastConfirmedAt,
        onSave: handleSaveAvailabilities,
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldAutoOpenAvailabilitySheet, loadingAvailabilities]);

  // Handle completeness checklist item actions
  const handleCompletenessAction = useCallback(
    (item: CompletenessItem) => {
      void lightHaptic();
      if (item.actionType === 'image_picker') {
        openPicker();
        return;
      }
      if (item.actionType === 'navigate' && item.actionNavigate) {
        (navigation.navigate as (...args: unknown[]) => void)(
          item.actionNavigate,
          item.actionPayload
        );
        return;
      }
      if (item.actionType === 'sheet' && item.actionSheet) {
        const sheet = item.actionSheet;
        if (sheet === 'personal-information') {
          SheetManager.show('personal-information', {
            payload: {
              mode: 'edit',
              initialData: {
                firstName: profile?.first_name || '',
                lastName: profile?.last_name || '',
                email: profile?.email || '',
                dateOfBirth: profile?.birth_date || '',
                gender: player?.gender || '',
                phoneNumber: profile?.phone || '',
                profilePictureUrl: profile?.profile_picture_url || undefined,
              },
              onSave: () => {
                refetchProfile();
                refetchPlayer();
              },
            },
          });
        } else if (sheet === 'player-information') {
          SheetManager.show('player-information', {
            payload: {
              initialData: {
                bio: profile?.bio || '',
                preferredPlayingHand: player?.playing_hand || '',
                maximumTravelDistance: player?.max_travel_distance || 15,
              },
              onSave: () => {
                refetchProfile();
                refetchPlayer();
              },
            },
          });
        } else if (sheet === 'player-location') {
          SheetManager.show('player-location', {
            payload: {
              initialData: {
                postalCode: player?.postal_code || '',
                address: player?.address || '',
                city: player?.city || '',
                province: player?.province || '',
                latitude: player?.latitude,
                longitude: player?.longitude,
              },
              onSave: () => {
                refetchPlayer();
              },
            },
          });
        } else if (sheet === 'player-availabilities') {
          SheetManager.show('player-availabilities', {
            payload: {
              mode: 'edit',
              initialData: availabilities,
              onSave: handleSaveAvailabilities,
            },
          });
        } else {
          // Rating or preferences sheets (sport-specific)
          SheetManager.show(sheet);
        }
      }
    },
    [
      profile,
      player,
      navigation,
      openPicker,
      refetchProfile,
      refetchPlayer,
      availabilities,
      handleSaveAvailabilities,
    ]
  );

  const formatDate = (dateString: string | null): string => {
    if (!dateString) return t('profile.notSet');
    return formatDateUtil(dateString, locale);
  };

  const formatJoinedDate = (dateString: string | null): string => {
    if (!dateString) return '';
    return formatDateMonthYear(dateString, locale);
  };

  const formatGender = (gender: string | null): string => {
    if (!gender) return t('profile.notSet');
    return t(`profile.genderValues.${gender}` as TranslationKey) || gender;
  };

  const formatPlayingHand = (hand: string | null): string => {
    if (!hand) return t('profile.notSet');
    const handMap: { [key: string]: string } = {
      left: t('profile.hand.left'),
      right: t('profile.hand.right'),
      both: t('profile.hand.both'),
    };
    return handMap[hand] || hand;
  };

  // Bottom inset goes in the ScrollView's contentContainerStyle, not on the
  // wrapper, so content scrolls under the home indicator instead of stopping
  // above it.
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={[]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={{ paddingBottom: bottomInset }}
        showsVerticalScrollIndicator={false}
      >
        {/* Profile Picture with Edit Overlay - Wrapped with CopilotStep for tour */}
        <CopilotStep
          text={t('tour.profileScreen.picture.description')}
          order={20}
          name="profile_picture"
        >
          <WalkthroughableView
            style={[
              styles.profileHeader,
              {
                backgroundColor: isDark ? primary[950] : primary[50],
                borderColor: isDark ? `${primary[400]}40` : `${primary[500]}20`,
              },
            ]}
          >
            {loadingCore ? (
              <View style={styles.profileTopRow}>
                <SkeletonAvatar
                  size={spacingPixels[20]}
                  backgroundColor={skeletonBg}
                  highlightColor={skeletonHighlight}
                />
                <View style={styles.profileIdentity}>
                  <Skeleton
                    width={150}
                    height={18}
                    backgroundColor={skeletonBg}
                    highlightColor={skeletonHighlight}
                  />
                  <Skeleton
                    width={100}
                    height={14}
                    backgroundColor={skeletonBg}
                    highlightColor={skeletonHighlight}
                    style={{ marginTop: 8 }}
                  />
                </View>
              </View>
            ) : (
              <>
                <View style={styles.profileTopRow}>
                  <View style={styles.profilePicWrapper}>
                    <View
                      style={[
                        styles.profilePicContainer,
                        {
                          borderColor: isDark ? primary[400] : primary[500],
                          backgroundColor: colors.inputBackground,
                          shadowColor: isDark ? primary[400] : primary[500],
                        },
                      ]}
                    >
                      {profile?.profile_picture_url || newProfileImage ? (
                        <Image
                          source={{
                            uri:
                              newProfileImage ||
                              getProfilePictureUrl(profile?.profile_picture_url) ||
                              '',
                          }}
                          style={styles.profileImage}
                          resizeMode="cover"
                        />
                      ) : (
                        <Ionicons name="camera-outline" size={32} color={colors.primary} />
                      )}
                      {uploadingImage && (
                        <View style={styles.uploadingOverlay}>
                          <ActivityIndicator size="small" color="#FFFFFF" />
                        </View>
                      )}
                    </View>
                    {!uploadingImage && (
                      <TouchableOpacity
                        style={[styles.profilePicEditBadge, { backgroundColor: colors.primary }]}
                        onPress={() => {
                          void lightHaptic();
                          openPicker();
                        }}
                        activeOpacity={0.7}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons
                          name="camera-outline"
                          size={14}
                          color={colors.primaryForeground}
                        />
                      </TouchableOpacity>
                    )}
                  </View>
                  <View style={styles.profileIdentity}>
                    <Text style={[styles.profileName, { color: colors.text }]} numberOfLines={1}>
                      {getHumanName(profile, t('profile.user'))}
                    </Text>
                    <View style={styles.joinedContainer}>
                      <Ionicons name="calendar-outline" size={14} color={colors.textMuted} />
                      <Text style={[styles.joinedText, { color: colors.textMuted }]}>
                        {t('profile.joined')} {formatJoinedDate(player?.created_at || null)}
                      </Text>
                    </View>
                    <View style={styles.profileBadgesRow}>
                      <RatingBadge
                        ratingValue={primaryRating?.value}
                        ratingLabel={primaryRating?.label}
                        certificationStatus={primaryRating?.badge_status}
                        isDark={isDark}
                        isLoading={playerLoading}
                        onInfoPress={() =>
                          SheetManager.show('rating-explainer', {
                            payload: {
                              sportName:
                                primaryRating?.ratingSystemCode === 'dupr'
                                  ? 'pickleball'
                                  : 'tennis',
                            },
                          })
                        }
                      />
                      <ReputationBadge
                        reputationDisplay={reputationDisplay ?? undefined}
                        isDark={isDark}
                        isLoading={playerLoading}
                        onInfoPress={() => SheetManager.show('reputation-explainer')}
                      />
                    </View>
                  </View>
                  <TouchableOpacity
                    style={[
                      styles.inviteQrButton,
                      {
                        backgroundColor: isDark ? primary[900] : primary[100],
                        borderColor: isDark ? `${primary[400]}40` : `${primary[500]}30`,
                        shadowColor: isDark ? primary[400] : primary[500],
                      },
                    ]}
                    onPress={handleInviteQrPress}
                    activeOpacity={0.7}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel={t('actions.invitePlayers')}
                  >
                    <Ionicons
                      name="qr-code-outline"
                      size={18}
                      color={isDark ? primary[100] : primary[600]}
                    />
                  </TouchableOpacity>
                </View>

                <HeroBadgeRow
                  createdAt={player?.created_at}
                  onboardingCompleted={profile?.onboarding_completed}
                  reputationScore={reputationDisplay?.score}
                  certificationStatus={primaryRating?.badge_status}
                  totalEvents={reputationTotalEvents}
                  isDark={isDark}
                  onFoundingInfoPress={() => SheetManager.show('founding-member-explainer')}
                  onCovetedInfoPress={() => SheetManager.show('coveted-player-explainer')}
                />
              </>
            )}
          </WalkthroughableView>
        </CopilotStep>

        {/* Profile Completion Checklist */}
        {!loadingCore && (
          <ProfileCompletionChecklist
            percentage={profileCompleteness.percentage}
            tier={profileCompleteness.tier}
            items={profileCompleteness.applicableItems}
            isComplete={profileCompleteness.isComplete}
            loading={profileCompleteness.loading}
            onAction={handleCompletenessAction}
            colors={colors}
            isDark={isDark}
            t={t as (key: string, options?: Record<string, string | number | boolean>) => string}
          />
        )}

        {/* My Personal Information with Edit Icon */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>
              {t('profile.sections.personalInformation')}
            </Text>
            {!loadingCore && (
              <TouchableOpacity
                style={styles.editIconButton}
                onPress={() => {
                  SheetManager.show('personal-information', {
                    payload: {
                      mode: 'edit',
                      initialData: {
                        firstName: profile?.first_name || '',
                        lastName: profile?.last_name || '',
                        email: profile?.email || '',
                        dateOfBirth: profile?.birth_date || '',
                        gender: player?.gender || '',
                        phoneNumber: profile?.phone || '',
                        profilePictureUrl: profile?.profile_picture_url || undefined,
                      },
                      onSave: () => {
                        refetchProfile();
                        refetchPlayer();
                      },
                    },
                  });
                }}
              >
                <Ionicons name="create-outline" size={20} color={colors.primary} />
              </TouchableOpacity>
            )}
          </View>

          {loadingCore ? (
            <View
              style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Skeleton
                width={120}
                height={18}
                backgroundColor={skeletonBg}
                highlightColor={skeletonHighlight}
              />
              <View style={{ marginTop: 12, gap: 12 }}>
                <Skeleton
                  width="100%"
                  height={44}
                  borderRadius={8}
                  backgroundColor={skeletonBg}
                  highlightColor={skeletonHighlight}
                />
                <Skeleton
                  width="100%"
                  height={44}
                  borderRadius={8}
                  backgroundColor={skeletonBg}
                  highlightColor={skeletonHighlight}
                />
                <Skeleton
                  width="100%"
                  height={44}
                  borderRadius={8}
                  backgroundColor={skeletonBg}
                  highlightColor={skeletonHighlight}
                />
              </View>
            </View>
          ) : (
            <View
              style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <View style={styles.compactRow}>
                <Text style={[styles.label, { color: colors.textMuted }]}>
                  {t('profile.fields.firstName')}
                </Text>
                <Text style={[styles.value, { color: colors.text }]}>
                  {profile?.first_name || '-'}
                </Text>
              </View>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <View style={styles.compactRow}>
                <Text style={[styles.label, { color: colors.textMuted }]}>
                  {t('profile.fields.lastName')}
                </Text>
                <Text style={[styles.value, { color: colors.text }]}>
                  {profile?.last_name || '-'}
                </Text>
              </View>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <View style={styles.compactRow}>
                <Text style={[styles.label, { color: colors.textMuted }]}>
                  {t('profile.fields.email')}
                </Text>
                <Text style={[styles.value, { color: colors.text }]}>{profile?.email || '-'}</Text>
              </View>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <View style={styles.compactRow}>
                <Text style={[styles.label, { color: colors.textMuted }]}>
                  {t('profile.fields.phoneNumber')}
                </Text>
                <Text style={[styles.value, { color: colors.text }]}>{profile?.phone || '-'}</Text>
              </View>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <View style={styles.compactRow}>
                <Text style={[styles.label, { color: colors.textMuted }]}>
                  {t('profile.fields.dateOfBirth')}
                </Text>
                <Text style={[styles.value, { color: colors.text }]}>
                  {formatDate(profile?.birth_date || null)}
                </Text>
              </View>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <View style={styles.compactRow}>
                <Text style={[styles.label, { color: colors.textMuted }]}>
                  {t('profile.gender')}
                </Text>
                <Text style={[styles.value, { color: colors.text }]}>
                  {formatGender(player?.gender || null)}
                </Text>
              </View>
            </View>
          )}
        </View>

        {/* My Player Information with Edit Icon */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>
              {t('profile.sections.playerInformation')}
            </Text>
            {!loadingCore && (
              <TouchableOpacity
                style={styles.editIconButton}
                onPress={() => {
                  SheetManager.show('player-information', {
                    payload: {
                      initialData: {
                        bio: profile?.bio || '',
                        preferredPlayingHand: player?.playing_hand || '',
                        maximumTravelDistance: player?.max_travel_distance || 15,
                      },
                      onSave: () => {
                        refetchProfile();
                        refetchPlayer();
                      },
                    },
                  });
                }}
              >
                <Ionicons name="create-outline" size={20} color={colors.primary} />
              </TouchableOpacity>
            )}
          </View>

          {loadingCore ? (
            <View
              style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Skeleton
                width={80}
                height={14}
                backgroundColor={skeletonBg}
                highlightColor={skeletonHighlight}
              />
              <View style={{ marginTop: 8, gap: 8 }}>
                <Skeleton
                  width="100%"
                  height={48}
                  borderRadius={8}
                  backgroundColor={skeletonBg}
                  highlightColor={skeletonHighlight}
                />
                <View style={styles.horizontalFieldsContainer}>
                  <Skeleton
                    width="100%"
                    height={40}
                    borderRadius={8}
                    backgroundColor={skeletonBg}
                    highlightColor={skeletonHighlight}
                    style={{ flex: 1 }}
                  />
                  <Skeleton
                    width="100%"
                    height={40}
                    borderRadius={8}
                    backgroundColor={skeletonBg}
                    highlightColor={skeletonHighlight}
                    style={{ flex: 1 }}
                  />
                </View>
              </View>
            </View>
          ) : (
            <View
              style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              {/* Bio - Vertical Layout */}
              <View style={styles.verticalField}>
                <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>
                  {t('profile.bio')}
                </Text>
                <Text style={[styles.fieldValue, { color: colors.text }]}>
                  {profile?.bio || t('profile.status.noBio')}
                </Text>
              </View>

              {/* Playing Hand and Max Travel Distance - Side by Side */}
              <View style={styles.horizontalFieldsContainer}>
                <View style={styles.halfField}>
                  <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>
                    {t('profile.fields.playingHand')}
                  </Text>
                  <Text style={[styles.fieldValue, { color: colors.text }]}>
                    {formatPlayingHand(player?.playing_hand || null)}
                  </Text>
                </View>
                <View style={styles.halfField}>
                  <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>
                    {t('profile.fields.maxTravelDistance')}
                  </Text>
                  <Text style={[styles.fieldValue, { color: colors.text }]}>
                    {player?.max_travel_distance ? `${player.max_travel_distance} km` : '-'}
                  </Text>
                </View>
              </View>
            </View>
          )}
        </View>

        {/* My Location */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>
              {t('profile.sections.location')}
            </Text>
            {!loadingCore && (
              <TouchableOpacity
                style={styles.editIconButton}
                onPress={() => {
                  SheetManager.show('player-location', {
                    payload: {
                      initialData: {
                        postalCode: player?.postal_code || '',
                        address: player?.address || '',
                        city: player?.city || '',
                        province: player?.province || '',
                        latitude: player?.latitude,
                        longitude: player?.longitude,
                      },
                      onSave: () => {
                        refetchPlayer();
                      },
                    },
                  });
                }}
              >
                <Ionicons name="create-outline" size={20} color={colors.primary} />
              </TouchableOpacity>
            )}
          </View>

          {loadingCore ? (
            <View
              style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Skeleton
                width={80}
                height={14}
                backgroundColor={skeletonBg}
                highlightColor={skeletonHighlight}
              />
              <View style={{ marginTop: 8, gap: 8 }}>
                <Skeleton
                  width="100%"
                  height={40}
                  borderRadius={8}
                  backgroundColor={skeletonBg}
                  highlightColor={skeletonHighlight}
                />
                <Skeleton
                  width="100%"
                  height={40}
                  borderRadius={8}
                  backgroundColor={skeletonBg}
                  highlightColor={skeletonHighlight}
                />
                <View style={styles.horizontalFieldsContainer}>
                  <Skeleton
                    width="100%"
                    height={40}
                    borderRadius={8}
                    backgroundColor={skeletonBg}
                    highlightColor={skeletonHighlight}
                    style={{ flex: 1 }}
                  />
                  <Skeleton
                    width="100%"
                    height={40}
                    borderRadius={8}
                    backgroundColor={skeletonBg}
                    highlightColor={skeletonHighlight}
                    style={{ flex: 1 }}
                  />
                </View>
              </View>
            </View>
          ) : (
            <View
              style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              {player?.address ? (
                <View style={styles.compactRow}>
                  <Text style={[styles.label, { color: colors.textMuted }]}>
                    {t('profile.fields.address')}
                  </Text>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.value, { color: colors.text }]} numberOfLines={1}>
                      {[player.address.split(',')[0].trim(), player?.city]
                        .filter(Boolean)
                        .join(', ')}
                    </Text>
                    {(player?.province || player?.postal_code) && (
                      <Text style={[styles.value, { color: colors.textMuted }]} numberOfLines={1}>
                        {[player?.province, player?.postal_code, 'Canada']
                          .filter(Boolean)
                          .join(', ')}
                      </Text>
                    )}
                  </View>
                </View>
              ) : (
                <View style={styles.compactRow}>
                  <Text style={[styles.label, { color: colors.textMuted }]}>
                    {t('profile.fields.postalCode')}
                  </Text>
                  <Text style={[styles.value, { color: colors.text }]}>
                    {player?.postal_code || '-'}
                  </Text>
                </View>
              )}
            </View>
          )}
        </View>

        {/* My Sports - Horizontal Cards with Chevrons - Wrapped with CopilotStep */}
        <CopilotStep
          text={t('tour.profileScreen.sports.description')}
          order={21}
          name="profile_sports"
        >
          <WalkthroughableView style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>
                {t('profile.sections.sports')}
              </Text>
            </View>

            {loadingAllSports ? (
              <View style={styles.sportsCardsContainer}>
                {[1, 2].map(i => (
                  <View
                    key={i}
                    style={[
                      styles.sportCard,
                      { backgroundColor: colors.card, borderColor: colors.border },
                    ]}
                  >
                    <Skeleton
                      width={80}
                      height={18}
                      backgroundColor={skeletonBg}
                      highlightColor={skeletonHighlight}
                    />
                    <Skeleton
                      width={60}
                      height={20}
                      borderRadius={radiusPixels.xl}
                      backgroundColor={skeletonBg}
                      highlightColor={skeletonHighlight}
                      style={{ marginTop: 8 }}
                    />
                  </View>
                ))}
              </View>
            ) : (
              <View style={styles.sportsCardsContainer}>
                {sports.map(sport => (
                  <TouchableOpacity
                    key={sport.id}
                    style={[
                      styles.sportCard,
                      {
                        backgroundColor: sport.isActive ? colors.card : colors.inputBackground,
                        borderColor: colors.border,
                      },
                      !sport.isActive && styles.sportCardInactive,
                    ]}
                    activeOpacity={0.7}
                    disabled={isSettingUp}
                    onPress={() => handleSportCardPress(sport)}
                  >
                    <View style={styles.sportCardLeft}>
                      <SportIcon
                        sportName={sport.display_name}
                        size={20}
                        color={sport.isActive ? colors.text : colors.textMuted}
                      />
                      <Text
                        style={[
                          styles.sportName,
                          {
                            color: sport.isActive ? colors.text : colors.textMuted,
                          },
                        ]}
                      >
                        {sport.display_name}
                      </Text>
                      {sport.isActive ? (
                        <>
                          <View
                            style={[
                              styles.activeBadge,
                              { backgroundColor: isDark ? primary[900] : primary[100] },
                            ]}
                          >
                            <Text
                              style={[
                                styles.activeBadgeText,
                                { color: isDark ? primary[100] : primary[600] },
                              ]}
                            >
                              {t('profile.status.active')}
                            </Text>
                          </View>
                          {sport.ratingLabel && (
                            <View
                              style={[
                                styles.ratingBadge,
                                { backgroundColor: isDark ? primary[900] : primary[100] },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.ratingBadgeText,
                                  { color: isDark ? primary[100] : primary[600] },
                                ]}
                              >
                                {sport.ratingLabel}
                              </Text>
                            </View>
                          )}
                        </>
                      ) : (
                        <View style={styles.inactiveBadge}>
                          <Text style={[styles.tapToActivateText, { color: colors.textMuted }]}>
                            {t('profile.sport.tapToActivate')}
                          </Text>
                        </View>
                      )}
                    </View>
                    {sport.isActive ? (
                      <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                    ) : (
                      <Ionicons name="add-circle-outline" size={22} color={colors.primary} />
                    )}
                  </TouchableOpacity>
                ))}
                {sports.length === 0 && (
                  <Text style={[styles.noDataText, { color: colors.textMuted }]}>
                    {t('profile.status.noSports')}
                  </Text>
                )}
              </View>
            )}
          </WalkthroughableView>
        </CopilotStep>

        {/* My Availabilities with Edit Icon - Wrapped with CopilotStep */}
        <CopilotStep
          text={t('tour.profileScreen.availability.description')}
          order={22}
          name="profile_availability"
        >
          <WalkthroughableView style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>
                {t('profile.sections.availabilities')}
              </Text>
              {!loadingAvailabilities && (
                <TouchableOpacity
                  style={styles.editIconButton}
                  onPress={() => {
                    SheetManager.show('player-availabilities', {
                      payload: {
                        mode: 'edit',
                        initialData: availabilities,
                        initialLastConfirmedAt: availabilityLastConfirmedAt,
                        onSave: handleSaveAvailabilities,
                      },
                    });
                  }}
                >
                  <Ionicons name="create-outline" size={20} color={colors.primary} />
                </TouchableOpacity>
              )}
            </View>

            {loadingAvailabilities ? (
              <View
                style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <Skeleton
                  width="100%"
                  height={520}
                  borderRadius={radiusPixels.md}
                  backgroundColor={skeletonBg}
                  highlightColor={skeletonHighlight}
                />
              </View>
            ) : (
              // Read-only preview of the player's hourly grid. Wrapped in a
              // TouchableOpacity that opens the edit overlay — the grid
              // itself swallows pointer events so the tap goes to the wrapper.
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => {
                  SheetManager.show('player-availabilities', {
                    payload: {
                      mode: 'edit',
                      initialData: availabilities,
                      initialLastConfirmedAt: availabilityLastConfirmedAt,
                      onSave: handleSaveAvailabilities,
                    },
                  });
                }}
              >
                <View
                  pointerEvents="none"
                  style={[
                    styles.card,
                    { backgroundColor: colors.card, borderColor: colors.border },
                  ]}
                >
                  <HourlyAvailabilityGrid
                    value={availabilities}
                    // No-op: the wrapper intercepts taps and opens the edit overlay.
                    onChange={() => {}}
                    colors={{
                      text: colors.text,
                      textSecondary: colors.textSecondary,
                      textMuted: colors.textMuted,
                      border: colors.inputBorder,
                      cellInactive: colors.inputBackground,
                      cellActive: colors.primary,
                    }}
                    t={t}
                    locale={locale}
                  />
                </View>
              </TouchableOpacity>
            )}
          </WalkthroughableView>
        </CopilotStep>
      </ScrollView>

      {/* Reactivate sport confirmation */}
      <ConfirmationModal
        visible={reactivateConfirm.visible}
        onClose={() => setReactivateConfirm({ visible: false, sport: null, recordId: null })}
        onConfirm={handleConfirmReactivate}
        title={t('profile.sport.reactivateTitle')}
        message={t('profile.sport.reactivateMessage', {
          sport: reactivateConfirm.sport?.display_name ?? '',
        })}
        confirmLabel={t('profile.sport.reactivateConfirm')}
        cancelLabel={t('common.cancel')}
        isLoading={reactivating}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
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
  backButton: {
    padding: spacingPixels[1],
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: spacingPixels[3],
  },
  scrollView: {
    flex: 1,
  },
  headerTitle: {
    fontSize: fontSizePixels.lg,
    fontWeight: fontWeightNumeric.semibold,
  },
  profileHeader: {
    marginTop: spacingPixels[4],
    marginHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[5],
    paddingHorizontal: spacingPixels[4],
    borderRadius: radiusPixels.xl,
    borderWidth: 1,
  },
  profileTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[4],
  },
  profileIdentity: {
    flex: 1,
    minWidth: 0,
    gap: spacingPixels[1],
  },
  inviteQrButton: {
    alignSelf: 'flex-start',
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 2,
  },
  profilePicWrapper: {
    position: 'relative',
  },
  profilePicContainer: {
    width: spacingPixels[20],
    height: spacingPixels[20],
    borderRadius: radiusPixels.full,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  profilePicEditBadge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileImage: {
    width: spacingPixels[20],
    height: spacingPixels[20],
    borderRadius: radiusPixels.full,
  },
  profileName: {
    fontSize: fontSizePixels.xl,
    fontWeight: fontWeightNumeric.bold,
  },
  profileBadgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacingPixels[2],
  },
  joinedContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
  },
  joinedText: {
    fontSize: fontSizePixels.xs,
  },
  section: {
    marginTop: spacingPixels[5],
    paddingHorizontal: spacingPixels[4],
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacingPixels[3],
  },
  sectionTitle: {
    fontSize: fontSizePixels.xs,
    fontWeight: fontWeightNumeric.bold,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  editIconButton: {
    padding: spacingPixels[1],
  },
  card: {
    borderRadius: radiusPixels.xl,
    padding: spacingPixels[4],
    borderWidth: 1,
  },
  compactRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacingPixels[2.5],
  },
  label: {
    fontSize: fontSizePixels.sm,
    flexShrink: 0,
    marginRight: spacingPixels[3],
  },
  value: {
    fontSize: fontSizePixels.sm,
    fontWeight: fontWeightNumeric.medium,
    flex: 1,
    textAlign: 'right',
    minWidth: 0,
  },
  bioText: {
    textAlign: 'right',
  },
  divider: {
    height: 1,
  },
  // Vertical Field Layout (for Player Information)
  verticalField: {
    marginBottom: spacingPixels[4],
  },
  fieldLabel: {
    fontSize: fontSizePixels.xs,
    marginBottom: spacingPixels[1.5],
    fontWeight: fontWeightNumeric.medium,
  },
  fieldValue: {
    fontSize: fontSizePixels.base,
    lineHeight: fontSizePixels.base * 1.375,
  },
  // Horizontal Fields Container (for Playing Hand and Max Travel Distance side by side)
  horizontalFieldsContainer: {
    flexDirection: 'row',
    gap: spacingPixels[4],
  },
  halfField: {
    flex: 1,
  },
  noDataText: {
    fontSize: fontSizePixels.sm,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: spacingPixels[5],
  },
  // Sports Cards - Horizontal Layout
  sportsCardsContainer: {
    gap: spacingPixels[3],
  },
  sportCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radiusPixels.xl,
    padding: spacingPixels[4],
    minHeight: spacingPixels[14],
    borderWidth: 1,
  },
  sportCardInactive: {
    opacity: 0.7,
  },
  sportCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    flex: 1,
  },
  sportName: {
    fontSize: fontSizePixels.base,
    fontWeight: fontWeightNumeric.semibold,
  },
  sportNameInactive: {},
  activeBadge: {
    paddingHorizontal: spacingPixels[2.5],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.xl,
  },
  activeBadgeText: {
    fontSize: fontSizePixels.xs,
    fontWeight: fontWeightNumeric.semibold,
  },
  inactiveBadge: {
    paddingHorizontal: spacingPixels[2.5],
    paddingVertical: spacingPixels[1],
  },
  tapToActivateText: {
    fontSize: fontSizePixels.xs,
    fontWeight: fontWeightNumeric.medium,
  },
  ratingBadge: {
    paddingHorizontal: spacingPixels[2.5],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.xl,
  },
  ratingBadgeText: {
    fontSize: fontSizePixels.xs,
    fontWeight: fontWeightNumeric.semibold,
  },
  // Availability Grid Styles — kept in sync with AvailabilitiesStep and
  // PlayerAvailabilitiesOverlay so the read/write surfaces feel identical.
  gridContainer: {
    marginTop: spacingPixels[2],
  },
  gridRow: {
    flexDirection: 'row',
    marginBottom: spacingPixels[2],
    alignItems: 'center',
  },
  dayCell: {
    width: 96,
    paddingRight: spacingPixels[2],
    justifyContent: 'center',
  },
  headerCell: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacingPixels[1],
  },
  timeSlotCell: {
    flex: 1,
    height: 36,
    borderRadius: radiusPixels.md,
    marginHorizontal: spacingPixels[1] / 2,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  timeRangeText: {
    marginTop: 2,
    lineHeight: 14,
  },
  uploadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: spacingPixels[20],
    height: spacingPixels[20],
    borderRadius: radiusPixels.full,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
});

export default UserProfile;
