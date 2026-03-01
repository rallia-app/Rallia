import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRoute, useFocusEffect } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import { useAppNavigation } from '../navigation/hooks';
import type { RootStackParamList } from '../navigation/types';
import { Text, Button, Skeleton, useToast } from '@rallia/shared-components';
import { supabase, Logger } from '@rallia/shared-services';
import { usePlayPreferences, useFavoriteFacilities } from '@rallia/shared-hooks';
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

const BASE_BLACK = '#000000';

// Certification status colors for rating display
const getCertificationColors = (status: 'self_declared' | 'certified' | 'disputed') => {
  switch (status) {
    case 'certified':
      return {
        background: '#E8F5E9',
        border: '#4CAF50',
        text: '#4CAF50',
      };
    case 'disputed':
      return {
        background: '#FFEBEE',
        border: '#F44336',
        text: '#F44336',
      };
    case 'self_declared':
    default:
      return {
        background: '#FFF8E1',
        border: '#FFC107',
        text: '#F57C00',
      };
  }
};

import { mediumHaptic, selectionHaptic } from '@rallia/shared-utils';
import { withTimeout, getNetworkErrorMessage } from '../utils/networkTimeout';
import { SheetManager } from 'react-native-actions-sheet';
import { CertificationSection } from '../features/ratings/components';

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

  // Fetch play styles and attributes for this sport
  const {
    playStyles: playStyleOptions,
    playAttributesByCategory,
    loading: loadingPlayOptions,
  } = usePlayPreferences(sportId);

  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string>('');
  const [isActive, setIsActive] = useState(false);
  const [playerSportId, setPlayerSportId] = useState<string | null>(null);
  const [playerRatingScoreId, setPlayerRatingScoreId] = useState<string | null>(null);
  const [ratingInfo, setRatingInfo] = useState<RatingInfo | null>(null);
  // Total proofs count (all proofs for this sport) - shown in "Rating Proof" button
  const [totalProofsCount, setTotalProofsCount] = useState(0);
  // Current-level proofs count (proofs matching current rating) - used for certification
  const [currentLevelProofsCount, setCurrentLevelProofsCount] = useState(0);
  const [referencesCount, setReferencesCount] = useState(0);
  const [certificationStatus, setCertificationStatus] = useState<
    'self_declared' | 'certified' | 'disputed'
  >('self_declared');
  const [peerEvaluationAverage, setPeerEvaluationAverage] = useState<number | undefined>(undefined);
  const [peerEvaluationCount, setPeerEvaluationCount] = useState<number>(0);
  const [preferences, setPreferences] = useState<PreferencesInfo>({
    matchDuration: null,
    matchType: null,
    facilityName: null,
    playingStyle: null,
    playAttributes: null,
  });

  // Fetch user's favorite facilities
  const {
    favorites: favoriteFacilities,
    loading: loadingFavorites,
    refetch: refetchFavorites,
  } = useFavoriteFacilities(userId);

  useEffect(() => {
    fetchSportProfileData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh proof counts when returning to this screen
  const refreshProofCounts = useCallback(async () => {
    if (!playerRatingScoreId || !ratingInfo?.ratingScoreId) return;

    // Fetch all proofs for this player_rating_score (total count)
    const { data: proofs, error } = await supabase
      .from('rating_proof')
      .select('rating_score_id')
      .eq('player_rating_score_id', playerRatingScoreId)
      .eq('is_active', true);

    if (!error && proofs) {
      // Total count: all proofs for this sport
      setTotalProofsCount(proofs.length);

      // Current-level count: only proofs matching current rating_score_id
      const currentLevelCount = proofs.filter(
        p => p.rating_score_id === ratingInfo.ratingScoreId
      ).length;
      setCurrentLevelProofsCount(currentLevelCount);
    }
  }, [playerRatingScoreId, ratingInfo?.ratingScoreId]);

  useFocusEffect(
    useCallback(() => {
      refreshProofCounts();
    }, [refreshProofCounts])
  );

  const fetchSportProfileData = async () => {
    try {
      setLoading(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        Alert.alert(t('alerts.error'), t('errors.userNotAuthenticated'));
        return;
      }
      setUserId(user.id);

      // Fetch both queries in parallel for better performance
      const [playerSportResult, ratingResult] = await Promise.all([
        // Fetch player's sport connection including play preferences
        withTimeout(
          (async () =>
            supabase
              .from('player_sport')
              .select('id, is_active, preferred_match_duration, preferred_match_type, is_primary')
              .eq('player_id', user.id)
              .eq('sport_id', sportId)
              .maybeSingle())(),
          15000,
          'Failed to load sport profile - connection timeout'
        ),

        // Fetch player's ratings with certification badge data
        withTimeout(
          (async () =>
            supabase
              .from('player_rating_score')
              .select(
                `
              id,
              rating_score_id,
              is_certified,
              certified_at,
              badge_status,
              referrals_count,
              approved_proofs_count,
              peer_evaluation_average,
              peer_evaluation_count,
              rating_score:rating_score_id (
                id,
                value,
                label,
                description,
                skill_level,
                rating_system:rating_system_id (
                  code,
                  name,
                  description,
                  min_value,
                  max_value,
                  sport_id
                )
              )
            `
              )
              .eq('player_id', user.id))(),
          15000,
          'Failed to load ratings - connection timeout'
        ),
      ]);

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

      // Only process rating data if sport is active
      if (playerSportData?.is_active) {
        const { data: ratingDataList, error: ratingError } = ratingResult;

        if (ratingError && ratingError.code !== 'PGRST116') {
          Logger.error('Failed to fetch player ratings', ratingError as Error, {
            playerId: user.id,
            sportId,
          });
        }

        Logger.debug('ratings_fetched', { count: ratingDataList?.length, sportName, sportId });

        // Filter by sport_id in JavaScript since nested filtering doesn't work well
        const ratingData =
          ratingDataList?.find(item => {
            const ratingScore = item.rating_score as {
              id?: string;
              rating_system?: { sport_id?: string };
            } | null;
            return ratingScore?.rating_system?.sport_id === sportId;
          }) || null;

        Logger.debug('rating_data_search_complete', { sportName, found: !!ratingData });

        if (ratingData) {
          const ratingScore = ratingData.rating_score as {
            id?: string;
            label?: string;
            value?: number;
            description?: string;
            skill_level?: string | null;
            rating_system?: {
              name?: string;
              code?: string;
              min_value?: number;
              max_value?: number;
              description?: string;
            };
          } | null;
          const ratingSystem = ratingScore?.rating_system;
          const newRatingInfo = {
            ratingScoreId: ratingScore?.id || ratingData.rating_score_id || '',
            ratingTypeName: ratingSystem?.code || ratingSystem?.name || '',
            displayLabel: ratingScore?.label || '',
            scoreValue: ratingScore?.value || 0,
            skillLevel: ratingScore?.skill_level
              ? ratingScore.skill_level.charAt(0).toUpperCase() + ratingScore.skill_level.slice(1)
              : '',
            isVerified: ratingData.is_certified || false,
            verifiedAt: ratingData.certified_at || null,
            minValue: ratingSystem?.min_value || 0,
            maxValue: ratingSystem?.max_value || 10,
            description: ratingSystem?.description || '',
          };
          Logger.debug('rating_info_set', {
            ratingScoreId: newRatingInfo.ratingScoreId,
            displayLabel: newRatingInfo.displayLabel,
          });
          setRatingInfo(newRatingInfo);
          setPlayerRatingScoreId(ratingData.id || null);

          // Get counts for certification logic
          const referralsCount = ratingData.referrals_count || 0;
          const badgeStatus = ratingData.badge_status as string | undefined;

          // Set references count
          setReferencesCount(referralsCount);

          // Set peer evaluation data
          setPeerEvaluationAverage(ratingData.peer_evaluation_average || undefined);
          setPeerEvaluationCount(ratingData.peer_evaluation_count || 0);

          // Fetch rating proofs for this player_rating_score
          // We need both total count and current-level count
          let totalCount = 0;
          let currentLevelCount = 0;
          const currentRatingScoreId = newRatingInfo.ratingScoreId;

          if (ratingData.id) {
            // Fetch all proofs with their rating_score_id
            const { data: proofs, error: proofsError } = await supabase
              .from('rating_proof')
              .select('rating_score_id')
              .eq('player_rating_score_id', ratingData.id)
              .eq('is_active', true);

            if (!proofsError && proofs) {
              // Total proofs count (for "Rating Proof" button in My Rating section)
              totalCount = proofs.length;
              setTotalProofsCount(totalCount);

              // Current-level proofs count (proofs that match current rating_score_id)
              // Used for certification logic
              currentLevelCount = proofs.filter(
                p => p.rating_score_id === currentRatingScoreId
              ).length;
              setCurrentLevelProofsCount(currentLevelCount);
            } else {
              setTotalProofsCount(0);
              setCurrentLevelProofsCount(0);
            }
          } else {
            setTotalProofsCount(0);
            setCurrentLevelProofsCount(0);
          }

          // Determine certification status based on counts:
          // - certified (green): badge_status is 'certified' OR 3+ references OR 2+ current-level proofs
          // - disputed (red): badge_status is 'disputed'
          // - self_declared (yellow): default when criteria not met
          // NOTE: Only CURRENT-LEVEL proofs count for certification
          if (badgeStatus === 'disputed') {
            setCertificationStatus('disputed');
          } else if (badgeStatus === 'certified' || referralsCount >= 3 || currentLevelCount >= 2) {
            setCertificationStatus('certified');
          } else {
            setCertificationStatus('self_declared');
          }
        } else {
          Logger.debug('no_rating_data_found', { sportName, sportId });
          setRatingInfo(null);
          setPlayerRatingScoreId(null);
          setTotalProofsCount(0);
          setCurrentLevelProofsCount(0);
        }
      }
    } catch (error) {
      Logger.error('Failed to fetch sport profile data', error as Error, { sportId, sportName });
      Alert.alert(t('alerts.error'), getNetworkErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const handleSaveRating = async (ratingScoreId: string) => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        Alert.alert(t('alerts.error'), t('errors.userNotAuthenticated'));
        return;
      }

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
            .eq('player_id', user.id))(),
        15000,
        'Failed to fetch ratings - connection timeout'
      );

      const { data: allPlayerRatings, error: fetchError } = ratingsResult;

      if (fetchError) {
        Logger.error('Failed to fetch player ratings', fetchError as Error, { playerId: user.id });
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

        return itemSportId === sportId && source === 'self_reported';
      });

      Logger.debug('existing_rating_check', {
        sportId,
        existingId: existingSelfReportedRating?.id,
        existingRatingScoreId: existingSelfReportedRating?.rating_score_id,
      });

      if (existingSelfReportedRating) {
        // UPDATE the existing record instead of deleting it
        // This preserves the player_rating_score_id and keeps all proofs linked!
        Logger.debug('updating_existing_rating', {
          existingId: existingSelfReportedRating.id,
          newRatingScoreId: ratingScoreId,
        });

        const updateResult = await withTimeout(
          (async () =>
            supabase
              .from('player_rating_score')
              .update({
                rating_score_id: ratingScoreId,
                is_certified: false, // Reset certification when rating changes
                badge_status: 'self_declared', // Reset badge status
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

        Logger.info('rating_updated', {
          ratingId: existingSelfReportedRating.id,
          ratingScoreId,
          sportId,
        });
      } else {
        // No existing rating - INSERT a new one
        Logger.debug('inserting_new_rating', { ratingScoreId, playerId: user.id });
        const insertResult = await withTimeout(
          (async () =>
            supabase.from('player_rating_score').insert({
              player_id: user.id,
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
            playerId: user.id,
          });
          throw insertResult.error;
        }

        Logger.info('rating_inserted', { ratingScoreId, sportId });
      }

      Logger.info('rating_save_complete', { ratingScoreId, sportId, sourceType: 'self_reported' });

      // Close overlays first
      SheetManager.hide('tennis-rating');
      SheetManager.hide('pickleball-rating');

      // Clear current rating state to force refresh
      setRatingInfo(null);

      // Add a small delay to ensure database has committed the transaction
      await new Promise(resolve => setTimeout(resolve, 500));

      // Refresh data
      Logger.debug('refreshing_sport_profile_data', { sportId });
      await fetchSportProfileData();
      Logger.debug('sport_profile_data_refreshed', { sportId });

      // Show success message
      toast.success(t('alerts.availabilitiesUpdated'));
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

  const handleToggleActive = async (newValue: boolean) => {
    try {
      mediumHaptic();

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        Alert.alert(t('alerts.error'), t('errors.userNotAuthenticated'));
        return;
      }

      // Check if user is trying to deactivate their last active sport
      if (!newValue && playerSportId) {
        const { count, error: countError } = await withTimeout(
          (async () =>
            supabase
              .from('player_sport')
              .select('id', { count: 'exact', head: true })
              .eq('player_id', user.id)
              .eq('is_active', true))(),
          10000,
          'Failed to check active sports - connection timeout'
        );

        if (countError) {
          Logger.error('Failed to count active sports', countError as Error, {
            playerId: user.id,
          });
          throw countError;
        }

        // If user only has 1 active sport (this one), prevent deactivation
        if (count !== null && count <= 1) {
          Alert.alert(t('alerts.cannotDeactivate'), t('alerts.mustHaveOneSport'));
          return;
        }
      }

      if (playerSportId) {
        // Entry exists: Update is_active field
        const updateResult = await withTimeout(
          (async () =>
            supabase
              .from('player_sport')
              .update({ is_active: newValue })
              .eq('id', playerSportId))(),
          10000,
          'Failed to update availability - connection timeout'
        );

        if (updateResult.error) throw updateResult.error;

        setIsActive(newValue);

        // Show success message
        const message = newValue
          ? t('alerts.sportActivated', { sport: sportName })
          : t('alerts.sportDeactivated', { sport: sportName });

        toast.success(message);

        // Refresh SportContext to update userSports across the app
        refetchSportContext();

        // Refresh data if activated
        if (newValue) {
          await fetchSportProfileData();
        }
      } else {
        // No entry exists
        if (newValue) {
          // User wants to play this sport: Create new entry with is_active = true
          const insertResult = await withTimeout(
            (async () =>
              supabase
                .from('player_sport')
                .insert({
                  player_id: user.id,
                  sport_id: sportId,
                  is_active: true,
                  is_primary: false,
                })
                .select('id')
                .single())(),
            10000,
            'Failed to create sport profile - connection timeout'
          );

          if (insertResult.error) throw insertResult.error;
          const { data: newRecord } = insertResult;
          if (newRecord) setPlayerSportId(newRecord.id);

          setIsActive(true);

          // Show success message
          const message = t('alerts.sportAdded', { sport: sportName });
          toast.success(message);

          // Refresh SportContext to update userSports across the app
          refetchSportContext();

          // Refresh data to load ratings and preferences
          await fetchSportProfileData();
        } else {
          // User doesn't want to play this sport: Don't create entry, just update UI
          setIsActive(false);

          // Optional: Show a subtle message
          toast.info(t('alerts.sportNotAdded', { sport: sportName }));
        }
      }
    } catch (error) {
      Logger.error('Failed to toggle sport active status', error as Error, { sportId, sportName });
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

  const handleSavePreferences = async (updatedPreferences: {
    matchDuration?: string;
    matchType?: string;
    court?: string;
    playStyle?: string;
    playAttributes?: string[];
  }) => {
    try {
      if (!playerSportId) {
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
            .eq('id', playerSportId))(),
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
          .eq('player_sport_id', playerSportId);

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
            player_sport_id: playerSportId,
            play_style_id: playStyleData.id,
          });
        }
      } else {
        // If no play style selected, delete any existing
        await supabase
          .from('player_sport_play_style')
          .delete()
          .eq('player_sport_id', playerSportId);
      }

      // 3. Save play attributes to junction table (if provided)
      // First, delete existing play attributes for this player_sport
      await supabase
        .from('player_sport_play_attribute')
        .delete()
        .eq('player_sport_id', playerSportId);

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
            player_sport_id: playerSportId,
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

      // Refetch favorites
      refetchFavorites();

      // Show success message
      toast.success(t('alerts.preferencesUpdated'));

      // Refresh data
      await fetchSportProfileData();
    } catch (error) {
      Logger.error('Failed to save sport preferences', error as Error, { sportId, playerSportId });
      toast.error(getNetworkErrorMessage(error));
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={[]}>
        <View style={styles.loadingContainer}>
          {/* Sport Profile Skeleton */}
          <View style={[styles.card, { backgroundColor: colors.card }]}>
            <Skeleton
              width={180}
              height={18}
              borderRadius={4}
              backgroundColor={colors.cardBackground}
              highlightColor={colors.border}
            />
            <View style={{ marginTop: 12, flexDirection: 'row', gap: 12 }}>
              <Skeleton
                width={80}
                height={40}
                borderRadius={8}
                backgroundColor={colors.cardBackground}
                highlightColor={colors.border}
              />
              <Skeleton
                width={80}
                height={40}
                borderRadius={8}
                backgroundColor={colors.cardBackground}
                highlightColor={colors.border}
              />
            </View>
          </View>
          <View style={[styles.card, { backgroundColor: colors.card, marginTop: 16 }]}>
            <Skeleton
              width={120}
              height={18}
              borderRadius={4}
              backgroundColor={colors.cardBackground}
              highlightColor={colors.border}
            />
            <Skeleton
              width="100%"
              height={60}
              borderRadius={12}
              backgroundColor={colors.cardBackground}
              highlightColor={colors.border}
              style={{ marginTop: 12 }}
            />
          </View>
          <View style={[styles.card, { backgroundColor: colors.card, marginTop: 16 }]}>
            <Skeleton
              width={150}
              height={18}
              borderRadius={4}
              backgroundColor={colors.cardBackground}
              highlightColor={colors.border}
            />
            <View style={{ marginTop: 12, gap: 8 }}>
              <Skeleton
                width="100%"
                height={48}
                borderRadius={8}
                backgroundColor={colors.cardBackground}
                highlightColor={colors.border}
              />
              <Skeleton
                width="100%"
                height={48}
                borderRadius={8}
                backgroundColor={colors.cardBackground}
                highlightColor={colors.border}
              />
              <Skeleton
                width="100%"
                height={48}
                borderRadius={8}
                backgroundColor={colors.cardBackground}
                highlightColor={colors.border}
              />
            </View>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={[]}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* Do you play this sport? Toggle */}
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={[styles.questionText, { color: colors.text }]}>
            {t('profile.doYouPlay', { sport: sportName })}
          </Text>
          <View style={styles.toggleContainer}>
            <TouchableOpacity
              style={[
                styles.toggleButton,
                {
                  borderColor: colors.border,
                  backgroundColor: colors.inputBackground,
                },
                isActive && [
                  styles.toggleButtonActive,
                  { backgroundColor: colors.primary, borderColor: colors.primary },
                ],
              ]}
              onPress={() => handleToggleActive(true)}
            >
              <Text
                style={[
                  styles.toggleButtonText,
                  { color: colors.textMuted },
                  ...(isActive
                    ? [styles.toggleButtonTextActive, { color: colors.primaryForeground }]
                    : []),
                ]}
              >
                {t('common.yes')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.toggleButton,
                {
                  borderColor: colors.border,
                  backgroundColor: colors.inputBackground,
                },
                !isActive && [
                  styles.toggleButtonInactive,
                  { backgroundColor: colors.error, borderColor: colors.error },
                ],
              ]}
              onPress={() => handleToggleActive(false)}
            >
              <Text
                style={[
                  styles.toggleButtonText,
                  { color: colors.textMuted },
                  ...(!isActive
                    ? [styles.toggleButtonTextActive, { color: colors.primaryForeground }]
                    : []),
                ]}
              >
                {t('common.no')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Show blank space when not active */}
        {!isActive && (
          <View style={styles.inactiveContainer}>
            <Ionicons name="information-circle-outline" size={48} color={colors.textMuted} />
            <Text style={[styles.inactiveText, { color: colors.textMuted }]}>
              {t('profile.activateSportMessage', { sport: sportName })}
            </Text>
          </View>
        )}

        {/* My Rating Section - Only show when active */}
        {isActive && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>
                {t('profile.sections.rating')}
              </Text>
              <TouchableOpacity
                style={styles.editIconButton}
                onPress={() => {
                  // Determine which overlay to show based on sport name
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

            <View style={[styles.card, { backgroundColor: colors.card }]}>
              {ratingInfo ? (
                <>
                  {/* Rating Level Display */}
                  <View style={styles.ratingDisplay}>
                    <View
                      style={[
                        styles.ratingBadgeLarge,
                        {
                          backgroundColor: getCertificationColors(certificationStatus).background,
                          borderWidth: 2,
                          borderColor: getCertificationColors(certificationStatus).border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.ratingLevelText,
                          { color: getCertificationColors(certificationStatus).text },
                        ]}
                      >
                        {ratingInfo.displayLabel}
                      </Text>
                      <Text style={[styles.ratingTypeText, { color: colors.textMuted }]}>
                        {ratingInfo.ratingTypeName}
                      </Text>
                    </View>
                    {ratingInfo.isVerified && (
                      <View style={styles.verifiedBadge}>
                        <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                        <Text style={[styles.verifiedText, { color: colors.text }]}>
                          {t('profile.status.certified')}
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Rating Description */}
                  {ratingInfo.description && (
                    <Text style={[styles.ratingDescription, { color: colors.textMuted }]}>
                      {ratingInfo.description}
                    </Text>
                  )}

                  {/* Rating Details */}
                  <View style={[styles.ratingDetails, { borderTopColor: colors.border }]}>
                    <View style={styles.ratingDetailRow}>
                      <Text style={[styles.detailLabel, { color: colors.textMuted }]}>
                        {t('profile.rating.skillLevel')}:
                      </Text>
                      <Text style={[styles.detailValue, { color: colors.text }]}>
                        {ratingInfo.skillLevel || 'N/A'}
                      </Text>
                    </View>
                    <View style={styles.ratingDetailRow}>
                      <Text style={[styles.detailLabel, { color: colors.textMuted }]}>
                        {t('profile.rating.score')}:
                      </Text>
                      <Text style={[styles.detailValue, { color: colors.text }]}>
                        {ratingInfo.scoreValue} / {ratingInfo.maxValue}
                      </Text>
                    </View>
                  </View>

                  {/* Action Buttons */}
                  <View style={styles.actionButtons}>
                    <Button
                      variant="outline"
                      size="sm"
                      onPress={() => {}}
                      style={styles.actionButton}
                      isDark={isDark}
                      themeColors={{
                        primary: colors.primary,
                        primaryForeground: colors.primaryForeground,
                        buttonActive: colors.buttonActive,
                        buttonInactive: colors.buttonInactive,
                        buttonTextActive: colors.buttonTextActive,
                        buttonTextInactive: colors.buttonTextInactive,
                        text: colors.text,
                        textMuted: colors.textMuted,
                        border: colors.border,
                        background: colors.background,
                      }}
                      leftIcon={<Ionicons name="people-outline" size={16} color={colors.primary} />}
                    >
                      {t('profile.rating.references', { count: referencesCount })}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onPress={handleManageProofs}
                      style={styles.actionButton}
                      isDark={isDark}
                      themeColors={{
                        primary: colors.primary,
                        primaryForeground: colors.primaryForeground,
                        buttonActive: colors.buttonActive,
                        buttonInactive: colors.buttonInactive,
                        buttonTextActive: colors.buttonTextActive,
                        buttonTextInactive: colors.buttonTextInactive,
                        text: colors.text,
                        textMuted: colors.textMuted,
                        border: colors.border,
                        background: colors.background,
                      }}
                      leftIcon={<Ionicons name="document-text" size={16} color={colors.primary} />}
                    >
                      {t('profile.rating.ratingProof', { count: totalProofsCount })}
                    </Button>
                  </View>

                  {/* Certification Status Section */}
                  <CertificationSection
                    badgeStatus={certificationStatus}
                    referencesCount={referencesCount}
                    approvedProofsCount={currentLevelProofsCount}
                    requiredReferences={3}
                    requiredProofs={2}
                    peerEvaluationAverage={peerEvaluationAverage}
                    peerEvaluationCount={peerEvaluationCount}
                    ratingSystemName={ratingInfo.ratingTypeName}
                    isOwnProfile={true}
                    onRequestReference={() => {
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
                    onManageProofs={handleManageProofs}
                    canRequestReferences={
                      ratingInfo.ratingTypeName?.toUpperCase() === 'NTRP'
                        ? ratingInfo.scoreValue >= 3.0
                        : ratingInfo.ratingTypeName?.toUpperCase() === 'DUPR'
                          ? ratingInfo.scoreValue >= 3.5
                          : true
                    }
                    minimumLevel={
                      ratingInfo.ratingTypeName?.toUpperCase() === 'NTRP'
                        ? 3.0
                        : ratingInfo.ratingTypeName?.toUpperCase() === 'DUPR'
                          ? 3.5
                          : undefined
                    }
                    currentLevel={ratingInfo.scoreValue}
                  />
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

            <View style={[styles.card, { backgroundColor: colors.card }]}>
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
                    <Skeleton width={120} height={16} />
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
              <View style={[styles.preferenceRow, { borderBottomWidth: 0 }]}>
                <Text style={[styles.preferenceLabel, { color: colors.textMuted }]}>
                  {t('profile.fields.playingStyle')}
                </Text>
                <Text style={[styles.preferenceValue, { color: colors.text }]}>
                  {formatPlayingStyle(preferences.playingStyle)}
                </Text>
              </View>

              {/* Play Attributes */}
              {preferences.playAttributes && preferences.playAttributes.length > 0 && (
                <View style={[styles.playAttributesContainer, { borderTopColor: colors.border }]}>
                  <Text style={[styles.playAttributesTitle, { color: colors.textMuted }]}>
                    {t('profile.fields.playAttributes')}
                  </Text>
                  <View style={styles.attributeTags}>
                    {preferences.playAttributes.map((attr: string, index: number) => (
                      <View
                        key={index}
                        style={[
                          styles.attributeTag,
                          { backgroundColor: isDark ? primary[900] : primary[50] },
                        ]}
                      >
                        <Text style={[styles.attributeTagText, { color: colors.primary }]}>
                          {formatPlayAttribute(attr)}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </View>
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
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backButton: {
    padding: 0,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  card: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: BASE_BLACK,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  questionText: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
    textAlign: 'center',
  },
  toggleContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  toggleButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    borderWidth: 2,
    alignItems: 'center',
  },
  toggleButtonActive: {
    // backgroundColor and borderColor applied via inline styles
  },
  toggleButtonInactive: {
    // backgroundColor and borderColor applied via inline styles
  },
  toggleButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  toggleButtonTextActive: {
    // color applied inline
  },
  inactiveContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacingPixels[12],
    marginTop: spacingPixels[8],
  },
  inactiveText: {
    fontSize: fontSizePixels.base,
    textAlign: 'center',
    marginTop: spacingPixels[4],
    lineHeight: fontSizePixels.base * 1.375,
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
  ratingDisplay: {
    alignItems: 'center',
    marginBottom: spacingPixels[4],
  },
  ratingBadgeLarge: {
    paddingHorizontal: spacingPixels[6],
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.xl,
    alignItems: 'center',
    marginBottom: spacingPixels[2],
  },
  ratingLevelText: {
    fontSize: fontSizePixels['2xl'],
    fontWeight: fontWeightNumeric.bold,
  },
  ratingTypeText: {
    fontSize: fontSizePixels.xs,
    marginTop: spacingPixels[1],
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[1.5],
    borderRadius: radiusPixels.full,
    gap: spacingPixels[1],
  },
  verifiedText: {
    fontSize: fontSizePixels.xs,
    fontWeight: fontWeightNumeric.semibold,
  },
  ratingDescription: {
    fontSize: fontSizePixels.sm,
    lineHeight: fontSizePixels.sm * 1.43,
    marginBottom: spacingPixels[4],
    textAlign: 'center',
  },
  ratingDetails: {
    borderTopWidth: 1,
    paddingTop: spacingPixels[4],
    marginBottom: spacingPixels[4],
  },
  ratingDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacingPixels[2],
  },
  detailLabel: {
    fontSize: fontSizePixels.sm,
  },
  detailValue: {
    fontSize: fontSizePixels.sm,
    fontWeight: fontWeightNumeric.semibold,
  },
  actionButtons: {
    flexDirection: 'column',
    gap: spacingPixels[2],
    marginBottom: spacingPixels[4],
  },
  actionButton: {
    width: '100%',
  },
  requestButtons: {
    gap: spacingPixels[2.5],
  },
  requestButton: {
    width: '100%',
  },
  coralButton: {},
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
  playAttributesContainer: {
    marginTop: spacingPixels[4],
    paddingTop: spacingPixels[4],
    borderTopWidth: 1,
  },
  playAttributesTitle: {
    fontSize: fontSizePixels.sm,
    fontWeight: fontWeightNumeric.semibold,
    marginBottom: spacingPixels[3],
  },
  attributeTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  attributeTag: {
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[1.5],
    borderRadius: radiusPixels.full,
  },
  attributeTagText: {
    fontSize: fontSizePixels.xs,
    fontWeight: fontWeightNumeric.semibold,
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
