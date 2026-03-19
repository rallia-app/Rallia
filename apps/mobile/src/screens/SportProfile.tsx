import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRoute, useFocusEffect } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import { useAppNavigation } from '../navigation/hooks';
import type { RootStackParamList } from '../navigation/types';
import { Text, Skeleton, useToast, Button } from '@rallia/shared-components';
import { supabase, Logger } from '@rallia/shared-services';
import { usePlayPreferences, useFavoriteFacilities, usePlayer } from '@rallia/shared-hooks';
import { MATCH_DURATION_ENUM_LABELS } from '@rallia/shared-types';
import { useThemeStyles, useTranslation, type TranslationKey } from '../hooks';
import { useSport } from '../context';
import { useUserLocation } from '../hooks/useUserLocation';
import {
  spacingPixels,
  radiusPixels,
  fontSizePixels,
  fontWeightNumeric,
  primary,
} from '@rallia/design-system';

// Certification status colors for rating display (theme-aware)
const getCertificationColors = (
  status: 'self_declared' | 'certified' | 'disputed',
  dark: boolean
) => {
  const accent =
    status === 'certified'
      ? '#4CAF50'
      : status === 'disputed'
        ? '#F44336'
        : dark
          ? primary[400]
          : primary[500];
  const bg = dark ? `${accent}30` : `${accent}15`;
  return { background: bg, border: accent, text: accent };
};

/**
 * Maps score value to a skill level translation key based on sport
 */
const getSkillLevelTranslationKey = (
  sportName: string,
  scoreValue: number
): TranslationKey | null => {
  // Tennis (NTRP) mapping
  const tennisMapping: Record<number, TranslationKey> = {
    1.5: 'onboarding.ratingStep.skillLevels.beginner1',
    2.0: 'onboarding.ratingStep.skillLevels.beginner2',
    2.5: 'onboarding.ratingStep.skillLevels.beginner3',
    3.0: 'onboarding.ratingStep.skillLevels.intermediate1',
    3.5: 'onboarding.ratingStep.skillLevels.intermediate2',
    4.0: 'onboarding.ratingStep.skillLevels.intermediate3',
    4.5: 'onboarding.ratingStep.skillLevels.advanced1',
    5.0: 'onboarding.ratingStep.skillLevels.advanced2',
    5.5: 'onboarding.ratingStep.skillLevels.advanced3',
    6.0: 'onboarding.ratingStep.skillLevels.professional',
  };

  // Pickleball (DUPR) mapping
  const pickleballMapping: Record<number, TranslationKey> = {
    1.0: 'onboarding.ratingStep.skillLevels.beginner1',
    2.0: 'onboarding.ratingStep.skillLevels.beginner2',
    2.5: 'onboarding.ratingStep.skillLevels.beginner3',
    3.0: 'onboarding.ratingStep.skillLevels.intermediate1',
    3.5: 'onboarding.ratingStep.skillLevels.intermediate2',
    4.0: 'onboarding.ratingStep.skillLevels.intermediate3',
    4.5: 'onboarding.ratingStep.skillLevels.advanced1',
    5.0: 'onboarding.ratingStep.skillLevels.advanced2',
    5.5: 'onboarding.ratingStep.skillLevels.advanced3',
    6.0: 'onboarding.ratingStep.skillLevels.professional',
  };

  const mapping = sportName.toLowerCase() === 'tennis' ? tennisMapping : pickleballMapping;
  return mapping[scoreValue] || null;
};

import { selectionHaptic } from '@rallia/shared-utils';
import { withTimeout, getNetworkErrorMessage } from '../utils/networkTimeout';
import { SheetManager } from 'react-native-actions-sheet';

type SportProfileRouteProp = RouteProp<RootStackParamList, 'SportProfile'>;

interface RatingInfo {
  ratingScoreId: string; // ID of the rating_score record
  ratingTypeName: string;
  displayLabel: string;
  scoreValue: number;
  skillLevel: string;
  isVerified: boolean;
  verifiedAt: string | null;
  minValue: number;
  maxValue: number;
  description: string;
}

interface PreferencesInfo {
  matchDuration: string | null;
  matchType: string | null;
  facilityName: string | null;
  playingStyle: string | null;
  playAttributes: string[] | null;
}

const SportProfile = () => {
  const navigation = useAppNavigation();
  const route = useRoute<SportProfileRouteProp>();
  const { sportId, sportName } = route.params;
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const { refetch: refetchSportContext } = useSport();
  const toast = useToast();
  const { location } = useUserLocation();

  // Get player data from context (loads instantly)
  const {
    player,
    sportRatings,
    sportPreferences,
    loading: playerLoading,
    refetch: refetchPlayer,
  } = usePlayer();
  const userId = player?.id || '';
  const { userSports } = useSport();

  // Theme-aware skeleton colors (aligned with UserProfile for consistency)
  const skeletonBg = isDark ? '#262626' : '#E1E9EE';
  const skeletonHighlight = isDark ? '#404040' : '#F2F8FC';

  // Fetch play styles and attributes for this sport
  const {
    playStyles: playStyleOptions,
    playAttributesByCategory,
    loading: loadingPlayOptions,
  } = usePlayPreferences(sportId);

  // Check if we have cached data for this sport from the player context
  const cachedRating = !playerLoading ? sportRatings[sportId] : null;
  const hasCachedRating = !!cachedRating;
  const cachedPrefs = !playerLoading ? sportPreferences[sportId] : null;
  const hasCachedPrefs = !!cachedPrefs;

  // Derive initial active state from context to avoid flash
  const isSportInContext = userSports.some(s => s.id === sportId);

  // Initialize rating info with cached rating if available (prevents flash)
  const initialRatingInfo: RatingInfo | null = hasCachedRating
    ? (() => {
        const scoreVal = cachedRating.value ?? 0;
        const skillLevelKey = getSkillLevelTranslationKey(sportName, scoreVal);
        const translatedSkillLevel = skillLevelKey
          ? t(skillLevelKey)
          : cachedRating.skillLevel
            ? cachedRating.skillLevel.charAt(0).toUpperCase() + cachedRating.skillLevel.slice(1)
            : '';
        return {
          ratingScoreId: cachedRating.ratingScoreId || '',
          ratingTypeName: cachedRating.ratingSystemCode || cachedRating.ratingSystemName || '',
          displayLabel: cachedRating.label,
          scoreValue: scoreVal,
          skillLevel: translatedSkillLevel,
          isVerified: cachedRating.isCertified || false,
          verifiedAt: cachedRating.certifiedAt || null,
          minValue: cachedRating.minValue ?? 0,
          maxValue: cachedRating.maxValue ?? 10,
          description: cachedRating.ratingSystemDescription || '',
        };
      })()
    : null;

  // Section-specific loading states (like UserProfile)
  const [loadingSportStatus, setLoadingSportStatus] = useState(!hasCachedPrefs);
  const [loadingRating, setLoadingRating] = useState(!hasCachedRating);
  const [loadingPreferences, setLoadingPreferences] = useState(!hasCachedPrefs);

  const [isActive, setIsActive] = useState(
    hasCachedPrefs ? cachedPrefs!.isActive : isSportInContext
  );
  const [playerSportId, setPlayerSportId] = useState<string | null>(
    hasCachedPrefs ? cachedPrefs!.playerSportId : null
  );
  const [playerRatingScoreId, setPlayerRatingScoreId] = useState<string | null>(
    hasCachedRating ? cachedRating!.playerRatingScoreId || null : null
  );
  const [ratingInfo, setRatingInfo] = useState<RatingInfo | null>(initialRatingInfo);
  // Total proofs count (all proofs for this sport) - shown in "Rating Proof" button
  const [totalProofsCount, setTotalProofsCount] = useState(0);
  // Current-level proofs count (proofs matching current rating) - used for certification
  const [currentLevelProofsCount, setCurrentLevelProofsCount] = useState(0);
  const [referencesCount, setReferencesCount] = useState(
    hasCachedRating ? (cachedRating!.referralsCount ?? 0) : 0
  );
  const [certificationStatus, setCertificationStatus] = useState<
    'self_declared' | 'certified' | 'disputed'
  >(hasCachedRating ? cachedRating!.badge_status || 'self_declared' : 'self_declared');
  const [peerEvaluationAverage, setPeerEvaluationAverage] = useState<number | undefined>(
    hasCachedRating ? (cachedRating!.peerEvaluationAverage ?? undefined) : undefined
  );
  const [peerEvaluationCount, setPeerEvaluationCount] = useState<number>(
    hasCachedRating ? (cachedRating!.peerEvaluationCount ?? 0) : 0
  );
  const [preferences, setPreferences] = useState<PreferencesInfo>({
    matchDuration: cachedPrefs?.matchDuration ?? null,
    matchType: cachedPrefs?.matchType ?? null,
    facilityName: null,
    playingStyle: cachedPrefs?.playStyle?.name ?? null,
    playAttributes: cachedPrefs?.playAttributes?.map(a => a.name) ?? null,
  });

  // Derived certification colors (theme-aware)
  const certColors = getCertificationColors(certificationStatus, isDark);

  // Fetch user's favorite facilities
  const {
    favorites: favoriteFacilities,
    loading: loadingFavorites,
    refetch: refetchFavorites,
  } = useFavoriteFacilities(userId);

  // Always sync rating state from PlayerContext cache when it changes
  useEffect(() => {
    if (cachedRating) {
      const scoreVal = cachedRating.value ?? 0;
      const skillLevelKey = getSkillLevelTranslationKey(sportName, scoreVal);
      const translatedSkillLevel = skillLevelKey
        ? t(skillLevelKey)
        : cachedRating.skillLevel
          ? cachedRating.skillLevel.charAt(0).toUpperCase() + cachedRating.skillLevel.slice(1)
          : '';
      setRatingInfo({
        ratingScoreId: cachedRating.ratingScoreId || '',
        ratingTypeName: cachedRating.ratingSystemCode || cachedRating.ratingSystemName || '',
        displayLabel: cachedRating.label,
        scoreValue: scoreVal,
        skillLevel: translatedSkillLevel,
        isVerified: cachedRating.isCertified || false,
        verifiedAt: cachedRating.certifiedAt || null,
        minValue: cachedRating.minValue ?? 0,
        maxValue: cachedRating.maxValue ?? 10,
        description: cachedRating.ratingSystemDescription || '',
      });
      setPlayerRatingScoreId(cachedRating.playerRatingScoreId || null);
      setReferencesCount(cachedRating.referralsCount ?? 0);
      setPeerEvaluationAverage(cachedRating.peerEvaluationAverage ?? undefined);
      setPeerEvaluationCount(cachedRating.peerEvaluationCount ?? 0);
      setCertificationStatus(cachedRating.badge_status || 'self_declared');
      setLoadingRating(false);
    }
  }, [cachedRating, sportName, t]);

  // Always sync preferences state from PlayerContext cache when it changes
  useEffect(() => {
    if (cachedPrefs) {
      setIsActive(cachedPrefs.isActive);
      setPlayerSportId(cachedPrefs.playerSportId);
      setPreferences(prev => ({
        ...prev,
        matchDuration: cachedPrefs.matchDuration,
        matchType: cachedPrefs.matchType,
        playingStyle: cachedPrefs.playStyle?.name ?? null,
        playAttributes: cachedPrefs.playAttributes?.map(a => a.name) ?? null,
      }));
      setLoadingSportStatus(false);
      setLoadingPreferences(false);
    }
  }, [cachedPrefs]);

  // Only fetch from DB if we don't have cached data (fallback for edge cases)
  useEffect(() => {
    if (userId && !hasCachedPrefs) {
      fetchSportProfileData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Refresh proof counts when returning to this screen
  const refreshProofAndCertificationData = useCallback(async () => {
    if (!playerRatingScoreId || !ratingInfo?.ratingScoreId) return;

    // Fetch proof counts and certification status in parallel
    const [proofsResult, certResult] = await Promise.all([
      // Fetch all proofs for this player_rating_score (total count)
      supabase
        .from('rating_proof')
        .select('rating_score_id')
        .eq('player_rating_score_id', playerRatingScoreId)
        .eq('is_active', true),
      // Fetch updated certification status from DB (may have been updated by triggers)
      supabase
        .from('player_rating_score')
        .select(
          'badge_status, referrals_count, is_certified, peer_evaluation_average, peer_evaluation_count'
        )
        .eq('id', playerRatingScoreId)
        .single(),
    ]);

    // Update proof counts
    if (!proofsResult.error && proofsResult.data) {
      const proofs = proofsResult.data;
      // Total count: all proofs for this sport
      setTotalProofsCount(proofs.length);

      // Current-level count: only proofs matching current rating_score_id
      const currentLevelCount = proofs.filter(
        p => p.rating_score_id === ratingInfo.ratingScoreId
      ).length;
      setCurrentLevelProofsCount(currentLevelCount);
    }

    // Refresh reference count (level-filtered)
    const { data: refs, error: refsError } = await supabase
      .from('rating_reference_request')
      .select('rating_score_id, rating_score:rating_score_id(value)')
      .eq('player_rating_score_id', playerRatingScoreId)
      .eq('status', 'completed')
      .eq('rating_supported', true);

    if (!refsError && refs) {
      const currentValue = ratingInfo.scoreValue;
      const validCount = refs.filter(r => {
        const score = r.rating_score as unknown as { value: number } | null;
        return score && score.value >= currentValue;
      }).length;
      setReferencesCount(validCount);
    }
  }, [playerRatingScoreId, ratingInfo?.ratingScoreId, ratingInfo?.scoreValue]);

  useFocusEffect(
    useCallback(() => {
      refreshProofAndCertificationData();
    }, [refreshProofAndCertificationData])
  );

  const fetchSportProfileData = async () => {
    if (!userId) return;

    try {
      // Only show skeletons if we don't have cached data
      if (!hasCachedPrefs) {
        setLoadingSportStatus(true);
        setLoadingPreferences(true);
      }
      if (!hasCachedRating) {
        setLoadingRating(true);
      }

      // Fetch sport status (rating data comes from PlayerContext cache)
      const fetchSportStatus = async () => {
        const playerSportResult = await withTimeout(
          (async () =>
            supabase
              .from('player_sport')
              .select('id, is_active, preferred_match_duration, preferred_match_type, is_primary')
              .eq('player_id', userId)
              .eq('sport_id', sportId)
              .maybeSingle())(),
          15000,
          'Failed to load sport profile - connection timeout'
        );
        return playerSportResult;
      };

      // Fetch sport status (rating data is already available from PlayerContext cache)
      const playerSportResult = await fetchSportStatus();

      // Process player sport data
      const { data: playerSportData, error: playerSportError } = playerSportResult;

      if (playerSportError && playerSportError.code !== 'PGRST116') {
        throw playerSportError;
      }

      if (playerSportData) {
        setIsActive(playerSportData.is_active || false);
        setPlayerSportId(playerSportData.id);

        // Fetch play style and attributes from junction tables
        const [playStyleResult, playAttributesResult] = await Promise.all([
          supabase
            .from('player_sport_play_style')
            .select(
              `
              play_style:play_style_id (
                id,
                name,
                description
              )
            `
            )
            .eq('player_sport_id', playerSportData.id)
            .maybeSingle(),
          supabase
            .from('player_sport_play_attribute')
            .select(
              `
              play_attribute:play_attribute_id (
                id,
                name,
                description,
                category
              )
            `
            )
            .eq('player_sport_id', playerSportData.id),
        ]);

        // Extract play style name
        const playStyleName =
          (playStyleResult.data?.play_style as { name?: string } | null)?.name || null;

        // Extract play attribute names
        const playAttributeNames =
          playAttributesResult.data
            ?.map(item => (item.play_attribute as { name?: string } | null)?.name)
            .filter((name): name is string => !!name) || null;

        setPreferences(prev => ({
          ...prev,
          matchDuration: playerSportData.preferred_match_duration || null,
          matchType: playerSportData.preferred_match_type || null,
          playingStyle: playStyleName,
          playAttributes:
            playAttributeNames && playAttributeNames.length > 0 ? playAttributeNames : null,
        }));
      } else {
        setIsActive(false);
        setPlayerSportId(null);
      }

      setLoadingSportStatus(false);
      setLoadingPreferences(false);

      // Rating data is synced reactively via the cachedRating useEffect above.
      // Only handle the case where sport is active but has no rating data at all.
      if (playerSportData?.is_active && !cachedRating) {
        Logger.debug('no_rating_data_found', { sportName, sportId });
        setRatingInfo(null);
        setPlayerRatingScoreId(null);
        setTotalProofsCount(0);
        setCurrentLevelProofsCount(0);
      }

      setLoadingRating(false);
    } catch (error) {
      Logger.error('Failed to fetch sport profile data', error as Error, { sportId, sportName });
      toast.error(getNetworkErrorMessage(error));
    } finally {
      setLoadingSportStatus(false);
      setLoadingRating(false);
      setLoadingPreferences(false);
    }
  };

  const handleSaveRating = async (ratingScoreId: string) => {
    if (!userId) {
      Alert.alert(t('alerts.error'), t('errors.userNotAuthenticated'));
      return;
    }

    try {
      Logger.debug('save_rating_start', { ratingScoreId, sportId, sportName });

      // Step 1: Get ALL player ratings with source info for this sport
      const ratingsResult = await withTimeout(
        (async () =>
          supabase
            .from('player_rating_score')
            .select(
              `
            id,
            rating_score_id,
            source,
            is_certified,
            rating_score!player_rating_scores_rating_score_id_fkey (
              id,
              rating_system (
                sport_id
              )
            )
          `
            )
            .eq('player_id', userId))(),
        15000,
        'Failed to fetch ratings - connection timeout'
      );

      const { data: allPlayerRatings, error: fetchError } = ratingsResult;

      if (fetchError) {
        Logger.error('Failed to fetch player ratings', fetchError as Error, { playerId: userId });
        throw fetchError;
      }

      Logger.debug('player_ratings_fetched', { count: allPlayerRatings?.length });

      // Step 2: Find existing self_reported rating for this sport (to UPDATE instead of DELETE)
      // This preserves the player_rating_score_id and keeps proofs linked!
      const existingSelfReportedRating = allPlayerRatings?.find(item => {
        const ratingScoreData = Array.isArray(item.rating_score)
          ? item.rating_score[0]
          : item.rating_score;
        if (!ratingScoreData) return false;

        const ratingSystemData = Array.isArray(ratingScoreData.rating_system)
          ? ratingScoreData.rating_system[0]
          : ratingScoreData.rating_system;
        const itemSportId = ratingSystemData?.sport_id;
        const source = item.source || 'self_reported';
        const isUserReported = source === 'self_reported' || source === 'onboarding';

        return itemSportId === sportId && isUserReported;
      });

      Logger.debug('existing_rating_check', {
        sportId,
        existingId: existingSelfReportedRating?.id,
        existingRatingScoreId: existingSelfReportedRating?.rating_score_id,
      });

      if (existingSelfReportedRating) {
        // If rating hasn't changed, skip the update entirely
        if (existingSelfReportedRating.rating_score_id === ratingScoreId) {
          Logger.debug('rating_unchanged_skipping_update', {
            existingId: existingSelfReportedRating.id,
            ratingScoreId,
          });
        } else {
          // UPDATE the existing record instead of deleting it
          // This preserves the player_rating_score_id and keeps all proofs linked!
          Logger.debug('updating_existing_rating', {
            existingId: existingSelfReportedRating.id,
            newRatingScoreId: ratingScoreId,
          });

          // Check if another record already exists with this rating_score_id (e.g., from a different source)
          const existingDuplicate = allPlayerRatings?.find(
            item =>
              item.rating_score_id === ratingScoreId && item.id !== existingSelfReportedRating.id
          );

          if (existingDuplicate) {
            // Another record already has this rating - delete our self_reported one instead of updating
            Logger.debug('deleting_duplicate_self_reported_rating', {
              deletingId: existingSelfReportedRating.id,
              existingDuplicateId: existingDuplicate.id,
            });
            await withTimeout(
              (async () =>
                supabase
                  .from('player_rating_score')
                  .delete()
                  .eq('id', existingSelfReportedRating.id))(),
              10000,
              'Failed to remove duplicate rating - connection timeout'
            );
          } else {
            // Only update rating_score_id - let DB trigger handle certification logic
            const updateResult = await withTimeout(
              (async () =>
                supabase
                  .from('player_rating_score')
                  .update({
                    rating_score_id: ratingScoreId,
                    updated_at: new Date().toISOString(),
                  })
                  .eq('id', existingSelfReportedRating.id))(),
              10000,
              'Failed to update rating - connection timeout'
            );

            if (updateResult.error) {
              Logger.error('Failed to update rating', updateResult.error as Error, {
                ratingId: existingSelfReportedRating.id,
                ratingScoreId,
              });
              throw updateResult.error;
            }
          }
        }

        Logger.info('rating_updated', {
          ratingId: existingSelfReportedRating.id,
          ratingScoreId,
          sportId,
        });
      } else {
        // No existing self_reported rating - check if another source already has this exact rating
        const existingWithSameScore = allPlayerRatings?.find(
          item => item.rating_score_id === ratingScoreId
        );

        if (existingWithSameScore) {
          Logger.debug('rating_already_exists_from_other_source', {
            existingId: existingWithSameScore.id,
            ratingScoreId,
          });
          // Rating already exists from another source, no need to insert
        } else {
          // INSERT a new one
          Logger.debug('inserting_new_rating', { ratingScoreId, playerId: userId });
          const insertResult = await withTimeout(
            (async () =>
              supabase.from('player_rating_score').insert({
                player_id: userId,
                rating_score_id: ratingScoreId,
                source: 'self_reported',
                is_certified: false,
              }))(),
            10000,
            'Failed to save rating - connection timeout'
          );

          if (insertResult.error) {
            Logger.error('Failed to insert new rating', insertResult.error as Error, {
              ratingScoreId,
              playerId: userId,
            });
            throw insertResult.error;
          }

          Logger.info('rating_inserted', { ratingScoreId, sportId });
        }
      }

      Logger.info('rating_save_complete', { ratingScoreId, sportId, sourceType: 'self_reported' });

      // Show rating skeleton while new data loads
      setLoadingRating(true);

      // Close overlays
      SheetManager.hide('tennis-rating');
      SheetManager.hide('pickleball-rating');

      // Add a small delay to ensure database has committed the transaction
      await new Promise(resolve => setTimeout(resolve, 500));

      // Refresh PlayerContext cache — useEffect syncs ratingInfo from cachedRating automatically
      Logger.debug('refreshing_player_context', { sportId });
      await refetchPlayer();

      // Show success message
      toast.success(t('alerts.ratingUpdated'));
    } catch (error) {
      Logger.error('Failed to save rating', error as Error, { sportId, ratingScoreId });
      toast.error(getNetworkErrorMessage(error));
    }
  };

  const handleManageProofs = () => {
    if (!playerRatingScoreId || !ratingInfo) {
      Alert.alert(t('alerts.error'), t('errors.notFound'));
      return;
    }
    navigation.navigate('RatingProofs', {
      playerRatingScoreId: playerRatingScoreId,
      sportName: sportName,
      ratingValue: ratingInfo.scoreValue,
      isOwnProfile: true,
    });
  };

  const handleDeactivateSport = async () => {
    if (!playerSportId || !userId) return;

    try {
      // Check if user has at least 2 active sports
      const { count, error: countError } = await withTimeout(
        (async () =>
          supabase
            .from('player_sport')
            .select('id', { count: 'exact', head: true })
            .eq('player_id', userId)
            .eq('is_active', true))(),
        10000,
        'Failed to check active sports - connection timeout'
      );

      if (countError) throw countError;

      if (count !== null && count <= 1) {
        Alert.alert(t('alerts.cannotDeactivate'), t('alerts.mustHaveOneSport'));
        return;
      }

      // Show confirmation dialog
      Alert.alert(
        t('profile.sport.confirmDeactivation', { sport: sportName }),
        t('profile.sport.confirmDeactivationMessage'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('profile.sport.deactivateSport'),
            style: 'destructive',
            onPress: async () => {
              try {
                const updateResult = await withTimeout(
                  (async () =>
                    supabase
                      .from('player_sport')
                      .update({ is_active: false })
                      .eq('id', playerSportId))(),
                  10000,
                  'Failed to deactivate sport - connection timeout'
                );

                if (updateResult.error) throw updateResult.error;

                await refetchSportContext();
                toast.success(t('alerts.sportDeactivated', { sport: sportName }));
                navigation.goBack();
              } catch (err) {
                Logger.error('Failed to deactivate sport', err as Error, { sportId, sportName });
                toast.error(getNetworkErrorMessage(err));
              }
            },
          },
        ]
      );
    } catch (error) {
      Logger.error('Failed to check deactivation eligibility', error as Error, {
        sportId,
        sportName,
      });
      toast.error(getNetworkErrorMessage(error));
    }
  };

  const formatMatchDuration = (duration: string | null): string => {
    if (!duration) return t('profile.notSet');

    // Use translation keys for enum values
    const translationKey = `profile.preferences.durations.${duration}` as TranslationKey;
    const translated = t(translationKey);

    // If translation exists (not the same as key), use it
    if (translated !== translationKey) {
      return translated;
    }

    // Fallback to shared constant for enum values
    if (duration in MATCH_DURATION_ENUM_LABELS) {
      return MATCH_DURATION_ENUM_LABELS[duration as keyof typeof MATCH_DURATION_ENUM_LABELS];
    }

    // Legacy values (for backward compatibility during migration)
    const legacyMap: Record<string, string> = {
      '1h': t('matchCreation.duration.60'),
      '1.5h': t('matchCreation.duration.90'),
      '2h': t('matchCreation.duration.120'),
    };

    return legacyMap[duration] || duration.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  const formatMatchType = (type: string | null): string => {
    if (!type) return t('profile.notSet');

    // Use translation keys for match types
    const translationKey = `profile.preferences.matchTypes.${type.toLowerCase()}` as TranslationKey;
    const translated = t(translationKey);

    // If translation exists (not the same as key), use it
    if (translated !== translationKey) {
      return translated;
    }

    // Fallback: capitalize first letter of each word
    return type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  const formatPlayingStyle = (style: string | null): string => {
    if (!style) return t('profile.notSet');

    // Use translation keys for play styles
    const translationKey = `profile.preferences.playStyles.${style}` as TranslationKey;
    const translated = t(translationKey);

    // If translation exists (not the same as key), use it
    if (translated !== translationKey) {
      return translated;
    }

    // Fallback: capitalize first letter of each word
    return style.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  const formatPlayAttribute = (attribute: string): string => {
    // Use translation keys for play attributes
    const translationKey = `profile.preferences.playAttributes.${attribute}` as TranslationKey;
    const translated = t(translationKey);

    // If translation exists (not the same as key), use it
    if (translated !== translationKey) {
      return translated;
    }

    // Fallback: capitalize first letter of each word
    return attribute.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  const handleSendPeerRatingRequests = async (selectedPlayerIds: string[]) => {
    try {
      // TODO: Implement peer rating request logic
      // This will insert records into peer_rating_request table
      Logger.logUserAction('send_peer_rating_requests', {
        count: selectedPlayerIds.length,
        sportId,
      });

      // For now, just show a success message
      toast.success(t('alerts.peerRatingRequestsSent', { count: selectedPlayerIds.length }));
    } catch (error) {
      Logger.error('Failed to send peer rating requests', error as Error, {
        count: selectedPlayerIds.length,
        sportId,
      });
      toast.error(t('alerts.failedToSendPeerRatingRequests'));
    }
  };

  // Helper to open peer rating request sheet
  const openPeerRatingRequestSheet = () => {
    SheetManager.show('peer-rating-request', {
      payload: {
        currentUserId: userId,
        sportId,
        onSendRequests: handleSendPeerRatingRequests,
      },
    });
  };

  const handleSendReferenceRequests = async (selectedPlayerIds: string[]) => {
    try {
      if (!playerRatingScoreId || !userId) {
        throw new Error('Missing required data for reference request');
      }

      Logger.logUserAction('send_reference_requests', { count: selectedPlayerIds.length, sportId });

      // Calculate expiration date (14 days from now)
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 14);

      // Insert reference requests into the database
      const referenceRequests = selectedPlayerIds.map(refereePlayerId => ({
        player_rating_score_id: playerRatingScoreId,
        requester_id: userId,
        referee_id: refereePlayerId,
        status: 'pending',
        expires_at: expiresAt.toISOString(),
        rating_score_id: ratingInfo?.ratingScoreId || undefined,
      }));

      const { error: insertError } = await supabase
        .from('rating_reference_request')
        .insert(referenceRequests);

      if (insertError) {
        // Check for unique constraint violation (already requested)
        if (insertError.code === '23505') {
          toast.warning(t('profile.certification.referenceRequest.alreadyRequested'));
        } else {
          throw insertError;
        }
      } else {
        toast.success(t('alerts.referenceRequestsSent', { count: selectedPlayerIds.length }));
      }

      SheetManager.hide('reference-request');
    } catch (error) {
      Logger.error('Failed to send reference requests', error as Error, {
        count: selectedPlayerIds.length,
        sportId,
      });
      toast.error(t('alerts.failedToSendReferenceRequests'));
    }
  };

  const handleSavePreferences = async (
    updatedPreferences: {
      matchDuration?: string;
      matchType?: string;
      court?: string;
      playStyle?: string;
      playAttributes?: string[];
    },
    playerSportIdOverride?: string
  ) => {
    try {
      // Use override if provided (for first-time setup flow), otherwise use state
      const effectivePlayerSportId = playerSportIdOverride || playerSportId;

      if (!effectivePlayerSportId) {
        Alert.alert(t('alerts.error'), t('errors.notFound'));
        return;
      }

      // 1. Update basic preferences in player_sport table
      const updateResult = await withTimeout(
        (async () =>
          supabase
            .from('player_sport')
            .update({
              preferred_match_duration: updatedPreferences.matchDuration,
              preferred_match_type: updatedPreferences.matchType,
            })
            .eq('id', effectivePlayerSportId))(),
        10000,
        'Failed to save preferences - connection timeout'
      );

      if (updateResult.error) throw updateResult.error;

      // 2. Save play style to junction table (if provided)
      if (updatedPreferences.playStyle) {
        // First, delete existing play style for this player_sport
        await supabase
          .from('player_sport_play_style')
          .delete()
          .eq('player_sport_id', effectivePlayerSportId);

        // Find the play_style record by name for this sport
        const { data: playStyleData } = await supabase
          .from('play_style')
          .select('id')
          .eq('sport_id', sportId)
          .eq('name', updatedPreferences.playStyle)
          .single();

        if (playStyleData) {
          // Insert new play style
          await supabase.from('player_sport_play_style').insert({
            player_sport_id: effectivePlayerSportId,
            play_style_id: playStyleData.id,
          });
        }
      } else {
        // If no play style selected, delete any existing
        await supabase
          .from('player_sport_play_style')
          .delete()
          .eq('player_sport_id', effectivePlayerSportId);
      }

      // 3. Save play attributes to junction table (if provided)
      // First, delete existing play attributes for this player_sport
      await supabase
        .from('player_sport_play_attribute')
        .delete()
        .eq('player_sport_id', effectivePlayerSportId);

      if (updatedPreferences.playAttributes && updatedPreferences.playAttributes.length > 0) {
        // Find the play_attribute records by name for this sport
        const { data: playAttributeData } = await supabase
          .from('play_attribute')
          .select('id, name')
          .eq('sport_id', sportId)
          .in('name', updatedPreferences.playAttributes);

        if (playAttributeData && playAttributeData.length > 0) {
          // Insert new play attributes
          const attributeInserts = playAttributeData.map(attr => ({
            player_sport_id: effectivePlayerSportId,
            play_attribute_id: attr.id,
          }));

          await supabase.from('player_sport_play_attribute').insert(attributeInserts);
        }
      }

      // Update local state
      setPreferences(prev => ({
        ...prev,
        matchDuration: updatedPreferences.matchDuration || null,
        matchType: updatedPreferences.matchType || null,
        playingStyle: updatedPreferences.playStyle || null,
        playAttributes: updatedPreferences.playAttributes || null,
      }));

      // Close overlay
      SheetManager.hide('tennis-preferences');
      SheetManager.hide('pickleball-preferences');

      // Refetch favorites and player context cache
      refetchFavorites();
      refetchPlayer();

      // Show success message
      toast.success(t('alerts.preferencesUpdated'));
    } catch (error) {
      Logger.error('Failed to save sport preferences', error as Error, { sportId, playerSportId });
      toast.error(getNetworkErrorMessage(error));
    }
  };

  // Don't render until we have userId from context
  if (!userId) {
    return null;
  }

  // Guard: if sport is inactive (navigated here unexpectedly), go back
  if (!isActive && !loadingSportStatus) {
    navigation.goBack();
    return null;
  }

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['bottom']}
    >
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* My Rating Section */}
        {isActive && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>
                {t('profile.sections.rating')}
              </Text>
              <TouchableOpacity
                style={styles.editIconButton}
                onPress={() => {
                  if (sportName.toLowerCase() === 'tennis') {
                    SheetManager.show('tennis-rating', {
                      payload: {
                        mode: 'edit',
                        initialRating: ratingInfo?.ratingScoreId,
                        onSave: handleSaveRating,
                      },
                    });
                  } else if (sportName.toLowerCase() === 'pickleball') {
                    SheetManager.show('pickleball-rating', {
                      payload: {
                        mode: 'edit',
                        initialRating: ratingInfo?.ratingScoreId,
                        onSave: handleSaveRating,
                      },
                    });
                  }
                }}
              >
                <Ionicons name="create-outline" size={20} color={colors.primary} />
              </TouchableOpacity>
            </View>

            <View
              style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              {loadingRating ? (
                <>
                  {/* Rating Badge skeleton */}
                  <View
                    style={[
                      styles.ratingBadge,
                      { backgroundColor: skeletonBg, borderColor: 'transparent' },
                    ]}
                  >
                    <Skeleton
                      width={64}
                      height={28}
                      backgroundColor={skeletonBg}
                      highlightColor={skeletonHighlight}
                      style={{ borderRadius: radiusPixels.md }}
                    />
                    <View style={styles.certificationStatusRow}>
                      <Skeleton
                        width={14}
                        height={14}
                        backgroundColor={skeletonBg}
                        highlightColor={skeletonHighlight}
                        style={{ borderRadius: 7 }}
                      />
                      <Skeleton
                        width={80}
                        height={14}
                        backgroundColor={skeletonBg}
                        highlightColor={skeletonHighlight}
                        style={{ borderRadius: radiusPixels.sm }}
                      />
                    </View>
                  </View>

                  {/* Stats Row skeleton */}
                  <View style={[styles.ratingStatsRow, { borderTopColor: colors.border }]}>
                    <View style={styles.ratingStatItem}>
                      <Skeleton
                        width={16}
                        height={16}
                        backgroundColor={skeletonBg}
                        highlightColor={skeletonHighlight}
                        style={{ borderRadius: 8 }}
                      />
                      <Skeleton
                        width={90}
                        height={14}
                        backgroundColor={skeletonBg}
                        highlightColor={skeletonHighlight}
                        style={{ borderRadius: radiusPixels.sm }}
                      />
                    </View>
                    <View style={[styles.ratingStatDivider, { backgroundColor: colors.border }]} />
                    <View style={styles.ratingStatItem}>
                      <Skeleton
                        width={16}
                        height={16}
                        backgroundColor={skeletonBg}
                        highlightColor={skeletonHighlight}
                        style={{ borderRadius: 8 }}
                      />
                      <Skeleton
                        width={90}
                        height={14}
                        backgroundColor={skeletonBg}
                        highlightColor={skeletonHighlight}
                        style={{ borderRadius: radiusPixels.sm }}
                      />
                    </View>
                  </View>

                  {/* Action Buttons skeleton */}
                  <View style={styles.ratingActions}>
                    <Skeleton
                      width="100%"
                      height={40}
                      backgroundColor={skeletonBg}
                      highlightColor={skeletonHighlight}
                      style={{ borderRadius: radiusPixels.lg }}
                    />
                    <Skeleton
                      width="100%"
                      height={40}
                      backgroundColor={skeletonBg}
                      highlightColor={skeletonHighlight}
                      style={{ borderRadius: radiusPixels.lg }}
                    />
                  </View>
                </>
              ) : ratingInfo ? (
                <>
                  {/* Rating Badge with Certification Status */}
                  <View
                    style={[
                      styles.ratingBadge,
                      {
                        backgroundColor: certColors.background,
                        borderColor: certColors.border,
                      },
                    ]}
                  >
                    <Text style={[styles.ratingBadgeText, { color: certColors.text }]}>
                      {ratingInfo.displayLabel}
                    </Text>
                    <View style={styles.certificationStatusRow}>
                      <Ionicons
                        name={
                          certificationStatus === 'certified'
                            ? 'checkmark-circle'
                            : certificationStatus === 'disputed'
                              ? 'alert-circle'
                              : 'shield-outline'
                        }
                        size={14}
                        color={certColors.text}
                      />
                      <Text style={[styles.certificationStatusText, { color: certColors.text }]}>
                        {certificationStatus === 'certified'
                          ? t('profile.certification.badge.certified')
                          : certificationStatus === 'disputed'
                            ? t('profile.certification.badge.disputed')
                            : t('profile.certification.badge.selfDeclared')}
                      </Text>
                    </View>
                  </View>

                  {/* Stats Row */}
                  <View style={[styles.ratingStatsRow, { borderTopColor: colors.border }]}>
                    <View style={styles.ratingStatItem}>
                      <Ionicons name="people-outline" size={16} color={colors.textMuted} />
                      <Text
                        style={[styles.ratingStatText, { color: colors.text }]}
                        numberOfLines={1}
                      >
                        {t('profile.rating.references', { count: referencesCount })}
                      </Text>
                    </View>
                    <View style={[styles.ratingStatDivider, { backgroundColor: colors.border }]} />
                    <View style={styles.ratingStatItem}>
                      <Ionicons name="document-text-outline" size={16} color={colors.textMuted} />
                      <Text
                        style={[styles.ratingStatText, { color: colors.text }]}
                        numberOfLines={1}
                      >
                        {t('profile.rating.ratingProof', { count: currentLevelProofsCount })}
                      </Text>
                    </View>
                  </View>

                  {/* Action Buttons */}
                  <View style={styles.ratingActions}>
                    <TouchableOpacity
                      style={[styles.ratingActionButton, { borderColor: colors.border }]}
                      onPress={() => {
                        SheetManager.show('reference-request', {
                          payload: {
                            currentUserId: userId,
                            sportId,
                            currentUserRatingScore: ratingInfo?.scoreValue,
                            currentUserRatingScoreId: playerRatingScoreId || undefined,
                            ratingSystemCode: ratingInfo?.ratingTypeName?.toUpperCase(),
                            onSendRequests: handleSendReferenceRequests,
                          },
                        });
                      }}
                    >
                      <Ionicons name="person-add-outline" size={16} color={colors.primary} />
                      <Text style={[styles.ratingActionText, { color: colors.primary }]}>
                        {t('profile.rating.requestReference')}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.ratingActionButton, { borderColor: colors.border }]}
                      onPress={handleManageProofs}
                    >
                      <Ionicons name="folder-open-outline" size={16} color={colors.primary} />
                      <Text style={[styles.ratingActionText, { color: colors.primary }]}>
                        {t('profile.rating.manageRatingProofs')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <View style={styles.noRatingContainer}>
                  <Text style={[styles.noRatingText, { color: colors.text }]}>
                    {t('profile.status.noRating')}
                  </Text>
                  <Text style={[styles.noRatingSubtext, { color: colors.textMuted }]}>
                    {t('profile.status.noRatingSubtext')}
                  </Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* My Preferences Section - Only show when active */}
        {isActive && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>
                {t('profile.sections.preferences')}
              </Text>
              <TouchableOpacity
                style={styles.editIconButton}
                onPress={() => {
                  selectionHaptic();
                  if (sportName.toLowerCase() === 'tennis') {
                    SheetManager.show('tennis-preferences', {
                      payload: {
                        onSave: handleSavePreferences,
                        initialPreferences: {
                          matchDuration: preferences.matchDuration || undefined,
                          matchType: preferences.matchType || undefined,
                          court: preferences.facilityName || undefined,
                          playStyle: preferences.playingStyle || undefined,
                          playAttributes: preferences.playAttributes || undefined,
                        },
                        playStyleOptions,
                        playAttributesByCategory,
                        loadingPlayOptions,
                        playerId: userId,
                        sportId,
                        latitude: location?.latitude ?? null,
                        longitude: location?.longitude ?? null,
                      },
                    });
                  } else if (sportName.toLowerCase() === 'pickleball') {
                    SheetManager.show('pickleball-preferences', {
                      payload: {
                        onSave: handleSavePreferences,
                        initialPreferences: {
                          matchDuration: preferences.matchDuration || undefined,
                          matchType: preferences.matchType || undefined,
                          court: preferences.facilityName || undefined,
                          playStyle: preferences.playingStyle || undefined,
                          playAttributes: preferences.playAttributes || undefined,
                        },
                        playStyleOptions,
                        playAttributesByCategory,
                        loadingPlayOptions,
                        playerId: userId,
                        sportId,
                        latitude: location?.latitude ?? null,
                        longitude: location?.longitude ?? null,
                      },
                    });
                  }
                }}
              >
                <Ionicons name="create-outline" size={20} color={colors.primary} />
              </TouchableOpacity>
            </View>

            <View
              style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              {loadingPreferences ? (
                <>
                  <View style={[styles.preferenceRow, { borderBottomColor: colors.border }]}>
                    <Text style={[styles.preferenceLabel, { color: colors.textMuted }]}>
                      {t('profile.fields.matchDuration')}
                    </Text>
                    <Skeleton
                      width={70}
                      height={14}
                      backgroundColor={skeletonBg}
                      highlightColor={skeletonHighlight}
                      style={{ borderRadius: radiusPixels.sm }}
                    />
                  </View>
                  <View style={[styles.preferenceRow, { borderBottomColor: colors.border }]}>
                    <Text style={[styles.preferenceLabel, { color: colors.textMuted }]}>
                      {t('profile.fields.matchType')}
                    </Text>
                    <Skeleton
                      width={60}
                      height={14}
                      backgroundColor={skeletonBg}
                      highlightColor={skeletonHighlight}
                      style={{ borderRadius: radiusPixels.sm }}
                    />
                  </View>
                  <View style={[styles.preferenceRow, { borderBottomColor: colors.border }]}>
                    <Text style={[styles.preferenceLabel, { color: colors.textMuted }]}>
                      {t('profile.fields.favoriteFacilities')}
                    </Text>
                    <Skeleton
                      width={110}
                      height={14}
                      backgroundColor={skeletonBg}
                      highlightColor={skeletonHighlight}
                      style={{ borderRadius: radiusPixels.sm }}
                    />
                  </View>
                  <View style={[styles.preferenceRow, { borderBottomWidth: 0 }]}>
                    <Text style={[styles.preferenceLabel, { color: colors.textMuted }]}>
                      {t('profile.fields.playingStyle')}
                    </Text>
                    <Skeleton
                      width={90}
                      height={14}
                      backgroundColor={skeletonBg}
                      highlightColor={skeletonHighlight}
                      style={{ borderRadius: radiusPixels.sm }}
                    />
                  </View>
                </>
              ) : (
                <>
                  {/* Match Duration */}
                  <View style={[styles.preferenceRow, { borderBottomColor: colors.border }]}>
                    <Text style={[styles.preferenceLabel, { color: colors.textMuted }]}>
                      {t('profile.fields.matchDuration')}
                    </Text>
                    <Text style={[styles.preferenceValue, { color: colors.text }]}>
                      {formatMatchDuration(preferences.matchDuration)}
                    </Text>
                  </View>

                  {/* Match Type */}
                  <View style={[styles.preferenceRow, { borderBottomColor: colors.border }]}>
                    <Text style={[styles.preferenceLabel, { color: colors.textMuted }]}>
                      {t('profile.fields.matchType')}
                    </Text>
                    <Text style={[styles.preferenceValue, { color: colors.text }]}>
                      {formatMatchType(preferences.matchType)}
                    </Text>
                  </View>

                  {/* Favorite Facilities */}
                  <View style={[styles.preferenceRow, { borderBottomColor: colors.border }]}>
                    <Text style={[styles.preferenceLabel, { color: colors.textMuted }]}>
                      {t('profile.fields.favoriteFacilities')}
                    </Text>
                    <View style={styles.facilitiesContainer}>
                      {loadingFavorites ? (
                        <Skeleton
                          width={120}
                          height={16}
                          backgroundColor={skeletonBg}
                          highlightColor={skeletonHighlight}
                        />
                      ) : favoriteFacilities.length > 0 ? (
                        favoriteFacilities.map(fav => (
                          <Text
                            key={fav.id}
                            style={[styles.facilityText, { color: colors.text }]}
                            numberOfLines={1}
                          >
                            {fav.facility?.name || t('profile.notSet')}
                          </Text>
                        ))
                      ) : (
                        <Text style={[styles.preferenceValue, { color: colors.text }]}>
                          {t('profile.notSet')}
                        </Text>
                      )}
                    </View>
                  </View>

                  {/* Playing Style (for Tennis: Server & Volley, etc.) */}
                  <View
                    style={[
                      styles.preferenceRow,
                      preferences.playAttributes && preferences.playAttributes.length > 0
                        ? { borderBottomColor: colors.border }
                        : { borderBottomWidth: 0 },
                    ]}
                  >
                    <Text style={[styles.preferenceLabel, { color: colors.textMuted }]}>
                      {t('profile.fields.playingStyle')}
                    </Text>
                    <Text style={[styles.preferenceValue, { color: colors.text }]}>
                      {formatPlayingStyle(preferences.playingStyle)}
                    </Text>
                  </View>

                  {/* Play Attributes */}
                  {preferences.playAttributes && preferences.playAttributes.length > 0 && (
                    <View
                      style={[
                        styles.preferenceRow,
                        { borderBottomWidth: 0, flexDirection: 'column', alignItems: 'flex-start' },
                      ]}
                    >
                      <Text
                        style={[
                          styles.preferenceLabel,
                          { color: colors.textMuted, marginBottom: spacingPixels[2] },
                        ]}
                      >
                        {t('profile.fields.playAttributes')}
                      </Text>
                      <View style={styles.attributeTags}>
                        {preferences.playAttributes.map((attr: string, index: number) => (
                          <View
                            key={index}
                            style={[
                              styles.attributeTag,
                              {
                                backgroundColor: isDark ? `${primary[400]}30` : `${primary[500]}15`,
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.attributeTagText,
                                { color: isDark ? primary[400] : primary[500] },
                              ]}
                            >
                              {formatPlayAttribute(attr)}
                            </Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  )}
                </>
              )}
            </View>
          </View>
        )}

        {/* Deactivate Sport */}
        {isActive && playerSportId && (
          <Button
            variant="outline"
            size="sm"
            onPress={handleDeactivateSport}
            leftIcon={<Ionicons name="close-circle-outline" size={18} color={colors.textMuted} />}
            isDark={isDark}
            style={styles.deactivateButton}
          >
            {t('profile.sport.deactivateSport')}
          </Button>
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  card: {
    borderRadius: radiusPixels.xl,
    padding: spacingPixels[4],
    borderWidth: 1,
  },
  deactivateButton: {
    marginTop: spacingPixels[4],
  },
  section: {
    marginBottom: spacingPixels[4],
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacingPixels[3],
  },
  sectionTitle: {
    fontSize: fontSizePixels.xs,
    fontWeight: fontWeightNumeric.bold,
    letterSpacing: 1,
  },
  editIconButton: {
    padding: spacingPixels[1],
  },
  ratingBadge: {
    alignItems: 'center',
    paddingHorizontal: spacingPixels[5],
    paddingVertical: spacingPixels[3],
    borderRadius: radiusPixels.xl,
    borderWidth: 1.5,
    gap: spacingPixels[1.5],
  },
  ratingBadgeText: {
    fontSize: fontSizePixels.xl,
    fontWeight: fontWeightNumeric.bold,
  },
  certificationStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
  },
  certificationStatusText: {
    fontSize: fontSizePixels.sm,
    fontWeight: fontWeightNumeric.semibold,
  },
  ratingStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    marginTop: spacingPixels[4],
    paddingTop: spacingPixels[3],
  },
  ratingStatItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[1.5],
  },
  ratingStatDivider: {
    width: 1,
    height: 16,
  },
  ratingStatText: {
    fontSize: fontSizePixels.sm,
    fontWeight: fontWeightNumeric.semibold,
    flexShrink: 1,
  },
  ratingActions: {
    flexDirection: 'column',
    gap: spacingPixels[2],
    marginTop: spacingPixels[3],
  },
  ratingActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[1.5],
    paddingVertical: spacingPixels[2.5],
    paddingHorizontal: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
  },
  ratingActionText: {
    fontSize: fontSizePixels.sm,
    fontWeight: fontWeightNumeric.semibold,
  },
  noRatingContainer: {
    alignItems: 'center',
    paddingVertical: spacingPixels[6],
  },
  noRatingText: {
    fontSize: fontSizePixels.base,
    fontWeight: fontWeightNumeric.semibold,
    marginBottom: spacingPixels[2],
  },
  noRatingSubtext: {
    fontSize: fontSizePixels.sm,
  },
  preferenceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacingPixels[3],
    borderBottomWidth: 1,
  },
  preferenceLabel: {
    fontSize: fontSizePixels.sm,
  },
  preferenceValue: {
    fontSize: fontSizePixels.sm,
    fontWeight: fontWeightNumeric.semibold,
  },
  attributeTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacingPixels[2],
  },
  attributeTag: {
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[1.5],
    borderRadius: radiusPixels.full,
  },
  attributeTagText: {
    fontSize: fontSizePixels.xs,
    fontWeight: fontWeightNumeric.medium,
  },
  facilitiesContainer: {
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 2,
    flex: 1,
    marginLeft: spacingPixels[4],
  },
  facilityText: {
    fontSize: fontSizePixels.sm,
    fontWeight: fontWeightNumeric.semibold,
    textAlign: 'right',
  },
});

export default SportProfile;
