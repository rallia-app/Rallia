import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { SheetManager } from 'react-native-actions-sheet';
import { useAppNavigation } from '../navigation/hooks';
import { Text, Skeleton, SkeletonAvatar, useToast } from '@rallia/shared-components';
import { supabase, Logger } from '@rallia/shared-services';
import { useProfile, usePlayer, usePlayerReputation } from '@rallia/shared-hooks';
import { replaceImage } from '../services/imageUpload';
import {
  useImagePicker,
  useThemeStyles,
  useTranslation,
  useTourSequence,
  type TranslationKey,
} from '../hooks';
import { CopilotStep, WalkthroughableView } from '../context/TourContext';
import { withTimeout, getNetworkErrorMessage } from '../utils/networkTimeout';
import { getProfilePictureUrl } from '@rallia/shared-utils';
import { formatDate as formatDateUtil, formatDateMonthYear } from '../utils/dateFormatting';
import type { Sport } from '@rallia/shared-types';
import {
  spacingPixels,
  radiusPixels,
  fontSizePixels,
  fontWeightNumeric,
  primary,
  neutral,
  shadowsNative,
} from '@rallia/design-system';
import RatingBadge from '../components/RatingBadge';
import ReputationBadge from '../components/ReputationBadge';
import PortfolioSection, {
  type PortfolioProof,
  type PortfolioSport,
} from '../features/profile/PortfolioSection';

interface SportWithRating extends Sport {
  isActive: boolean;
  isPrimary: boolean;
  ratingLabel?: string;
}

type PeriodKey = 'morning' | 'afternoon' | 'evening';

interface DayPeriods {
  morning: boolean;
  afternoon: boolean;
  evening: boolean;
}

interface AvailabilityGrid {
  [key: string]: DayPeriods;
}

// Types matching PlayerAvailabilitiesOverlay's expectations
type TimeSlot = 'AM' | 'PM' | 'EVE';
type DayOfWeek = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';

interface DayAvailability {
  AM: boolean;
  PM: boolean;
  EVE: boolean;
}

type WeeklyAvailability = Record<DayOfWeek, DayAvailability>;

const UserProfile = () => {
  const navigation = useAppNavigation();
  const { colors, isDark } = useThemeStyles();
  const { t, locale } = useTranslation();
  const toast = useToast();
  const { profile, loading: profileLoading, refetch: refetchProfile } = useProfile();
  const { player, loading: playerLoading, refetch: refetchPlayer } = usePlayer();
  const { display: reputationDisplay } = usePlayerReputation(player?.id);
  const loadingCore = profileLoading || playerLoading;

  // Theme-aware skeleton colors (aligned with FacilitiesDirectory for consistent, sleek loading UI)
  const skeletonBg = isDark ? '#262626' : '#E1E9EE';
  const skeletonHighlight = isDark ? '#404040' : '#F2F8FC';

  const [uploadingImage, setUploadingImage] = useState(false);
  const [sports, setSports] = useState<SportWithRating[]>([]);
  const [availabilities, setAvailabilities] = useState<AvailabilityGrid>({});
  const [pendingReferenceRequestsCount, setPendingReferenceRequestsCount] = useState(0);
  const [portfolioProofs, setPortfolioProofs] = useState<PortfolioProof[]>([]);
  const [loadingSports, setLoadingSports] = useState(true);
  const [loadingAvailabilities, setLoadingAvailabilities] = useState(true);
  const [loadingReferenceRequests, setLoadingReferenceRequests] = useState(true);
  const [loadingPortfolio, setLoadingPortfolio] = useState(true);

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

  // Check authentication on mount and fetch section data once. Profile/player come from
  // context (fetched by providers). We only refetch after mutations (onSave in sheets, etc.).
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

      await refetchProfile();

      toast.success(t('profile.changePhoto'));
    } catch (error) {
      Logger.error('Failed to upload profile picture', error as Error, { userId: profile?.id });
      toast.error(getNetworkErrorMessage(error));
    } finally {
      setUploadingImage(false);
    }
  };

  const fetchProfileSections = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    setLoadingSports(true);
    setLoadingAvailabilities(true);
    setLoadingReferenceRequests(true);
    setLoadingPortfolio(true);

    // Sports: all sports + player_sport + ratings, then merge
    const fetchSports = async () => {
      try {
        const [sportsResult, playerSportsResult, ratingsResult] = await Promise.all([
          withTimeout(
            (async () => supabase.from('sport').select('*').eq('is_active', true).order('name'))(),
            15000,
            'Failed to load sports - connection timeout'
          ),
          withTimeout(
            (async () =>
              supabase
                .from('player_sport')
                .select('sport_id, is_primary, is_active')
                .eq('player_id', user.id))(),
            15000,
            'Failed to load player sports - connection timeout'
          ),
          withTimeout(
            (async () =>
              supabase
                .from('player_rating_score')
                .select(
                  `
                  *,
                  rating_score!player_rating_scores_rating_score_id_fkey (
                    label,
                    rating_system ( sport_id )
                  )
                `
                )
                .eq('player_id', user.id)
                .order('is_certified', { ascending: false })
                .order('created_at', { ascending: false }))(),
            15000,
            'Failed to load ratings - connection timeout'
          ),
        ]);
        if (sportsResult.error) throw sportsResult.error;
        if (playerSportsResult.error && playerSportsResult.error.code !== 'PGRST116') {
          throw playerSportsResult.error;
        }
        if (ratingsResult.error && ratingsResult.error.code !== 'PGRST116') {
          throw ratingsResult.error;
        }
        const allSports = sportsResult.data;
        const playerSports = playerSportsResult.data;
        const ratingsData = ratingsResult.data;
        const playerSportsMap = new Map(
          (playerSports || []).map(ps => [
            ps.sport_id,
            { isPrimary: ps.is_primary || false, isActive: ps.is_active || false },
          ])
        );
        const ratingsMap = new Map<string, string>();
        (ratingsData || []).forEach(rating => {
          const ratingScore = rating.rating_score as {
            label?: string;
            rating_system?: { sport_id?: string };
          } | null;
          const sportId = ratingScore?.rating_system?.sport_id;
          const displayLabel = ratingScore?.label || '';
          if (sportId && !ratingsMap.has(sportId)) ratingsMap.set(sportId, displayLabel);
        });
        const sportsWithStatus: SportWithRating[] = (allSports || []).map(sport => {
          const sportInfo = playerSportsMap.get(sport.id);
          return {
            ...sport,
            isActive: sportInfo?.isActive || false,
            isPrimary: sportInfo?.isPrimary || false,
            ratingLabel: ratingsMap.get(sport.id),
          };
        });
        setSports(sportsWithStatus);
      } catch (error) {
        Logger.error('Failed to fetch sports', error as Error);
        toast.error(getNetworkErrorMessage(error));
      } finally {
        setLoadingSports(false);
      }
    };

    // Availabilities
    const fetchAvailabilities = async () => {
      try {
        const availResult = await withTimeout(
          (async () =>
            supabase
              .from('player_availability')
              .select('day, period, is_active')
              .eq('player_id', user.id)
              .eq('is_active', true))(),
          15000,
          'Failed to load availability - connection timeout'
        );
        if (availResult.error && availResult.error.code !== 'PGRST116') {
          throw availResult.error;
        }
        const availData = availResult.data;
        const availGrid: AvailabilityGrid = {
          monday: { morning: false, afternoon: false, evening: false },
          tuesday: { morning: false, afternoon: false, evening: false },
          wednesday: { morning: false, afternoon: false, evening: false },
          thursday: { morning: false, afternoon: false, evening: false },
          friday: { morning: false, afternoon: false, evening: false },
          saturday: { morning: false, afternoon: false, evening: false },
          sunday: { morning: false, afternoon: false, evening: false },
        };
        (availData || []).forEach(avail => {
          const day = avail.day as keyof AvailabilityGrid;
          const period = avail.period as keyof AvailabilityGrid[keyof AvailabilityGrid];
          if (availGrid[day] && period in availGrid[day]) {
            availGrid[day][period] = true;
          }
        });
        setAvailabilities(availGrid);
      } catch (error) {
        Logger.error('Failed to fetch availabilities', error as Error);
        toast.error(getNetworkErrorMessage(error));
      } finally {
        setLoadingAvailabilities(false);
      }
    };

    // Reference requests count
    const fetchReferenceRequests = async () => {
      try {
        Logger.info('Fetching reference requests count', { userId: user.id });
        const referenceRequestsResult = await withTimeout(
          (async () =>
            supabase
              .from('rating_reference_request')
              .select('id', { count: 'exact', head: true })
              .eq('referee_id', user.id)
              .eq('status', 'pending'))(),
          15000,
          'Failed to load reference requests - connection timeout'
        );

        Logger.info('Reference requests result', {
          count: referenceRequestsResult.count,
          error: referenceRequestsResult.error?.message,
          userId: user.id,
        });

        if (!referenceRequestsResult.error) {
          setPendingReferenceRequestsCount(referenceRequestsResult.count || 0);
        } else {
          Logger.error('Reference requests query error', referenceRequestsResult.error);
        }
      } catch (error) {
        Logger.error('Failed to fetch reference requests', error as Error);
        toast.error(getNetworkErrorMessage(error));
      } finally {
        setLoadingReferenceRequests(false);
      }
    };

    // Portfolio - all rating proofs across all sports
    const fetchPortfolio = async () => {
      try {
        // First get all player_rating_scores for this user
        const ratingsResult = await withTimeout(
          (async () =>
            supabase
              .from('player_rating_score')
              .select(
                `
                id,
                rating_score!player_rating_scores_rating_score_id_fkey (
                  rating_system (
                    sport:sport_id (
                      id,
                      display_name
                    )
                  )
                )
              `
              )
              .eq('player_id', user.id))(),
          15000,
          'Failed to load ratings for portfolio'
        );

        if (ratingsResult.error) throw ratingsResult.error;

        const ratingIds = (ratingsResult.data || []).map(r => r.id);

        if (ratingIds.length === 0) {
          setPortfolioProofs([]);
          return;
        }

        // Create maps of rating_score_id to sport name and sport id
        const sportNameMap = new Map<string, string>();
        const sportIdMap = new Map<string, string>();
        (ratingsResult.data || []).forEach(rating => {
          const ratingScore = rating.rating_score as {
            rating_system?: {
              sport?: { id?: string; display_name?: string };
            };
          } | null;
          const sport = ratingScore?.rating_system?.sport;
          if (sport?.display_name) {
            sportNameMap.set(rating.id, sport.display_name);
          }
          if (sport?.id) {
            sportIdMap.set(rating.id, sport.id);
          }
        });

        // Fetch all proofs for these ratings (exclude rejected)
        const proofsResult = await withTimeout(
          (async () =>
            supabase
              .from('rating_proof')
              .select(
                `
                *,
                file:file(*)
              `
              )
              .in('player_rating_score_id', ratingIds)
              .eq('is_active', true)
              .neq('status', 'rejected')
              .order('created_at', { ascending: false }))(),
          15000,
          'Failed to load portfolio proofs'
        );

        if (proofsResult.error) throw proofsResult.error;

        // Map proofs with sport names and IDs
        const portfolioData = (proofsResult.data || []).map((item: Record<string, unknown>) => ({
          ...item,
          file: Array.isArray(item.file) && item.file.length > 0 ? item.file[0] : item.file,
          sport_name: sportNameMap.get(item.player_rating_score_id as string),
          sport_id: sportIdMap.get(item.player_rating_score_id as string),
        })) as PortfolioProof[];

        setPortfolioProofs(portfolioData);
      } catch (error) {
        Logger.error('Failed to fetch portfolio', error as Error);
        toast.error(getNetworkErrorMessage(error));
      } finally {
        setLoadingPortfolio(false);
      }
    };

    await Promise.all([
      fetchSports(),
      fetchAvailabilities(),
      fetchReferenceRequests(),
      fetchPortfolio(),
    ]);
  };

  // Convert DB format to UI format for the overlay
  const convertToUIFormat = (dbAvailabilities: AvailabilityGrid): WeeklyAvailability => {
    const dayMap: Record<string, DayOfWeek> = {
      monday: 'Mon',
      tuesday: 'Tue',
      wednesday: 'Wed',
      thursday: 'Thu',
      friday: 'Fri',
      saturday: 'Sat',
      sunday: 'Sun',
    };

    // Start with defaults for all days
    const defaultAvailability: DayAvailability = { AM: false, PM: false, EVE: false };
    const uiFormat: WeeklyAvailability = {
      Mon: { ...defaultAvailability },
      Tue: { ...defaultAvailability },
      Wed: { ...defaultAvailability },
      Thu: { ...defaultAvailability },
      Fri: { ...defaultAvailability },
      Sat: { ...defaultAvailability },
      Sun: { ...defaultAvailability },
    };

    // Override with actual data if available
    if (dbAvailabilities && Object.keys(dbAvailabilities).length > 0) {
      Object.keys(dbAvailabilities).forEach(day => {
        const uiDay = dayMap[day];
        const dayData = dbAvailabilities[day];
        if (uiDay && dayData) {
          uiFormat[uiDay] = {
            AM: dayData.morning ?? false,
            PM: dayData.afternoon ?? false,
            EVE: dayData.evening ?? false,
          };
        }
      });
    }

    return uiFormat;
  };

  // Handle saving availabilities from the overlay
  const handleSaveAvailabilities = async (
    uiAvailabilities: WeeklyAvailability,
    privacyShowAvailability: boolean
  ) => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        toast.error(t('errors.unauthorized'));
        return;
      }

      // Convert UI format back to DB format
      const dayMap: { [key: string]: string } = {
        Mon: 'monday',
        Tue: 'tuesday',
        Wed: 'wednesday',
        Thu: 'thursday',
        Fri: 'friday',
        Sat: 'saturday',
        Sun: 'sunday',
      };

      const timeMap: { [key: string]: string } = {
        AM: 'morning',
        PM: 'afternoon',
        EVE: 'evening',
      };

      // Get the user's primary sport to save availabilities for
      const primarySport = sports.find(s => s.isPrimary && s.isActive);
      if (!primarySport) {
        toast.error(t('errors.noPrimarySport'));
        return;
      }

      // Delete existing availabilities for this player
      const deleteResult = await withTimeout(
        (async () => supabase.from('player_availability').delete().eq('player_id', user.id))(),
        10000,
        'Failed to update availability - connection timeout'
      );

      if (deleteResult.error) throw deleteResult.error;

      // Prepare new availability data
      const availabilityData: Array<{
        player_id: string;
        day: string;
        period: string;
        is_active: boolean;
      }> = [];

      (Object.keys(uiAvailabilities) as DayOfWeek[]).forEach(day => {
        (Object.keys(uiAvailabilities[day]) as TimeSlot[]).forEach(slot => {
          if (uiAvailabilities[day][slot]) {
            availabilityData.push({
              player_id: user.id,
              day: dayMap[day],
              period: timeMap[slot],
              is_active: true,
            });
          }
        });
      });

      // Upsert new availabilities (handles duplicates gracefully)
      if (availabilityData.length > 0) {
        const insertResult = await withTimeout(
          (async () =>
            supabase.from('player_availability').upsert(availabilityData, {
              onConflict: 'player_id,day,period',
              ignoreDuplicates: false,
            }))(),
          10000,
          'Failed to save availability - connection timeout'
        );

        if (insertResult.error) throw insertResult.error;
      }

      // Save the privacy setting to the player table
      const privacyResult = await withTimeout(
        (async () =>
          supabase
            .from('player')
            .update({
              privacy_show_availability: privacyShowAvailability,
            })
            .eq('id', user.id))(),
        10000,
        'Failed to save privacy setting - connection timeout'
      );

      if (privacyResult.error) throw privacyResult.error;

      await fetchProfileSections();
      await refetchPlayer(); // Refresh player data to get updated privacy setting

      SheetManager.hide('player-availabilities');

      toast.success(t('alerts.availabilitiesUpdated'));
    } catch (error) {
      Logger.error('Failed to save availabilities', error as Error, { playerId: player?.id });
      toast.error(getNetworkErrorMessage(error));
    }
  };

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

  const getDayLabel = (day: string): string => {
    const key = `onboarding.availabilityStep.days.${day}` as TranslationKey;
    const translated = t(key);
    return translated !== key ? translated : day;
  };

  const getPeriodLabel = (period: PeriodKey): string => {
    const keyMap = {
      morning: 'onboarding.availabilityStep.am',
      afternoon: 'onboarding.availabilityStep.pm',
      evening: 'onboarding.availabilityStep.eve',
    } as const;
    return t(keyMap[period]);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={[]}>
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Profile Picture with Edit Overlay - Wrapped with CopilotStep for tour */}
        <CopilotStep
          text={t('tour.profileScreen.picture.description')}
          order={20}
          name="profile_picture"
        >
          <WalkthroughableView style={[styles.profileHeader, { backgroundColor: colors.card }]}>
            {loadingCore ? (
              <>
                <SkeletonAvatar
                  size={120}
                  backgroundColor={skeletonBg}
                  highlightColor={skeletonHighlight}
                />
                <View style={{ marginTop: 16, alignItems: 'center' }}>
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
              </>
            ) : (
              <>
                <View style={styles.profilePicWrapper}>
                  <TouchableOpacity
                    style={[
                      styles.profilePicContainer,
                      { borderColor: colors.primary, backgroundColor: colors.inputBackground },
                    ]}
                    activeOpacity={0.8}
                    onPress={openPicker}
                    disabled={uploadingImage}
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
                      />
                    ) : (
                      <Ionicons name="camera-outline" size={32} color={colors.primary} />
                    )}
                    {uploadingImage && (
                      <View style={styles.uploadingOverlay}>
                        <ActivityIndicator size="large" color={colors.primaryForeground} />
                        <Text style={[styles.uploadingText, { color: colors.primaryForeground }]}>
                          {t('profile.uploading')}
                        </Text>
                      </View>
                    )}
                  </TouchableOpacity>
                  {!uploadingImage && (
                    <View
                      style={[
                        styles.profilePicEditBadge,
                        { backgroundColor: colors.primary, borderColor: colors.card },
                      ]}
                    >
                      <Ionicons name="camera-outline" size={14} color={colors.primaryForeground} />
                    </View>
                  )}
                </View>
                <Text style={[styles.profilePicHint, { color: colors.textMuted }]}>
                  {t('profile.tapToChangePhoto')}
                </Text>

                {/* First and last name first, then username */}
                <Text style={[styles.profileName, { color: colors.text }]}>
                  {`${profile?.first_name || ''} ${profile?.last_name || ''}`.trim() ||
                    profile?.display_name ||
                    t('profile.user')}
                </Text>
                <Text style={[styles.username, { color: colors.textMuted }]}>
                  @{profile?.display_name?.replace(/\s/g, '') || t('profile.username')}
                </Text>

                {/* Joined Date */}
                <View style={styles.joinedContainer}>
                  <Ionicons name="calendar-outline" size={14} color={colors.textMuted} />
                  <Text style={[styles.joinedText, { color: colors.textMuted }]}>
                    {t('profile.joined')} {formatJoinedDate(player?.created_at || null)}
                  </Text>
                </View>

                {/* Rating & Reputation Badges */}
                <View style={styles.profileBadgesRow}>
                  <RatingBadge
                    ratingLabel={sports.find(s => s.isPrimary && s.isActive)?.ratingLabel}
                    isDark={isDark}
                  />
                  <ReputationBadge reputationDisplay={reputationDisplay} isDark={isDark} />
                </View>
              </>
            )}
          </WalkthroughableView>
        </CopilotStep>

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
                        username: profile?.display_name || '',
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
              style={[
                styles.card,
                styles.skeletonCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
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
            <View style={[styles.card, { backgroundColor: colors.card }]}>
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
                        username: profile?.display_name || '',
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
              style={[
                styles.card,
                styles.skeletonCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
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
            <View style={[styles.card, { backgroundColor: colors.card }]}>
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
              style={[
                styles.card,
                styles.skeletonCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
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
            <View style={[styles.card, { backgroundColor: colors.card }]}>
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

        {/* Portfolio - Gallery of all rating proofs */}
        <PortfolioSection
          proofs={portfolioProofs}
          sports={
            sports
              .filter(s => s.isActive)
              .map(s => ({ id: s.id, display_name: s.display_name })) as PortfolioSport[]
          }
          loading={loadingPortfolio}
          skeletonBg={skeletonBg}
          skeletonHighlight={skeletonHighlight}
        />

        {/* My Sports - Horizontal Cards with Chevrons - Wrapped with CopilotStep */}
        <CopilotStep
          text={t('tour.profileScreen.sports.description')}
          order={21}
          name="profile_sports"
        >
          <WalkthroughableView style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitleRow}>
                <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>
                  {t('profile.sections.sports')}
                </Text>
                {sports.filter(s => !s.isActive).length > 0 && (
                  <View style={styles.sportsHintInline}>
                    <Ionicons
                      name="information-circle-outline"
                      size={16}
                      color={colors.textMuted}
                    />
                    <Text style={[styles.sportsHintText, { color: colors.textMuted }]}>
                      {t('profile.sportsHint')}
                    </Text>
                  </View>
                )}
              </View>
            </View>

            {loadingSports ? (
              <View style={styles.sportsCardsContainer}>
                {[1, 2, 3].map(i => (
                  <View
                    key={i}
                    style={[
                      styles.sportCard,
                      styles.skeletonCard,
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
                      },
                      !sport.isActive && styles.sportCardInactive,
                    ]}
                    activeOpacity={0.7}
                    onPress={() => {
                      navigation.navigate('SportProfile', {
                        sportId: sport.id,
                        sportName: sport.display_name as 'tennis' | 'pickleball',
                      });
                    }}
                  >
                    <View style={styles.sportCardLeft}>
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
                      ) : (
                        <View
                          style={[
                            styles.inactiveBadge,
                            { backgroundColor: colors.inputBackground },
                          ]}
                        >
                          <Text style={[styles.inactiveBadgeText, { color: colors.textMuted }]}>
                            {t('profile.status.inactive')}
                          </Text>
                        </View>
                      )}
                      {sport.isActive && sport.ratingLabel && (
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
                    </View>
                    <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                  </TouchableOpacity>
                ))}
                {/* Add more sports card - shown when user has < 2 active sports and inactive sports exist */}
                {sports.filter(s => s.isActive).length < 2 &&
                  sports.filter(s => !s.isActive).length > 0 && (
                    <TouchableOpacity
                      style={[
                        styles.sportCard,
                        styles.addMoreSportsCard,
                        { backgroundColor: colors.inputBackground, borderColor: colors.border },
                      ]}
                      activeOpacity={0.7}
                      onPress={() => {
                        const firstInactiveSport = sports.find(s => !s.isActive);
                        if (firstInactiveSport) {
                          navigation.navigate('SportProfile', {
                            sportId: firstInactiveSport.id,
                            sportName: firstInactiveSport.display_name as 'tennis' | 'pickleball',
                          });
                        }
                      }}
                    >
                      <View style={styles.addMoreSportsContent}>
                        <Ionicons name="add-circle-outline" size={24} color={primary[500]} />
                        <View style={styles.addMoreSportsText}>
                          <Text style={[styles.addMoreSportsTitle, { color: colors.text }]}>
                            {t('profile.addMoreSports')}
                          </Text>
                          <Text style={[styles.addMoreSportsHint, { color: colors.textMuted }]}>
                            {t('profile.addMoreSportsHint')}
                          </Text>
                        </View>
                      </View>
                      <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                    </TouchableOpacity>
                  )}
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
                        initialData: convertToUIFormat(availabilities),
                        initialPrivacyShowAvailability: player?.privacy_show_availability ?? true,
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
                style={[
                  styles.card,
                  styles.skeletonCard,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <View style={styles.gridContainer}>
                  {[1, 2, 3, 4, 5, 6, 7].map(row => (
                    <View key={row} style={styles.gridRow}>
                      <Skeleton
                        width={40}
                        height={14}
                        backgroundColor={skeletonBg}
                        highlightColor={skeletonHighlight}
                      />
                      {[1, 2, 3].map(cell => (
                        <View key={cell} style={styles.timeSlotWrapper}>
                          <Skeleton
                            width="100%"
                            height={36}
                            borderRadius={radiusPixels.lg}
                            backgroundColor={skeletonBg}
                            highlightColor={skeletonHighlight}
                          />
                        </View>
                      ))}
                    </View>
                  ))}
                </View>
              </View>
            ) : (
              <View style={[styles.card, { backgroundColor: colors.card }]}>
                {/* Availability Grid - Same as PlayerAvailabilitiesOverlay */}
                <View style={styles.gridContainer}>
                  {/* Header Row */}
                  <View style={styles.gridRow}>
                    <View style={styles.dayCell} />
                    {['AM', 'PM', 'EVE'].map(slot => (
                      <View key={slot} style={styles.headerCell}>
                        <Text size="xs" weight="semibold" color={colors.textMuted}>
                          {slot}
                        </Text>
                      </View>
                    ))}
                  </View>

                  {/* Day Rows */}
                  {Object.keys(availabilities).map(day => (
                    <View key={day} style={styles.gridRow}>
                      <View style={styles.dayCell}>
                        <Text size="sm" weight="medium" color={colors.text}>
                          {getDayLabel(day)}
                        </Text>
                      </View>
                      {(['morning', 'afternoon', 'evening'] as PeriodKey[]).map(period => (
                        <View key={period} style={styles.timeSlotWrapper}>
                          <View
                            style={[
                              styles.timeSlotCell,
                              {
                                backgroundColor: colors.inputBackground,
                              },
                              availabilities[day]?.[period] && [
                                styles.timeSlotCellSelected,
                                { backgroundColor: colors.primary, borderColor: colors.primary },
                              ],
                            ]}
                          >
                            <Text
                              size="xs"
                              weight="semibold"
                              color={
                                availabilities[day]?.[period]
                                  ? colors.primaryForeground
                                  : colors.textMuted
                              }
                            >
                              {getPeriodLabel(period)}
                            </Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  ))}
                </View>
              </View>
            )}
          </WalkthroughableView>
        </CopilotStep>

        {/* Reference Requests Section - Only show when loaded; show card if count > 0 */}
        {!loadingReferenceRequests && pendingReferenceRequestsCount > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>
                {t('referenceRequest.incomingTitle')}
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.card, { backgroundColor: colors.card }]}
              onPress={() => navigation.navigate('IncomingReferenceRequests')}
              activeOpacity={0.7}
            >
              <View style={styles.referenceRequestRow}>
                <View style={styles.referenceRequestLeft}>
                  <View
                    style={[
                      styles.referenceRequestIcon,
                      { backgroundColor: isDark ? primary[900] : primary[100] },
                    ]}
                  >
                    <Ionicons
                      name="person-add"
                      size={20}
                      color={isDark ? primary[100] : primary[600]}
                    />
                  </View>
                  <View style={styles.referenceRequestTextContainer}>
                    <Text style={[styles.referenceRequestTitle, { color: colors.text }]}>
                      {t('referenceRequest.pendingRequests')}
                    </Text>
                    <Text style={[styles.referenceRequestSubtitle, { color: colors.textMuted }]}>
                      {t('referenceRequest.helpCertifyRatings')}
                    </Text>
                  </View>
                </View>
                <View style={styles.referenceRequestRight}>
                  <View style={[styles.referenceRequestBadge, { backgroundColor: colors.primary }]}>
                    <Text
                      style={[
                        styles.referenceRequestBadgeText,
                        { color: colors.primaryForeground },
                      ]}
                    >
                      {pendingReferenceRequestsCount}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                </View>
              </View>
            </TouchableOpacity>
          </View>
        )}

        {/* Bottom Spacing */}
        <View style={{ height: 40 }} />
      </ScrollView>
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
    alignItems: 'center',
    paddingVertical: spacingPixels[6],
    paddingHorizontal: spacingPixels[4],
  },
  profilePicWrapper: {
    position: 'relative',
    marginBottom: spacingPixels[1],
  },
  profilePicContainer: {
    width: spacingPixels[20],
    height: spacingPixels[20],
    borderRadius: radiusPixels.full,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
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
    borderWidth: 2,
    borderColor: 'transparent',
  },
  profilePicHint: {
    fontSize: fontSizePixels.xs,
    marginBottom: spacingPixels[3],
  },
  profileImage: {
    width: spacingPixels[20],
    height: spacingPixels[20],
    borderRadius: radiusPixels.full,
  },
  profileName: {
    fontSize: fontSizePixels.xl,
    fontWeight: fontWeightNumeric.bold,
    marginBottom: spacingPixels[1],
  },
  username: {
    fontSize: fontSizePixels.sm,
    marginBottom: spacingPixels[2],
  },
  profileBadgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    marginTop: spacingPixels[1],
  },
  joinedContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    marginTop: spacingPixels[1],
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
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacingPixels[2],
  },
  sportsHintInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
  },
  sportsHintText: {
    fontSize: fontSizePixels.xs,
  },
  editIconButton: {
    padding: spacingPixels[1],
  },
  card: {
    borderRadius: radiusPixels.xl,
    padding: spacingPixels[4],
    ...shadowsNative.sm,
  },
  skeletonCard: {
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
    ...shadowsNative.sm,
  },
  sportCardInactive: {
    opacity: 0.7,
  },
  addMoreSportsCard: {
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  addMoreSportsContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
    flex: 1,
  },
  addMoreSportsText: {
    flex: 1,
  },
  addMoreSportsTitle: {
    fontSize: fontSizePixels.base,
    fontWeight: fontWeightNumeric.semibold,
  },
  addMoreSportsHint: {
    fontSize: fontSizePixels.xs,
    marginTop: spacingPixels[0.5],
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
    borderRadius: radiusPixels.xl,
  },
  inactiveBadgeText: {
    fontSize: fontSizePixels.xs,
    fontWeight: fontWeightNumeric.semibold,
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
  // Availability Grid Styles - Same as PlayerAvailabilitiesOverlay
  gridContainer: {
    marginTop: spacingPixels[2],
  },
  gridRow: {
    flexDirection: 'row',
    marginBottom: spacingPixels[2],
    alignItems: 'center',
  },
  dayCell: {
    width: 50, // 12.5 * 4px base unit
    justifyContent: 'center',
  },
  headerCell: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  timeSlotWrapper: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: spacingPixels[1],
  },
  timeSlotCell: {
    width: '100%',
    borderRadius: radiusPixels.lg,
    paddingVertical: spacingPixels[3],
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  timeSlotCellSelected: {},
  uploadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: radiusPixels.full,
    justifyContent: 'center',
    alignItems: 'center',
  },
  uploadingText: {
    marginTop: spacingPixels[2],
    fontSize: fontSizePixels.xs,
    fontWeight: fontWeightNumeric.semibold,
  },
  // Reference Request Styles
  referenceRequestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  referenceRequestLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
    flex: 1,
  },
  referenceRequestIcon: {
    width: 44,
    height: 44,
    borderRadius: radiusPixels.lg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  referenceRequestTextContainer: {
    flex: 1,
  },
  referenceRequestTitle: {
    fontSize: fontSizePixels.base,
    fontWeight: fontWeightNumeric.semibold,
  },
  referenceRequestSubtitle: {
    fontSize: fontSizePixels.sm,
    marginTop: spacingPixels[0.5],
  },
  referenceRequestRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  referenceRequestBadge: {
    minWidth: 24,
    height: 24,
    borderRadius: radiusPixels.full,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[2],
  },
  referenceRequestBadgeText: {
    fontSize: fontSizePixels.sm,
    fontWeight: fontWeightNumeric.bold,
  },
});

export default UserProfile;
