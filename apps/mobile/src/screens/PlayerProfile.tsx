/**
 * PlayerProfile Screen
 *
 * Displays another player's profile information (read-only).
 * Shows player info, stats, availability, and ratings.
 * Action buttons: "Invite to Match" and "Request Reference"
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Alert,
  ActivityIndicator,
  FlatList,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { SheetManager } from 'react-native-actions-sheet';
import { useRoute, useNavigation } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Text, Skeleton, SkeletonAvatar, useToast, Button } from '@rallia/shared-components';
import { supabase, Logger, isPlayerOnline } from '@rallia/shared-services';
import { useGetOrCreateDirectConversation, usePlayerReputation } from '@rallia/shared-hooks';
import { useThemeStyles, useTranslation, type TranslationKey } from '../hooks';
import { useSport } from '../context';
import { SportIcon } from '../components/SportIcon';
import RatingBadge from '../components/RatingBadge';
import ReputationBadge from '../components/ReputationBadge';
import { withTimeout, getNetworkErrorMessage } from '../utils/networkTimeout';
import {
  getProfilePictureUrl,
  lightHaptic,
  mediumHaptic,
  formatRelativeTime,
} from '@rallia/shared-utils';
import { formatDateMonthYear } from '../utils/dateFormatting';
import type { RootStackParamList } from '../navigation/types';
import type { Profile, Player } from '@rallia/shared-types';
import { MATCH_DURATION_ENUM_LABELS } from '@rallia/shared-types';
import {
  spacingPixels,
  radiusPixels,
  fontSizePixels,
  fontWeightNumeric,
  neutral,
  status,
} from '@rallia/design-system';
import { CertificationBadge, ProofViewer, type BadgeStatus } from '../features/ratings/components';
import { useVideoThumbnail } from '../hooks/useVideoThumbnail';
import { useOgImage } from '../hooks/useOgImage';

// Types
type PlayerProfileRouteProp = RouteProp<RootStackParamList, 'PlayerProfile'>;
type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

interface SportWithRating {
  id: string;
  name: string;
  display_name: string;
  isActive: boolean;
  isPrimary: boolean;
  ratingLabel?: string;
  ratingValue?: number | null;
  ratingScoreId?: string; // The actual rating_score id (for current level)
  isCertified?: boolean;
  badgeStatus?: BadgeStatus;
  playerRatingScoreId?: string;
  referencesCount?: number;
  peerEvaluationCount?: number;
  totalProofsCount?: number; // All proofs for this sport
  currentLevelProofsCount?: number; // Proofs matching current rating level
}

interface RatingProofData {
  id: string;
  proof_type: 'external_link' | 'video' | 'image' | 'document';
  title: string;
  description: string | null;
  external_url: string | null;
  status: string;
  created_at: string;
  file?: {
    id: string;
    url: string;
    thumbnail_url: string | null;
    file_type: string;
    original_name: string;
    mime_type: string;
  } | null;
}

const PROOF_CARD_WIDTH = 140;
const PROOF_CARD_HEIGHT = 105;

interface PlayerSportPreferences {
  playerSportId: string | null;
  preferred_match_duration: string | null;
  preferred_match_type: string | null;
  preferred_play_style: string | null;
  preferred_court: string | null;
  is_primary: boolean;
  playAttributes: string[] | null;
}

interface FavoriteFacilityData {
  id: string;
  facility: {
    id: string;
    name: string;
    address: string | null;
    city: string | null;
  };
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

interface PlayerStats {
  hoursPlayed: number;
  gamesHosted: number;
  weekStreak: number;
}

/** Small card component so thumbnail hooks can be called per proof. */
const ProofGalleryCard: React.FC<{
  item: RatingProofData;
  effectiveType: string;
  typeColor: string;
  iconName: string;
  backgroundColor: string;
  onPress: () => void;
}> = ({ item, effectiveType, typeColor, iconName, backgroundColor, onPress }) => {
  const videoThumbnail = useVideoThumbnail(
    effectiveType === 'video' && !item.file?.thumbnail_url ? item.file?.url : null
  );
  const ogImage = useOgImage(effectiveType === 'external_link' ? item.external_url : null);
  const thumbnail =
    item.file?.thumbnail_url ||
    (effectiveType === 'video' ? videoThumbnail : null) ||
    (effectiveType === 'image' ? item.file?.url : null) ||
    (effectiveType === 'external_link' ? ogImage : null);

  return (
    <TouchableOpacity
      style={[styles.proofGalleryCard, { backgroundColor }]}
      activeOpacity={0.8}
      onPress={onPress}
    >
      {thumbnail ? (
        <Image
          source={{ uri: thumbnail }}
          style={styles.proofGalleryThumbnail}
          resizeMode="cover"
        />
      ) : (
        <View style={[styles.proofGalleryPlaceholder, { backgroundColor: `${typeColor}20` }]}>
          <Ionicons name={iconName as any} size={28} color={typeColor} />
        </View>
      )}
      {/* Type badge overlay */}
      <View style={[styles.proofTypeBadge, { backgroundColor: typeColor }]}>
        <Ionicons name={iconName as any} size={10} color="#fff" />
      </View>
      {/* Play icon for videos */}
      {effectiveType === 'video' && (
        <View style={styles.proofPlayOverlay}>
          <View style={[styles.proofPlayButton, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
            <Ionicons name="play" size={16} color="#fff" />
          </View>
        </View>
      )}
      {/* Title */}
      <View style={styles.proofGalleryTitleContainer}>
        <Text style={styles.proofGalleryTitle} numberOfLines={1}>
          {item.title}
        </Text>
      </View>
    </TouchableOpacity>
  );
};

const PlayerProfile = () => {
  const route = useRoute<PlayerProfileRouteProp>();
  const navigation = useNavigation<NavigationProp>();
  const { playerId, sportId } = route.params;
  const { colors, isDark } = useThemeStyles();

  // Skeleton loading colors
  const skeletonBg = isDark ? '#262626' : '#E1E9EE';
  const skeletonHighlight = isDark ? '#404040' : '#F2F8FC';
  const { t, locale } = useTranslation();
  const { selectedSport } = useSport();
  const getOrCreateDirectConversation = useGetOrCreateDirectConversation();
  const { display: reputationDisplay, loading: reputationLoading } = usePlayerReputation(playerId);
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [sports, setSports] = useState<SportWithRating[]>([]);
  const [sportPreferences, setSportPreferences] = useState<PlayerSportPreferences | null>(null);
  const [availabilities, setAvailabilities] = useState<AvailabilityGrid>({});
  const [stats, setStats] = useState<PlayerStats>({
    hoursPlayed: 0,
    gamesHosted: 0,
    weekStreak: 0,
  });
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isFavorite, setIsFavorite] = useState(false);
  const [favoriteLoading, setFavoriteLoading] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [blockLoading, setBlockLoading] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [isOnline, setIsOnline] = useState(false);
  const [favoriteFacilities, setFavoriteFacilities] = useState<FavoriteFacilityData[]>([]);
  const [favoriteFacilitiesLoading, setFavoriteFacilitiesLoading] = useState(true);
  const [referenceLoading, setReferenceLoading] = useState(false);
  const [approvedProofs, setApprovedProofs] = useState<RatingProofData[]>([]);
  const [proofsLoading, setProofsLoading] = useState(false);
  const [selectedProof, setSelectedProof] = useState<RatingProofData | null>(null);
  const [showProofViewer, setShowProofViewer] = useState(false);

  // Fetch favorite facilities for the player being viewed (separate from main data fetch)
  useEffect(() => {
    const fetchFavoriteFacilities = async () => {
      setFavoriteFacilitiesLoading(true);
      try {
        const { data, error } = await supabase
          .from('player_favorite_facility')
          .select(
            `
            id,
            facility:facility_id (
              id,
              name,
              address,
              city
            )
          `
          )
          .eq('player_id', playerId)
          .order('display_order', { ascending: true });

        if (error) {
          Logger.error('Failed to fetch favorite facilities for player', error, { playerId });
          setFavoriteFacilities([]);
        } else {
          // Map data - facility comes as object from Supabase FK join
          const mapped = (data || [])
            .map(item => {
              const facility = item.facility as unknown as
                | FavoriteFacilityData['facility']
                | FavoriteFacilityData['facility'][];
              return {
                id: item.id,
                facility: Array.isArray(facility) ? facility[0] : facility,
              };
            })
            .filter(item => item.facility != null) as FavoriteFacilityData[];
          setFavoriteFacilities(mapped);
          Logger.info('Fetched favorite facilities for player', { playerId, count: mapped.length });
        }
      } catch (err) {
        Logger.error('Exception fetching favorite facilities', err as Error, { playerId });
        setFavoriteFacilities([]);
      } finally {
        setFavoriteFacilitiesLoading(false);
      }
    };

    if (playerId) {
      fetchFavoriteFacilities();
    }
  }, [playerId]);

  // Fetch player data on mount
  useEffect(() => {
    fetchPlayerProfileData();
    // Fetch online status
    isPlayerOnline(playerId).then(setIsOnline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerId]);

  // Fetch current user, favorite status, and block status
  useEffect(() => {
    const fetchCurrentUserAndStatuses = async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) {
          setCurrentUserId(user.id);

          // Check if this player is favorited and blocked in parallel
          const [favoriteResult, blockResult] = await Promise.all([
            supabase
              .from('player_favorite')
              .select('id')
              .eq('player_id', user.id)
              .eq('favorite_player_id', playerId)
              .maybeSingle(),
            supabase
              .from('player_block')
              .select('id')
              .eq('player_id', user.id)
              .eq('blocked_player_id', playerId)
              .maybeSingle(),
          ]);

          setIsFavorite(!!favoriteResult.data);
          setIsBlocked(!!blockResult.data);
        }
      } catch (error) {
        Logger.error('Failed to fetch favorite/block status', error as Error);
      }
    };

    fetchCurrentUserAndStatuses();
  }, [playerId]);

  const handleStartChat = useCallback(async () => {
    if (!currentUserId || chatLoading) return;

    setChatLoading(true);
    lightHaptic();

    try {
      const conversation = await getOrCreateDirectConversation.mutateAsync({
        playerId1: currentUserId,
        playerId2: playerId,
      });

      // Navigate to the chat conversation
      // Use the other player's name as the title
      const playerName = profile
        ? `${(profile as unknown as { first_name?: string }).first_name || ''} ${(profile as unknown as { last_name?: string }).last_name || ''}`.trim() ||
          t('common.player')
        : t('playerProfile.chat');
      navigation.navigate('ChatConversation', {
        conversationId: conversation.id,
        title: playerName,
      });
    } catch (error) {
      Logger.error('Failed to start chat', error as Error);
      Alert.alert(t('alerts.error'), t('alerts.failedToStartConversation'));
    } finally {
      setChatLoading(false);
    }
  }, [currentUserId, playerId, chatLoading, getOrCreateDirectConversation, navigation, profile]);

  // Add chat icon to header right
  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={handleStartChat}
          disabled={!currentUserId}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={{ marginRight: spacingPixels[2] }}
        >
          <Ionicons name="chatbubble-outline" size={24} color={colors.headerForeground} />
        </TouchableOpacity>
      ),
    });
  }, [navigation, currentUserId, handleStartChat, colors.headerForeground]);

  const fetchPlayerProfileData = async () => {
    try {
      setLoading(true);

      // Run all queries in parallel
      const [
        profileResult,
        playerResult,
        sportsResult,
        playerSportsResult,
        ratingsResult,
        availResult,
        sportProfileResult,
        ,
        statsResult,
      ] = await Promise.all([
        // Fetch profile data
        withTimeout(
          (async () => supabase.from('profile').select('*').eq('id', playerId).single())(),
          15000,
          'Failed to load profile'
        ),

        // Fetch player data
        withTimeout(
          (async () => supabase.from('player').select('*').eq('id', playerId).single())(),
          15000,
          'Failed to load player data'
        ),

        // Fetch all sports
        withTimeout(
          (async () => supabase.from('sport').select('*').eq('is_active', true).order('name'))(),
          15000,
          'Failed to load sports'
        ),

        // Fetch player's selected sports
        withTimeout(
          (async () =>
            supabase
              .from('player_sport')
              .select('sport_id, is_primary, is_active')
              .eq('player_id', playerId))(),
          15000,
          'Failed to load player sports'
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
                badge_status,
                referrals_count,
                approved_proofs_count,
                peer_evaluation_count,
                rating_score:rating_score_id (
                  id,
                  label,
                  value,
                  rating_system:rating_system_id (
                    sport_id
                  )
                )
              `
              )
              .eq('player_id', playerId)
              .order('is_certified', { ascending: false })
              .order('created_at', { ascending: false }))(),
          15000,
          'Failed to load ratings'
        ),

        // Fetch player availabilities
        withTimeout(
          (async () =>
            supabase
              .from('player_availability')
              .select('day, period, is_active')
              .eq('player_id', playerId)
              .eq('is_active', true))(),
          15000,
          'Failed to load availability'
        ),

        // Fetch sport preferences from player_sport table (like SportProfile does)
        sportId
          ? withTimeout(
              (async () =>
                supabase
                  .from('player_sport')
                  .select(
                    'id, is_active, preferred_match_duration, preferred_match_type, preferred_play_style, preferred_court, is_primary'
                  )
                  .eq('player_id', playerId)
                  .eq('sport_id', sportId)
                  .maybeSingle())(),
              15000,
              'Failed to load sport preferences'
            )
          : Promise.resolve({ data: null, error: null }),

        // Placeholder (kept for array destructuring)
        Promise.resolve({ data: null, error: null }),

        // Fetch match statistics
        withTimeout(
          (async () =>
            supabase
              .from('match_participant')
              .select('match_id, match:match_id (duration_minutes, host_id)')
              .eq('player_id', playerId)
              .eq('status', 'confirmed'))(),
          15000,
          'Failed to load stats'
        ),
      ]);

      // Process profile
      if (profileResult.error) throw profileResult.error;
      setProfile(profileResult.data);

      // Process player
      if (playerResult.error && playerResult.error.code !== 'PGRST116') {
        throw playerResult.error;
      }
      setPlayer(playerResult.data);

      // Process sports
      if (sportsResult.error) throw sportsResult.error;
      const allSports = sportsResult.data;

      // Process player sports
      if (playerSportsResult.error && playerSportsResult.error.code !== 'PGRST116') {
        throw playerSportsResult.error;
      }
      const playerSports = playerSportsResult.data;

      // Process ratings
      if (ratingsResult.error && ratingsResult.error.code !== 'PGRST116') {
        throw ratingsResult.error;
      }
      const ratingsData = ratingsResult.data;

      // Map sports with active status and ratings
      const playerSportsMap = new Map(
        (playerSports || []).map(ps => [
          ps.sport_id,
          { isPrimary: ps.is_primary || false, isActive: ps.is_active || false },
        ])
      );

      // Map ratings
      const ratingsMap = new Map<
        string,
        {
          label: string;
          value: number | null;
          ratingScoreId: string;
          isCertified: boolean;
          badgeStatus: BadgeStatus;
          playerRatingScoreId: string;
          referencesCount: number;
          peerEvaluationCount: number;
          totalProofsCount: number;
          currentLevelProofsCount: number;
        }
      >();

      // Fetch proofs for all ratings in parallel (with rating_score_id for current-level filtering)
      const ratingsWithProofsCounts = await Promise.all(
        (ratingsData || []).map(async rating => {
          let totalProofsCount = 0;
          let currentLevelProofsCount = 0;

          // Get the current rating_score_id from the rating
          const ratingScore = rating.rating_score as { id?: string } | null;
          const currentRatingScoreId = ratingScore?.id || rating.rating_score_id;

          if (rating.id) {
            // Fetch all proofs with their rating_score_id
            const { data: proofs, error: proofsError } = await supabase
              .from('rating_proof')
              .select('rating_score_id')
              .eq('player_rating_score_id', rating.id)
              .eq('is_active', true);

            if (!proofsError && proofs) {
              // Total count: all proofs
              totalProofsCount = proofs.length;

              // Current-level count: proofs matching current rating_score_id
              currentLevelProofsCount = proofs.filter(
                p => p.rating_score_id === currentRatingScoreId
              ).length;
            }
          }
          return { ...rating, totalProofsCount, currentLevelProofsCount, currentRatingScoreId };
        })
      );

      ratingsWithProofsCounts.forEach(rating => {
        const ratingScore = rating.rating_score as {
          id?: string;
          label?: string;
          value?: number | null;
          rating_system?: { sport_id?: string };
        } | null;
        const ratingSystemData = ratingScore?.rating_system;
        const sportIdFromRating = ratingSystemData?.sport_id;
        const displayLabel = ratingScore?.label || '';
        const displayValue = ratingScore?.value ?? null;
        const ratingScoreId = ratingScore?.id || rating.currentRatingScoreId || '';

        // Determine badge status based on counts:
        // - certified (green): badge_status is 'certified' OR 3+ references OR 2+ current-level proofs
        // - disputed (red): badge_status is 'disputed'
        // - self_declared (yellow): default when criteria not met
        // NOTE: Only CURRENT-LEVEL proofs count for certification
        const rawBadgeStatus = rating.badge_status as string | undefined;
        const referralsCount = rating.referrals_count || 0;
        const currentLevelProofsCount = rating.currentLevelProofsCount || 0;
        const totalProofsCount = rating.totalProofsCount || 0;
        const peerEvalCount = rating.peer_evaluation_count || 0;

        let badgeStatus: BadgeStatus = 'self_declared';
        if (rawBadgeStatus === 'disputed') {
          badgeStatus = 'disputed';
        } else if (
          rawBadgeStatus === 'certified' ||
          referralsCount >= 3 ||
          currentLevelProofsCount >= 2
        ) {
          badgeStatus = 'certified';
        }

        if (sportIdFromRating && !ratingsMap.has(sportIdFromRating)) {
          ratingsMap.set(sportIdFromRating, {
            label: displayLabel,
            value: displayValue,
            ratingScoreId,
            isCertified: badgeStatus === 'certified',
            badgeStatus,
            playerRatingScoreId: rating.id,
            referencesCount: referralsCount,
            peerEvaluationCount: peerEvalCount,
            totalProofsCount,
            currentLevelProofsCount,
          });
        }
      });

      const sportsWithStatus: SportWithRating[] = (allSports || [])
        .filter(sport => playerSportsMap.get(sport.id)?.isActive)
        .map(sport => {
          const sportInfo = playerSportsMap.get(sport.id);
          const ratingInfo = ratingsMap.get(sport.id);
          return {
            id: sport.id,
            name: sport.name,
            display_name: sport.display_name,
            isActive: sportInfo?.isActive || false,
            isPrimary: sportInfo?.isPrimary || false,
            ratingLabel: ratingInfo?.label,
            ratingValue: ratingInfo?.value,
            ratingScoreId: ratingInfo?.ratingScoreId,
            isCertified: ratingInfo?.isCertified,
            badgeStatus: ratingInfo?.badgeStatus,
            playerRatingScoreId: ratingInfo?.playerRatingScoreId,
            referencesCount: ratingInfo?.referencesCount,
            peerEvaluationCount: ratingInfo?.peerEvaluationCount,
            totalProofsCount: ratingInfo?.totalProofsCount,
            currentLevelProofsCount: ratingInfo?.currentLevelProofsCount,
          };
        });

      setSports(sportsWithStatus);

      // Process sport preferences from player_sport table
      if (sportProfileResult.data) {
        const spData = sportProfileResult.data as {
          id: string;
          is_active: boolean;
          preferred_match_duration: string | null;
          preferred_match_type: string | null;
          preferred_play_style: string | null;
          preferred_court: string | null;
          is_primary: boolean;
        };

        // Fetch play style and attributes from junction tables (like SportProfile does)
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
            .eq('player_sport_id', spData.id)
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
            .eq('player_sport_id', spData.id),
        ]);

        // Extract play style name
        const playStyleName =
          (playStyleResult.data?.play_style as { name?: string } | null)?.name || null;

        // Extract play attribute names
        const playAttributeNames =
          playAttributesResult.data
            ?.map(item => (item.play_attribute as { name?: string } | null)?.name)
            .filter((name): name is string => !!name) || null;

        setSportPreferences({
          playerSportId: spData.id,
          preferred_match_duration: spData.preferred_match_duration,
          preferred_match_type: spData.preferred_match_type,
          preferred_play_style: playStyleName,
          preferred_court: spData.preferred_court,
          is_primary: spData.is_primary || false,
          playAttributes:
            playAttributeNames && playAttributeNames.length > 0 ? playAttributeNames : null,
        });
      }

      // Process availabilities
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
        const period = avail.period as PeriodKey;
        if (availGrid[day] && period in availGrid[day]) {
          availGrid[day][period] = true;
        }
      });

      setAvailabilities(availGrid);

      // Process stats
      if (statsResult.data) {
        type MatchData = {
          match_id: string;
          match: { duration_minutes: number | null; host_id: string }[] | null;
        };
        const matchData = statsResult.data as unknown as MatchData[];
        const totalMinutes = matchData.reduce(
          (sum, m) => sum + (m.match?.[0]?.duration_minutes || 0),
          0
        );
        const hostedMatches = matchData.filter(m => m.match?.[0]?.host_id === playerId).length;
        setStats({
          hoursPlayed: Math.round(totalMinutes / 60),
          gamesHosted: hostedMatches,
          weekStreak: 0, // TODO: Calculate actual streak
        });
      }
    } catch (error) {
      Logger.error('Failed to fetch player profile', error as Error, { playerId });
      Alert.alert(t('alerts.error'), getNetworkErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const formatJoinedDate = (dateString: string | null): string => {
    if (!dateString) return '';
    return formatDateMonthYear(dateString, locale);
  };

  const formatGender = (gender: string | null): string => {
    if (!gender) return '-';
    const genderMap: { [key: string]: TranslationKey } = {
      male: 'common.gender.male',
      female: 'common.gender.female',
      other: 'common.gender.other',
    };
    return genderMap[gender] ? t(genderMap[gender]) : gender;
  };

  const formatPlayingHand = (hand: string | null): string => {
    if (!hand) return '-';
    const handMap: { [key: string]: TranslationKey } = {
      left: 'common.playingHand.left',
      right: 'common.playingHand.right',
      both: 'common.playingHand.both',
    };
    return handMap[hand] ? t(handMap[hand]) : hand;
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

  const formatPlayAttribute = (attr: string): string => {
    // Use translation keys for play attributes
    const translationKey = `profile.preferences.playAttributes.${attr}` as TranslationKey;
    const translated = t(translationKey);

    // If translation exists (not the same as key), use it
    if (translated !== translationKey) {
      return translated;
    }

    // Fallback: capitalize first letter of each word
    return attr.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  const getDayLabel = (day: string): string => {
    const dayKeys: { [key: string]: string } = {
      monday: 'playerProfile.availability.days.monday',
      tuesday: 'playerProfile.availability.days.tuesday',
      wednesday: 'playerProfile.availability.days.wednesday',
      thursday: 'playerProfile.availability.days.thursday',
      friday: 'playerProfile.availability.days.friday',
      saturday: 'playerProfile.availability.days.saturday',
      sunday: 'playerProfile.availability.days.sunday',
    };
    return t(dayKeys[day] as TranslationKey) || day;
  };

  // Translated rating title based on skill value
  const getTranslatedRatingTitle = (value: number | null | undefined): string => {
    if (!value) return t('playerProfile.rating.unrated' as TranslationKey);
    if (value <= 2.0) return t('playerProfile.rating.beginner' as TranslationKey);
    if (value <= 3.0) return t('playerProfile.rating.intermediate' as TranslationKey);
    if (value <= 4.0) return t('playerProfile.rating.intermediateAdvanced' as TranslationKey);
    if (value <= 5.0) return t('playerProfile.rating.advanced' as TranslationKey);
    return t('playerProfile.rating.professional' as TranslationKey);
  };

  // Translated rating description based on skill value
  const getTranslatedRatingDescription = (value: number | null | undefined): string => {
    if (!value) return t('playerProfile.rating.descriptions.unrated' as TranslationKey);
    if (value <= 2.0) return t('playerProfile.rating.descriptions.beginner' as TranslationKey);
    if (value <= 3.0) return t('playerProfile.rating.descriptions.intermediate' as TranslationKey);
    if (value <= 4.0)
      return t('playerProfile.rating.descriptions.intermediateAdvanced' as TranslationKey);
    if (value <= 5.0) return t('playerProfile.rating.descriptions.advanced' as TranslationKey);
    return t('playerProfile.rating.descriptions.professional' as TranslationKey);
  };

  const handleInviteToMatch = useCallback(() => {
    if (!currentUserId || !profile) return;

    void lightHaptic();
    void SheetManager.show('invite-to-match', {
      payload: {
        playerId,
        playerName:
          profile.first_name ||
          profile.display_name ||
          t('playerProfile.unknownPlayer' as TranslationKey),
      },
    });
  }, [currentUserId, playerId, profile, t]);

  const handleRequestReference = useCallback(async () => {
    if (!currentUserId || referenceLoading) return;

    setReferenceLoading(true);
    lightHaptic();

    try {
      // Get the sport to use - prefer route param sportId, fallback to primary/first sport
      const targetSportId = sportId || sports.find(s => s.isPrimary)?.id || sports[0]?.id;
      if (!targetSportId) {
        toast.error(t('playerProfile.referenceRequest.noSportError'));
        return;
      }

      // Get the viewed player's rating info for this sport
      const viewedPlayerSport = sports.find(s => s.id === targetSportId);
      if (!viewedPlayerSport) {
        toast.error(t('playerProfile.referenceRequest.noSportError'));
        return;
      }

      // Check if viewed player is at same/higher level (they need to be to give a valid reference)
      // First, fetch current user's ratings with full relationship chain
      const { data: currentUserRatings, error: ratingError } = await supabase
        .from('player_rating_score')
        .select(
          `
          id,
          rating_score:rating_score_id (
            value,
            rating_system:rating_system_id (
              sport_id
            )
          )
        `
        )
        .eq('player_id', currentUserId);

      if (ratingError) {
        throw ratingError;
      }

      // Find the rating for the target sport
      const currentUserRating = currentUserRatings?.find(r => {
        const ratingScore = r.rating_score as { rating_system?: { sport_id?: string } } | null;
        return ratingScore?.rating_system?.sport_id === targetSportId;
      });

      if (!currentUserRating) {
        // Current user has no rating for this sport - cannot request reference
        toast.warning(t('playerProfile.referenceRequest.noRatingError'));
        return;
      }

      const currentUserRatingScoreId = currentUserRating.id;
      const ratingScoreData = currentUserRating.rating_score as { value?: number } | null;
      const currentUserRatingValue = ratingScoreData?.value;

      // Check if viewed player is at same/higher level
      if (viewedPlayerSport.ratingValue != null && currentUserRatingValue != null) {
        if (viewedPlayerSport.ratingValue < currentUserRatingValue) {
          toast.warning(t('playerProfile.referenceRequest.playerLevelTooLow'));
          return;
        }
      }

      // Calculate expiration date (14 days from now)
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 14);

      // Insert the reference request
      const insertPayload = {
        player_rating_score_id: currentUserRatingScoreId,
        requester_id: currentUserId,
        referee_id: playerId,
        status: 'pending',
        expires_at: expiresAt.toISOString(),
      };

      Logger.info('Sending reference request', {
        ...insertPayload,
        targetSportId,
        viewedPlayerRatingValue: viewedPlayerSport.ratingValue,
      });

      const { data: insertData, error: insertError } = await supabase
        .from('rating_reference_request')
        .insert(insertPayload)
        .select('id')
        .single();

      if (insertError) {
        Logger.error('Reference request insert failed', insertError, insertPayload);
        // Check for unique constraint violation (already requested)
        if (insertError.code === '23505') {
          toast.warning(t('profile.certification.referenceRequest.alreadyRequested'));
        } else {
          throw insertError;
        }
      } else {
        Logger.logUserAction('reference_request_sent', {
          refereeId: playerId,
          sportId: targetSportId,
          insertedId: insertData?.id,
        });
        toast.success(t('playerProfile.referenceRequest.success'));
      }
    } catch (error) {
      Logger.error('Failed to send reference request', error as Error, { playerId });
      toast.error(t('playerProfile.referenceRequest.error'));
    } finally {
      setReferenceLoading(false);
    }
  }, [currentUserId, referenceLoading, sportId, sports, playerId, t, toast]);

  const handleToggleFavorite = useCallback(async () => {
    if (!currentUserId || favoriteLoading) return;

    setFavoriteLoading(true);
    lightHaptic();

    try {
      if (isFavorite) {
        // Remove from favorites
        const { error } = await supabase
          .from('player_favorite')
          .delete()
          .eq('player_id', currentUserId)
          .eq('favorite_player_id', playerId);

        if (error) throw error;
        setIsFavorite(false);
        Logger.info('Player removed from favorites', { playerId });
      } else {
        // Add to favorites
        const { error } = await supabase.from('player_favorite').insert({
          player_id: currentUserId,
          favorite_player_id: playerId,
        });

        if (error) throw error;
        setIsFavorite(true);
        Logger.info('Player added to favorites', { playerId });
      }
    } catch (error) {
      Logger.error('Failed to toggle favorite', error as Error);
      Alert.alert(
        t('alerts.error'),
        isFavorite ? t('alerts.failedToRemoveFavorite') : t('alerts.failedToAddFavorite')
      );
    } finally {
      setFavoriteLoading(false);
    }
  }, [currentUserId, favoriteLoading, isFavorite, playerId, t]);

  const handleToggleBlock = useCallback(async () => {
    if (!currentUserId || blockLoading) return;

    setBlockLoading(true);
    mediumHaptic();

    try {
      if (isBlocked) {
        // Unblock player
        const { error } = await supabase
          .from('player_block')
          .delete()
          .eq('player_id', currentUserId)
          .eq('blocked_player_id', playerId);

        if (error) throw error;
        setIsBlocked(false);
        Logger.info('Player unblocked', { playerId });
      } else {
        // Block player - also remove from favorites if favorited
        if (isFavorite) {
          await supabase
            .from('player_favorite')
            .delete()
            .eq('player_id', currentUserId)
            .eq('favorite_player_id', playerId);
          setIsFavorite(false);
        }

        const { error } = await supabase.from('player_block').insert({
          player_id: currentUserId,
          blocked_player_id: playerId,
        });

        if (error) throw error;
        setIsBlocked(true);
        Logger.info('Player blocked', { playerId });
      }
    } catch (error) {
      Logger.error('Failed to toggle block', error as Error);
      Alert.alert(
        t('alerts.error'),
        isBlocked ? t('alerts.failedToUnblockPlayer') : t('alerts.failedToBlockPlayer')
      );
    } finally {
      setBlockLoading(false);
    }
  }, [currentUserId, blockLoading, isBlocked, isFavorite, playerId, t]);

  // Get the primary/selected sport for rating display
  const primarySport = useMemo(() => {
    if (sportId) {
      return sports.find(s => s.id === sportId);
    }
    return sports.find(s => s.isPrimary) || sports[0];
  }, [sports, sportId]);

  // Fetch approved proofs for the primary sport rating
  useEffect(() => {
    const fetchApprovedProofs = async () => {
      const prsId = primarySport?.playerRatingScoreId;
      if (!prsId) {
        setApprovedProofs([]);
        return;
      }
      setProofsLoading(true);
      try {
        const { data, error } = await supabase
          .from('rating_proof')
          .select(
            `
            id,
            proof_type,
            title,
            description,
            external_url,
            status,
            created_at,
            file:file_id(id, url, thumbnail_url, file_type, original_name, mime_type)
          `
          )
          .eq('player_rating_score_id', prsId)
          .eq('is_active', true)
          .order('created_at', { ascending: false })
          .limit(10);

        if (error) {
          Logger.error('Failed to fetch approved proofs', error, { playerRatingScoreId: prsId });
          return;
        }

        const proofsData = (data || []).map((item: Record<string, unknown>) => ({
          ...item,
          file: Array.isArray(item.file) && item.file.length > 0 ? item.file[0] : item.file,
        })) as RatingProofData[];
        setApprovedProofs(proofsData);
      } catch (err) {
        Logger.error('Failed to fetch approved proofs', err as Error);
      } finally {
        setProofsLoading(false);
      }
    };
    fetchApprovedProofs();
  }, [primarySport?.playerRatingScoreId]);

  const getEffectiveProofType = useCallback((proof: RatingProofData): string => {
    if (proof.proof_type === 'external_link') return 'external_link';
    if (proof.file?.file_type && ['video', 'image', 'document'].includes(proof.file.file_type)) {
      return proof.file.file_type;
    }
    return proof.proof_type;
  }, []);

  const getProofIcon = useCallback((type: string): string => {
    switch (type) {
      case 'video':
        return 'videocam';
      case 'image':
        return 'image';
      case 'document':
        return 'document-text';
      case 'external_link':
        return 'link';
      default:
        return 'help-circle';
    }
  }, []);

  const getProofTypeColor = useCallback((type: string): string => {
    switch (type) {
      case 'video':
        return '#FF6B6B';
      case 'image':
        return '#4ECDC4';
      case 'document':
        return '#45B7D1';
      case 'external_link':
        return '#96CEB4';
      default:
        return '#888';
    }
  }, []);

  if (loading) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.background }]}
        edges={['bottom']}
      >
        <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
          {/* Profile Header Skeleton */}
          <View style={[styles.profileHeader, { backgroundColor: colors.card }]}>
            <View style={{ marginBottom: spacingPixels[3] }}>
              <SkeletonAvatar
                size={100}
                backgroundColor={skeletonBg}
                highlightColor={skeletonHighlight}
              />
            </View>
            <Skeleton
              width={150}
              height={20}
              borderRadius={4}
              backgroundColor={skeletonBg}
              highlightColor={skeletonHighlight}
              style={{ marginBottom: spacingPixels[1] }}
            />
            <Skeleton
              width={80}
              height={14}
              borderRadius={4}
              backgroundColor={skeletonBg}
              highlightColor={skeletonHighlight}
              style={{ marginBottom: spacingPixels[2] }}
            />
            {/* Badges row */}
            <View style={styles.profileBadgesRow}>
              <Skeleton
                width={70}
                height={28}
                borderRadius={14}
                backgroundColor={skeletonBg}
                highlightColor={skeletonHighlight}
              />
              <Skeleton
                width={70}
                height={28}
                borderRadius={14}
                backgroundColor={skeletonBg}
                highlightColor={skeletonHighlight}
              />
            </View>
            {/* Joined date */}
            <View style={styles.joinedContainer}>
              <Skeleton
                width={120}
                height={12}
                borderRadius={4}
                backgroundColor={skeletonBg}
                highlightColor={skeletonHighlight}
              />
            </View>
            {/* Last seen */}
            <View style={styles.lastSeenContainer}>
              <Skeleton
                width={90}
                height={12}
                borderRadius={4}
                backgroundColor={skeletonBg}
                highlightColor={skeletonHighlight}
              />
            </View>
            {/* Action button */}
            <View style={styles.actionButtons}>
              <View style={{ flex: 1 }}>
                <Skeleton
                  width="100%"
                  height={44}
                  borderRadius={22}
                  backgroundColor={skeletonBg}
                  highlightColor={skeletonHighlight}
                />
              </View>
            </View>
            {/* Request Reference button */}
            <View style={styles.secondaryAction}>
              <Skeleton
                width={180}
                height={36}
                borderRadius={18}
                backgroundColor={skeletonBg}
                highlightColor={skeletonHighlight}
              />
            </View>
          </View>

          {/* Statistics Section */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Skeleton
                width={18}
                height={18}
                borderRadius={4}
                backgroundColor={skeletonBg}
                highlightColor={skeletonHighlight}
              />
              <Skeleton
                width={120}
                height={16}
                borderRadius={4}
                backgroundColor={skeletonBg}
                highlightColor={skeletonHighlight}
              />
            </View>
            <View style={styles.statsGrid}>
              {[1, 2, 3].map(i => (
                <View key={i} style={{ flex: 1 }}>
                  <Skeleton
                    width="100%"
                    height={80}
                    borderRadius={radiusPixels.xl}
                    backgroundColor={skeletonBg}
                    highlightColor={skeletonHighlight}
                  />
                </View>
              ))}
            </View>
          </View>

          {/* Player Information Section */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Skeleton
                width={18}
                height={18}
                borderRadius={4}
                backgroundColor={skeletonBg}
                highlightColor={skeletonHighlight}
              />
              <Skeleton
                width={160}
                height={16}
                borderRadius={4}
                backgroundColor={skeletonBg}
                highlightColor={skeletonHighlight}
              />
            </View>
            <Skeleton
              width="100%"
              height={140}
              borderRadius={radiusPixels.xl}
              backgroundColor={skeletonBg}
              highlightColor={skeletonHighlight}
            />
          </View>

          {/* Preferred Courts Section */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Skeleton
                width={18}
                height={18}
                borderRadius={4}
                backgroundColor={skeletonBg}
                highlightColor={skeletonHighlight}
              />
              <Skeleton
                width={140}
                height={16}
                borderRadius={4}
                backgroundColor={skeletonBg}
                highlightColor={skeletonHighlight}
              />
            </View>
            <View style={styles.facilitiesSection}>
              <Skeleton
                width="100%"
                height={70}
                borderRadius={radiusPixels.lg}
                backgroundColor={skeletonBg}
                highlightColor={skeletonHighlight}
              />
              <Skeleton
                width="100%"
                height={70}
                borderRadius={radiusPixels.lg}
                backgroundColor={skeletonBg}
                highlightColor={skeletonHighlight}
              />
            </View>
          </View>

          {/* Rating Section */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Skeleton
                width={18}
                height={18}
                borderRadius={4}
                backgroundColor={skeletonBg}
                highlightColor={skeletonHighlight}
              />
              <Skeleton
                width={100}
                height={16}
                borderRadius={4}
                backgroundColor={skeletonBg}
                highlightColor={skeletonHighlight}
              />
            </View>
            <Skeleton
              width="100%"
              height={140}
              borderRadius={radiusPixels.xl}
              backgroundColor={skeletonBg}
              highlightColor={skeletonHighlight}
            />
          </View>

          {/* Bottom Spacing */}
          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  const displayName =
    `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim() ||
    profile?.display_name ||
    t('common.player');

  const username =
    profile?.display_name ||
    `${profile?.first_name?.toLowerCase() || ''}${profile?.last_name?.toLowerCase() || ''}`;

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['bottom']}
    >
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Profile Header */}
        <View style={[styles.profileHeader, { backgroundColor: colors.card }]}>
          {/* Block Icon - Top Left */}
          <TouchableOpacity
            style={styles.blockButton}
            onPress={handleToggleBlock}
            disabled={blockLoading || !currentUserId}
          >
            {blockLoading ? (
              <ActivityIndicator size="small" color={colors.textMuted} />
            ) : (
              <Ionicons
                name={isBlocked ? 'ban' : 'ban-outline'}
                size={24}
                color={isBlocked ? status.error.DEFAULT : colors.textMuted}
              />
            )}
          </TouchableOpacity>

          {/* Favorite Heart Icon - Top Right */}
          <TouchableOpacity
            style={styles.favoriteButton}
            onPress={handleToggleFavorite}
            disabled={favoriteLoading || !currentUserId || isBlocked}
          >
            {favoriteLoading ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Ionicons
                name={isFavorite ? 'heart' : 'heart-outline'}
                size={28}
                color={
                  isFavorite ? status.error.DEFAULT : isBlocked ? colors.border : colors.textMuted
                }
              />
            )}
          </TouchableOpacity>

          <View style={styles.avatarWrapper}>
            <View style={[styles.profilePicContainer, { borderColor: colors.primary }]}>
              {profile?.profile_picture_url ? (
                <Image
                  source={{ uri: getProfilePictureUrl(profile.profile_picture_url) || '' }}
                  style={styles.profileImage}
                />
              ) : (
                <Ionicons name="person-outline" size={40} color={colors.primary} />
              )}
            </View>
            {/* Online Status Indicator */}
            <View
              style={[
                styles.onlineIndicator,
                {
                  backgroundColor: isOnline ? '#22C55E' : neutral[400],
                  borderColor: colors.card,
                },
              ]}
            />
          </View>

          <Text style={[styles.profileName, { color: colors.text }]}>{displayName}</Text>
          <Text style={[styles.username, { color: colors.textMuted }]}>@{username}</Text>

          {/* Rating & Reputation Badges */}
          <View style={styles.profileBadgesRow}>
            <RatingBadge
              ratingValue={primarySport?.ratingValue}
              ratingLabel={primarySport?.ratingLabel}
              certificationStatus={
                primarySport?.badgeStatus as 'self_declared' | 'certified' | 'disputed' | undefined
              }
              isDark={isDark}
              isLoading={loading}
            />
            <ReputationBadge
              reputationDisplay={reputationDisplay}
              isDark={isDark}
              isLoading={reputationLoading}
            />
          </View>

          <View style={styles.joinedContainer}>
            <Ionicons name="calendar-outline" size={14} color={colors.textMuted} />
            <Text style={[styles.joinedText, { color: colors.textMuted }]}>
              {t('playerProfile.joined')} {formatJoinedDate(player?.created_at || null)}
            </Text>
          </View>

          {/* Last Seen / Active Status */}
          <View style={styles.lastSeenContainer}>
            <Ionicons
              name={isOnline ? 'ellipse' : 'time-outline'}
              size={isOnline ? 8 : 14}
              color={isOnline ? '#22C55E' : colors.textMuted}
            />
            <Text style={[styles.lastSeenText, { color: isOnline ? '#22C55E' : colors.textMuted }]}>
              {isOnline
                ? t('profile.status.activeNow')
                : player?.last_seen_at
                  ? `${t('profile.status.lastSeen')} ${formatRelativeTime(player.last_seen_at)}`
                  : t('profile.status.offline')}
            </Text>
          </View>

          {/* Action Buttons */}
          <View style={styles.actionButtons}>
            <Button
              variant="primary"
              size="md"
              onPress={handleInviteToMatch}
              leftIcon={
                <SportIcon
                  sportName={selectedSport?.name ?? 'tennis'}
                  size={18}
                  color={colors.primaryForeground}
                />
              }
              isDark={isDark}
              style={{ flex: 1 }}
            >
              {t('playerProfile.inviteToMatch')}
            </Button>
          </View>

          {/* Secondary Action */}
          <View style={styles.secondaryAction}>
            <Button
              variant="outline"
              size="sm"
              onPress={handleRequestReference}
              loading={referenceLoading}
              leftIcon={
                !referenceLoading ? (
                  <Ionicons name="document-text-outline" size={18} color={colors.textSecondary} />
                ) : undefined
              }
              isDark={isDark}
            >
              {t('playerProfile.requestReference')}
            </Button>
          </View>
        </View>

        {/* Statistics Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="stats-chart-outline" size={18} color={colors.primary} />
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              {t('playerProfile.sections.statistics')}
            </Text>
          </View>

          <View style={styles.statsGrid}>
            <View
              style={[
                styles.statCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.statValue, { color: colors.primary }]}>{stats.hoursPlayed}</Text>
              <Text style={[styles.statLabel, { color: colors.textMuted }]}>
                {t('playerProfile.stats.hoursPlayed')}
              </Text>
            </View>
            <View
              style={[
                styles.statCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.statValue, { color: colors.primary }]}>{stats.gamesHosted}</Text>
              <Text style={[styles.statLabel, { color: colors.textMuted }]}>
                {t('playerProfile.stats.gamesHosted')}
              </Text>
            </View>
            <View
              style={[
                styles.statCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.statValue, { color: colors.primary }]}>{stats.weekStreak}</Text>
              <Text style={[styles.statLabel, { color: colors.textMuted }]}>
                {t('playerProfile.stats.weekStreak')}
              </Text>
            </View>
          </View>
        </View>

        {/* Rating Section */}
        {primarySport && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="star-outline" size={18} color={colors.primary} />
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                {t('playerProfile.sections.rating')}
              </Text>
            </View>

            <View
              style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <View style={styles.ratingHeader}>
                <View>
                  <Text style={[styles.ratingTitle, { color: colors.text }]}>
                    {primarySport.ratingLabel
                      ? getTranslatedRatingTitle(primarySport.ratingValue)
                      : t('playerProfile.rating.unrated' as TranslationKey)}
                  </Text>
                  <Text style={[styles.ratingCode, { color: colors.primary }]}>
                    {primarySport.ratingLabel ||
                      (primarySport.name === 'tennis' ? 'NTRP -' : 'DUPR -')}
                  </Text>
                  {(primarySport.referencesCount ?? 0) > 0 && (
                    <View
                      style={[styles.referencesBadge, { backgroundColor: `${colors.primary}15` }]}
                    >
                      <Ionicons name="people-outline" size={14} color={colors.primary} />
                      <Text style={[styles.referencesBadgeText, { color: colors.primary }]}>
                        {t('profile.rating.references', {
                          count: primarySport.referencesCount || 0,
                        })}
                      </Text>
                    </View>
                  )}
                </View>
                <CertificationBadge
                  status={primarySport.badgeStatus || 'self_declared'}
                  size="md"
                />
              </View>
              <Text style={[styles.ratingDescription, { color: colors.textMuted }]}>
                {getTranslatedRatingDescription(primarySport.ratingValue)}
              </Text>

              {/* Proof Gallery */}
              {proofsLoading ? (
                <View style={styles.proofGalleryLoading}>
                  <ActivityIndicator size="small" color={colors.primary} />
                </View>
              ) : approvedProofs.length > 0 ? (
                <FlatList
                  data={approvedProofs}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  keyExtractor={item => item.id}
                  contentContainerStyle={styles.proofGalleryList}
                  renderItem={({ item }) => {
                    const effectiveType = getEffectiveProofType(item);
                    return (
                      <ProofGalleryCard
                        item={item}
                        effectiveType={effectiveType}
                        typeColor={getProofTypeColor(effectiveType)}
                        iconName={getProofIcon(effectiveType)}
                        backgroundColor={colors.inputBackground}
                        onPress={() => {
                          setSelectedProof(item);
                          setShowProofViewer(true);
                        }}
                      />
                    );
                  }}
                />
              ) : null}

              {/* Proof Viewer Modal */}
              <ProofViewer
                visible={showProofViewer}
                onClose={() => {
                  setShowProofViewer(false);
                  setSelectedProof(null);
                }}
                proof={selectedProof}
              />
            </View>
          </View>
        )}

        {/* Player Information Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="person-outline" size={18} color={colors.primary} />
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              {t('playerProfile.sections.playerInformation')}
            </Text>
          </View>

          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.bioText, { color: colors.text }]}>
              {profile?.bio || t('playerProfile.noBio')}
            </Text>

            <View style={styles.infoGrid}>
              <View style={styles.infoItem}>
                <Text style={[styles.infoLabel, { color: colors.textMuted }]}>
                  {t('playerProfile.fields.gender')}
                </Text>
                <Text style={[styles.infoValue, { color: colors.text }]}>
                  {formatGender(player?.gender || null)}
                </Text>
              </View>
              <View style={styles.infoItem}>
                <Text style={[styles.infoLabel, { color: colors.textMuted }]}>
                  {t('playerProfile.fields.playingHand')}
                </Text>
                <Text style={[styles.infoValue, { color: colors.text }]}>
                  {formatPlayingHand(player?.playing_hand || null)}
                </Text>
              </View>
              <View style={styles.infoItem}>
                <Text style={[styles.infoLabel, { color: colors.textMuted }]}>
                  {t('playerProfile.fields.maxTravelDistance')}
                </Text>
                <Text style={[styles.infoValue, { color: colors.text }]}>
                  {player?.max_travel_distance ? `${player.max_travel_distance} km` : '-'}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Preferences Section */}
        {sportPreferences && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="options-outline" size={18} color={colors.primary} />
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                {t('playerProfile.sections.preferences')}
              </Text>
            </View>

            <View
              style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              {/* Match Duration */}
              <View style={[styles.preferenceRow, { borderBottomColor: colors.border }]}>
                <Text style={[styles.preferenceLabel, { color: colors.textMuted }]}>
                  {t('profile.fields.matchDuration')}
                </Text>
                <Text style={[styles.preferenceValue, { color: colors.text }]}>
                  {formatMatchDuration(sportPreferences.preferred_match_duration)}
                </Text>
              </View>

              {/* Match Type */}
              <View style={[styles.preferenceRow, { borderBottomColor: colors.border }]}>
                <Text style={[styles.preferenceLabel, { color: colors.textMuted }]}>
                  {t('profile.fields.matchType')}
                </Text>
                <Text style={[styles.preferenceValue, { color: colors.text }]}>
                  {formatMatchType(sportPreferences.preferred_match_type)}
                </Text>
              </View>

              {/* Playing Style */}
              <View style={[styles.preferenceRow, { borderBottomWidth: 0 }]}>
                <Text style={[styles.preferenceLabel, { color: colors.textMuted }]}>
                  {t('profile.fields.playingStyle')}
                </Text>
                <Text style={[styles.preferenceValue, { color: colors.text }]}>
                  {formatPlayingStyle(sportPreferences.preferred_play_style)}
                </Text>
              </View>

              {/* Play Attributes */}
              {sportPreferences.playAttributes && sportPreferences.playAttributes.length > 0 && (
                <View style={[styles.playAttributesContainer, { borderTopColor: colors.border }]}>
                  <Text style={[styles.playAttributesTitle, { color: colors.textMuted }]}>
                    {t('profile.fields.playAttributes')}
                  </Text>
                  <View style={styles.attributeTags}>
                    {sportPreferences.playAttributes.map((attr: string, index: number) => (
                      <View
                        key={index}
                        style={[styles.attributeTag, { backgroundColor: colors.primaryForeground }]}
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

        {/* Preferred Courts Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="tennisball-outline" size={18} color={colors.primary} />
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              {t('playerProfile.sections.preferredCourts' as TranslationKey)}
            </Text>
          </View>

          {favoriteFacilitiesLoading ? (
            <View style={styles.facilitiesSection}>
              {[1, 2, 3].map(i => (
                <Skeleton
                  key={i}
                  width="100%"
                  height={70}
                  borderRadius={radiusPixels.lg}
                  backgroundColor={skeletonBg}
                  highlightColor={skeletonHighlight}
                />
              ))}
            </View>
          ) : favoriteFacilities.length > 0 ? (
            <View style={styles.facilitiesSection}>
              {favoriteFacilities.map(fav => (
                <View
                  key={fav.id}
                  style={[
                    styles.facilityCard,
                    { backgroundColor: colors.card, borderColor: colors.border },
                  ]}
                >
                  <View style={styles.facilityCardContent}>
                    {/* Facility Name */}
                    <View style={styles.facilityNameRow}>
                      <Text style={[styles.facilityName, { color: colors.text }]} numberOfLines={1}>
                        {fav.facility.name}
                      </Text>
                    </View>

                    {/* Address */}
                    {(fav.facility.address || fav.facility.city) && (
                      <View style={styles.facilityAddressRow}>
                        <Ionicons name="location-outline" size={14} color={colors.textMuted} />
                        <Text
                          style={[styles.facilityAddress, { color: colors.textMuted }]}
                          numberOfLines={1}
                        >
                          {fav.facility.address || fav.facility.city}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <View
              style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Text style={[styles.noFacilitiesText, { color: colors.textMuted }]}>
                {t('playerProfile.noPreferredCourts' as TranslationKey)}
              </Text>
            </View>
          )}
        </View>

        {/* Availabilities Section - Only show if player has made it public */}
        {player?.privacy_show_availability !== false && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="time-outline" size={18} color={colors.primary} />
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                {t('playerProfile.sections.availabilities')}
              </Text>
            </View>

            <View
              style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <View style={styles.availabilityGrid}>
                {/* Day Rows */}
                {Object.keys(availabilities).map(day => (
                  <View key={day} style={styles.availabilityRow}>
                    <View style={styles.dayCell}>
                      <Text size="sm" weight="medium" color={colors.text}>
                        {getDayLabel(day)}
                      </Text>
                    </View>
                    {(['morning', 'afternoon', 'evening'] as PeriodKey[]).map(period => (
                      <View key={period} style={styles.slotWrapper}>
                        <View
                          style={[
                            styles.slotCell,
                            { backgroundColor: colors.inputBackground },
                            availabilities[day]?.[period] && {
                              backgroundColor: colors.primary,
                            },
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
                            {period === 'morning'
                              ? t('playerProfile.availability.am' as TranslationKey)
                              : period === 'afternoon'
                                ? t('playerProfile.availability.pm' as TranslationKey)
                                : t('playerProfile.availability.eve' as TranslationKey)}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </View>
                ))}
              </View>
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: spacingPixels[3],
    fontSize: fontSizePixels.sm,
  },
  scrollView: {
    flex: 1,
  },
  profileHeader: {
    alignItems: 'center',
    paddingVertical: spacingPixels[6],
    paddingHorizontal: spacingPixels[4],
    position: 'relative',
  },
  blockButton: {
    position: 'absolute',
    top: spacingPixels[4],
    left: spacingPixels[4],
    padding: spacingPixels[2],
    zIndex: 1,
  },
  favoriteButton: {
    position: 'absolute',
    top: spacingPixels[4],
    right: spacingPixels[4],
    padding: spacingPixels[2],
    zIndex: 1,
  },
  avatarWrapper: {
    position: 'relative',
    marginBottom: spacingPixels[3],
  },
  profilePicContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 3,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  onlineIndicator: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 3,
  },
  profileImage: {
    width: '100%',
    height: '100%',
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
  joinedContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    marginBottom: spacingPixels[1],
  },
  joinedText: {
    fontSize: fontSizePixels.xs,
  },
  lastSeenContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    marginBottom: spacingPixels[4],
  },
  lastSeenText: {
    fontSize: fontSizePixels.xs,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: spacingPixels[3],
    width: '100%',
    paddingHorizontal: spacingPixels[4],
  },
  secondaryAction: {
    width: '100%',
    paddingHorizontal: spacingPixels[4],
    marginTop: spacingPixels[2],
    alignItems: 'center',
  },
  section: {
    marginTop: spacingPixels[4],
    paddingHorizontal: spacingPixels[4],
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    marginBottom: spacingPixels[3],
  },
  sectionTitle: {
    fontSize: fontSizePixels.base,
    fontWeight: fontWeightNumeric.semibold,
  },
  card: {
    borderRadius: radiusPixels.xl,
    padding: spacingPixels[4],
    borderWidth: 1,
  },
  bioText: {
    fontSize: fontSizePixels.sm,
    lineHeight: 22,
    marginBottom: spacingPixels[4],
  },
  infoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  infoItem: {
    width: '50%',
    marginBottom: spacingPixels[3],
  },
  infoLabel: {
    fontSize: fontSizePixels.xs,
    marginBottom: spacingPixels[1],
  },
  infoValue: {
    fontSize: fontSizePixels.sm,
    fontWeight: fontWeightNumeric.medium,
  },
  preferencesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  preferenceItem: {
    width: '50%',
    marginBottom: spacingPixels[3],
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
  attributesContainer: {
    marginTop: spacingPixels[2],
    paddingTop: spacingPixels[3],
    borderTopWidth: 1,
    borderTopColor: neutral[200],
  },
  attributesLabel: {
    fontSize: fontSizePixels.xs,
    marginBottom: spacingPixels[2],
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
    flex: 1,
    alignItems: 'flex-end',
  },
  facilityText: {
    fontSize: fontSizePixels.sm,
    fontWeight: fontWeightNumeric.semibold,
    textAlign: 'right',
  },
  facilitiesSection: {
    gap: spacingPixels[3],
  },
  facilityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
  },
  facilityCardContent: {
    flex: 1,
  },
  facilityNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacingPixels[1],
  },
  facilityName: {
    fontSize: fontSizePixels.base,
    fontWeight: fontWeightNumeric.semibold,
    flex: 1,
  },
  facilityAddressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
  },
  facilityAddress: {
    fontSize: fontSizePixels.sm,
    flex: 1,
  },
  noFacilitiesText: {
    fontSize: fontSizePixels.sm,
    textAlign: 'center',
    paddingVertical: spacingPixels[2],
  },
  playAttributesContainer: {
    marginTop: spacingPixels[3],
    paddingTop: spacingPixels[3],
    borderTopWidth: 1,
  },
  playAttributesTitle: {
    fontSize: fontSizePixels.xs,
    marginBottom: spacingPixels[2],
  },
  ratingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacingPixels[2],
  },
  ratingTitle: {
    fontSize: fontSizePixels.lg,
    fontWeight: fontWeightNumeric.bold,
    marginBottom: spacingPixels[1],
  },
  ratingCode: {
    fontSize: fontSizePixels.sm,
    fontWeight: fontWeightNumeric.semibold,
  },
  certifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.full,
  },
  certifiedText: {
    fontSize: fontSizePixels.xs,
    fontWeight: fontWeightNumeric.semibold,
  },
  ratingDescription: {
    fontSize: fontSizePixels.sm,
    lineHeight: 20,
    marginBottom: spacingPixels[3],
  },
  referencesBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacingPixels[1],
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.full,
    marginTop: spacingPixels[2],
  },
  referencesBadgeText: {
    fontSize: fontSizePixels.xs,
    fontWeight: fontWeightNumeric.semibold,
  },
  proofGalleryLoading: {
    paddingVertical: spacingPixels[3],
    alignItems: 'center',
  },
  proofGalleryList: {
    gap: spacingPixels[2],
  },
  proofGalleryCard: {
    width: PROOF_CARD_WIDTH,
    height: PROOF_CARD_HEIGHT,
    borderRadius: radiusPixels.md,
    overflow: 'hidden',
  },
  proofGalleryThumbnail: {
    width: '100%',
    height: '100%',
    position: 'absolute',
  },
  proofGalleryPlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  proofTypeBadge: {
    position: 'absolute',
    top: spacingPixels[1],
    left: spacingPixels[1],
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  proofPlayOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  proofPlayButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  proofGalleryTitleContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacingPixels[1],
    paddingVertical: spacingPixels[1],
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  proofGalleryTitle: {
    fontSize: fontSizePixels.xs,
    fontWeight: fontWeightNumeric.medium,
    color: '#fff',
  },
  profileBadgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    marginBottom: spacingPixels[1],
  },
  statsGrid: {
    flexDirection: 'row',
    gap: spacingPixels[3],
  },
  statCard: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[4],
    paddingHorizontal: spacingPixels[2],
    borderRadius: radiusPixels.xl,
    borderWidth: 1,
  },
  statValue: {
    fontSize: fontSizePixels['3xl'],
    lineHeight: fontSizePixels['3xl'] * 1.2,
    fontWeight: fontWeightNumeric.bold,
    marginBottom: spacingPixels[1],
    textAlign: 'center',
  },
  statLabel: {
    fontSize: 10,
    textAlign: 'center',
  },
  // Availability Grid Styles - Same as UserProfile
  availabilityGrid: {
    marginTop: spacingPixels[2],
  },
  availabilityRow: {
    flexDirection: 'row',
    marginBottom: spacingPixels[2],
    alignItems: 'center',
  },
  dayCell: {
    width: 50,
    justifyContent: 'center',
  },
  headerCell: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  slotWrapper: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: spacingPixels[1],
  },
  slotCell: {
    width: '100%',
    borderRadius: radiusPixels.lg,
    paddingVertical: spacingPixels[3],
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
});

export default PlayerProfile;
