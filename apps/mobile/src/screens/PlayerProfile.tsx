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
  Animated,
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
import {
  supabase,
  Logger,
  isPlayerOnline,
  computeBadgeStatus,
  getTierForScore,
  getTierConfig,
  MIN_EVENTS_FOR_PUBLIC,
  periodForHour,
} from '@rallia/shared-services';
import type { ReputationDisplay } from '@rallia/shared-services';
import { useGetOrCreateDirectConversation } from '@rallia/shared-hooks';
import { useThemeStyles, useTranslation, type TranslationKey } from '../hooks';
import { useSport, useUserHomeLocation } from '../context';
import { SportIcon } from '../components/SportIcon';
import { AvailabilityGrid as CompactAvailabilityGrid } from '../features/community/components';
import RatingBadge from '../components/RatingBadge';
import ReputationBadge from '../components/ReputationBadge';
import CovetedBadge from '../components/CovetedBadge';
import { withTimeout, getNetworkErrorMessage } from '../utils/networkTimeout';
import { getProfilePictureUrl, lightHaptic, mediumHaptic } from '@rallia/shared-utils';
import * as Analytics from '../services/analytics';
import type { RootStackParamList } from '../navigation/types';
import type { PeriodEnum, Profile, Player } from '@rallia/shared-types';
import { MATCH_DURATION_ENUM_LABELS } from '@rallia/shared-types';
import { LinearGradient } from 'expo-linear-gradient';
import {
  spacingPixels,
  radiusPixels,
  fontSizePixels,
  fontWeightNumeric,
  accent,
  neutral,
  primary,
  status,
} from '@rallia/design-system';
import { formatDateMonthYear } from '../utils/dateFormatting';
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

type PeriodKey = PeriodEnum;
type DayPeriods = Record<PeriodKey, boolean>;

interface AvailabilityGrid {
  [day: string]: DayPeriods;
}

const PERIOD_KEYS: PeriodKey[] = ['early', 'morning', 'midday', 'afternoon', 'evening', 'late'];

const EMPTY_DAY_PERIODS = (): DayPeriods => ({
  early: false,
  morning: false,
  midday: false,
  afternoon: false,
  evening: false,
  late: false,
});

const EMPTY_AVAIL_GRID = (): AvailabilityGrid => ({
  monday: EMPTY_DAY_PERIODS(),
  tuesday: EMPTY_DAY_PERIODS(),
  wednesday: EMPTY_DAY_PERIODS(),
  thursday: EMPTY_DAY_PERIODS(),
  friday: EMPTY_DAY_PERIODS(),
  saturday: EMPTY_DAY_PERIODS(),
  sunday: EMPTY_DAY_PERIODS(),
});

const DAYS_ORDER: string[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

interface PlayerStats {
  hoursPlayed: number;
  gamesHosted: number;
  weekStreak: number;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Returns the timestamp of Monday 00:00 (local time) for the week containing `date`.
const getWeekStart = (date: Date): number => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.getTime();
};

// Resolves a match's duration in minutes from the (duration, custom_duration_minutes)
// pair stored on `match`. Returns 0 when neither is usable.
const matchDurationMinutes = (m: {
  duration: '30' | '60' | '90' | '120' | 'custom' | null;
  custom_duration_minutes: number | null;
}): number => {
  if (m.duration === 'custom') return m.custom_duration_minutes ?? 0;
  if (m.duration == null) return 0;
  const n = Number(m.duration);
  return Number.isFinite(n) ? n : 0;
};

// Parse "YYYY-MM-DD" in local time. `new Date("YYYY-MM-DD")` would be UTC midnight,
// which can shift the day for users west of UTC and break week-bucketing.
const parseYMDLocal = (ymd: string): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
};

// Counts consecutive weeks (ending at the current or previous week) that contain
// at least one match. Caller is expected to pass already-filtered past dates.
const calculateWeekStreak = (matchDates: string[]): number => {
  if (matchDates.length === 0) return 0;
  const now = new Date();
  const currentWeekStart = getWeekStart(now);
  const playedWeeks = new Set<number>();
  for (const dateStr of matchDates) {
    const d = parseYMDLocal(dateStr);
    if (!d) continue;
    playedWeeks.add(getWeekStart(d));
  }
  if (playedWeeks.size === 0) return 0;
  let cursor: number;
  if (playedWeeks.has(currentWeekStart)) {
    cursor = currentWeekStart;
  } else if (playedWeeks.has(currentWeekStart - WEEK_MS)) {
    cursor = currentWeekStart - WEEK_MS;
  } else {
    return 0;
  }
  let streak = 0;
  while (playedWeeks.has(cursor)) {
    streak++;
    cursor -= WEEK_MS;
  }
  return streak;
};

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

// Rectangular accent-gradient pill: icon on the left, single-line label on the right.
const HeroActionButton: React.FC<{
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}> = ({ icon, label, onPress, loading = false, disabled = false }) => {
  const handlePress = () => {
    void lightHaptic();
    onPress();
  };
  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.85}
      disabled={loading || disabled}
      style={heroActionStyles.item}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: loading || disabled, busy: loading }}
    >
      <LinearGradient
        colors={[accent[300], accent[400], accent[500]]}
        locations={[0, 0.55, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[heroActionStyles.gradient, (loading || disabled) && { opacity: 0.6 }]}
      >
        <View style={heroActionStyles.topHighlight} />
        <View style={heroActionStyles.iconWrap}>
          {loading ? <ActivityIndicator size="small" color="#ffffff" /> : icon}
        </View>
        <Text
          size="sm"
          weight="semibold"
          color="#ffffff"
          style={heroActionStyles.label}
          numberOfLines={1}
        >
          {label}
        </Text>
      </LinearGradient>
    </TouchableOpacity>
  );
};

const heroActionStyles = StyleSheet.create({
  item: {
    borderRadius: radiusPixels.lg,
  },
  gradient: {
    flexDirection: 'row',
    borderRadius: radiusPixels.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[2],
    height: 44,
    paddingHorizontal: spacingPixels[4],
    overflow: 'hidden',
  },
  topHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  iconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    textAlign: 'center',
  },
});

const PlayerProfile = () => {
  const route = useRoute<PlayerProfileRouteProp>();
  const navigation = useNavigation<NavigationProp>();
  const { playerId, sportId } = route.params;
  const { colors, isDark } = useThemeStyles();

  // Skeleton loading colors
  const skeletonBg = isDark ? '#262626' : '#E1E9EE';
  const skeletonHighlight = isDark ? '#404040' : '#F2F8FC';
  // Tinted skeleton shades for use against the primary-tinted hero card —
  // matches PlayerCardSkeleton so they read as "loading" without clashing.
  const heroSkeletonBg = isDark ? primary[900] : primary[100];
  const heroSkeletonHighlight = isDark ? primary[800] : primary[50];
  const { t, locale } = useTranslation();
  const { selectedSport } = useSport();
  const { homeLocation } = useUserHomeLocation();
  const getOrCreateDirectConversation = useGetOrCreateDirectConversation();
  const [reputationDisplay, setReputationDisplay] = useState<ReputationDisplay | null>(null);
  const [reputationTotalEvents, setReputationTotalEvents] = useState<number>(0);
  const toast = useToast();

  useEffect(() => {
    Analytics.playerProfileViewed({ source: 'navigation' });
  }, [playerId]);

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [sports, setSports] = useState<SportWithRating[]>([]);
  const [sportPreferences, setSportPreferences] = useState<PlayerSportPreferences | null>(null);
  const [availabilities, setAvailabilities] = useState<AvailabilityGrid>({});
  // Default to the full 6×7 grid on profile view — the heatmap is reserved
  // for the PlayerCard widget where space is constrained. Tap "Hide details"
  // to collapse to the compact 2×3-dot heatmap if needed.
  const [availabilityExpanded, setAvailabilityExpanded] = useState(true);
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
  const onlineColor = isDark ? status.success.light : status.success.DEFAULT;
  const pulseAnim = useMemo(() => new Animated.Value(1), []);
  useEffect(() => {
    if (!isOnline) {
      pulseAnim.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.35, duration: 900, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => {
      loop.stop();
      pulseAnim.setValue(1);
    };
  }, [isOnline, pulseAnim]);
  const [favoriteFacilities, setFavoriteFacilities] = useState<FavoriteFacilityData[]>([]);
  const [favoriteFacilitiesLoading, setFavoriteFacilitiesLoading] = useState(true);
  const [referenceLoading, setReferenceLoading] = useState(false);
  const [approvedProofs, setApprovedProofs] = useState<RatingProofData[]>([]);
  const [proofsLoading, setProofsLoading] = useState(false);
  const [selectedProof, setSelectedProof] = useState<RatingProofData | null>(null);
  const [showProofViewer, setShowProofViewer] = useState(false);

  // Convert PlayerProfile's boolean grid into the {day: [period, …]} shape
  // the compact AvailabilityGrid widget expects. Empty days are omitted so
  // the widget renders them muted.
  const availabilityForCompactWidget = useMemo(() => {
    const result: Partial<Record<string, PeriodKey[]>> = {};
    for (const day of DAYS_ORDER) {
      const dayData = availabilities[day];
      if (!dayData) continue;
      const periods = PERIOD_KEYS.filter(p => dayData[p]);
      if (periods.length > 0) result[day] = periods;
    }
    return Object.keys(result).length > 0 ? result : null;
  }, [availabilities]);

  // Calculate distance from current user to this player
  const distanceText = useMemo(() => {
    if (!homeLocation || !player?.latitude || !player?.longitude) return '';
    const R = 6371000; // Earth's radius in meters
    const lat1Rad = (homeLocation.latitude * Math.PI) / 180;
    const lat2Rad = (player.latitude * Math.PI) / 180;
    const deltaLat = ((player.latitude - homeLocation.latitude) * Math.PI) / 180;
    const deltaLon = ((player.longitude - homeLocation.longitude) * Math.PI) / 180;
    const a =
      Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
      Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const meters = R * c;
    if (meters < 100) return t('playerDirectory.nearby');
    if (meters < 1000) return `${Math.round(meters)} m`;
    return `${(meters / 1000).toFixed(1)} km`;
  }, [homeLocation, player?.latitude, player?.longitude, t]);

  // Calendar-day "last active" label — matches PlayerCard semantics exactly.
  const lastSeenLabel = useMemo(() => {
    if (isOnline || !player?.last_seen_at) return null;
    const seen = new Date(player.last_seen_at);
    const now = new Date();
    if (seen.getTime() > now.getTime()) return null;
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfSeen = new Date(seen.getFullYear(), seen.getMonth(), seen.getDate()).getTime();
    const diffDays = Math.round((startOfToday - startOfSeen) / 86_400_000);
    if (diffDays <= 0) return t('playerDirectory.lastSeenToday');
    if (diffDays === 1) return t('playerDirectory.lastSeenYesterday');
    if (diffDays <= 14) return t('playerDirectory.lastSeenDaysAgo', { count: diffDays });
    return null;
  }, [isOnline, player?.last_seen_at, t]);

  // Fetch favorite facilities for the player being viewed (separate from main data fetch)
  useEffect(() => {
    const fetchFavoriteFacilities = async () => {
      setFavoriteFacilitiesLoading(true);
      try {
        let query = supabase
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

        if (sportId) {
          query = query.eq('sport_id', sportId);
        }

        const { data, error } = await query;

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
  }, [playerId, sportId]);

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
        reputationResult,
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

        // Fetch player availabilities — hourly rows; folded back into the
        // legacy period grid downstream via periodForHour().
        withTimeout(
          (async () =>
            supabase
              .from('player_availability')
              .select('day, hour_of_day, is_active')
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

        // Fetch reputation data
        withTimeout(
          (async () =>
            supabase
              .from('player_reputation')
              .select(
                'reputation_score, reputation_tier, total_events, matches_completed, is_public'
              )
              .eq('player_id', playerId)
              .maybeSingle())(),
          15000,
          'Failed to load reputation'
        ),

        // Fetch match statistics. A match counts as "actually played" when:
        //   - participant.status = 'joined' (player committed)
        //   - participant.showed_up != false (NULL = feedback pending; treat as played)
        //   - match.closed_at IS NOT NULL (match was finalized 48h after end_time)
        //   - match.cancelled_at IS NULL (not cancelled)
        //   - match.mutually_cancelled IS NOT TRUE (not all-mutual no-show)
        // closed_at being non-null implies the match is in the past, so no extra date check.
        withTimeout(
          (async () =>
            supabase
              .from('match_participant')
              .select(
                'match_id, showed_up, match:match_id (match_date, duration, custom_duration_minutes, created_by, closed_at, cancelled_at, mutually_cancelled)'
              )
              .eq('player_id', playerId)
              .eq('status', 'joined'))(),
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

      // Process reputation
      if (reputationResult.data && !reputationResult.error) {
        const rep = reputationResult.data as {
          reputation_score: number;
          reputation_tier: string;
          total_events: number;
          matches_completed: number;
          is_public: boolean;
        };
        const tier = getTierForScore(rep.reputation_score, rep.total_events);
        const tierConfig = getTierConfig(tier);
        setReputationDisplay({
          tier,
          score: rep.reputation_score,
          isVisible: rep.is_public,
          tierLabel: tierConfig.label,
          tierColor: tierConfig.color,
          tierIcon: tierConfig.icon,
        });
        setReputationTotalEvents(rep.total_events);
      } else {
        setReputationDisplay(null);
        setReputationTotalEvents(0);
      }

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

          // Get the current rating_score_id and value from the rating
          const ratingScore = rating.rating_score as { id?: string; value?: number | null } | null;
          const currentRatingScoreId = ratingScore?.id || rating.rating_score_id;
          const currentValue = ratingScore?.value ?? null;

          if (rating.id) {
            // Fetch all proofs with their rating_score value
            const { data: proofs, error: proofsError } = await supabase
              .from('rating_proof')
              .select('rating_score_id, rating_score:rating_score_id(value)')
              .eq('player_rating_score_id', rating.id)
              .eq('is_active', true);

            if (!proofsError && proofs) {
              // Total count: all proofs
              totalProofsCount = proofs.length;

              // Current-level count: proofs at current rating or higher
              currentLevelProofsCount =
                currentValue == null
                  ? 0
                  : proofs.filter(p => {
                      const score = p.rating_score as unknown as { value: number } | null;
                      return score && score.value >= currentValue;
                    }).length;
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

        const referralsCount = rating.referrals_count || 0;
        const currentLevelProofsCount = rating.currentLevelProofsCount || 0;
        const totalProofsCount = rating.totalProofsCount || 0;
        const peerEvalCount = rating.peer_evaluation_count || 0;

        const badgeStatus = computeBadgeStatus({
          rawBadgeStatus: rating.badge_status as string | undefined,
          isCertified: rating.is_certified ?? false,
          referralsCount,
          approvedProofsCount: currentLevelProofsCount,
        });

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

      const availGrid = EMPTY_AVAIL_GRID();

      (availData || []).forEach(avail => {
        const day = avail.day as keyof AvailabilityGrid;
        const period = periodForHour(avail.hour_of_day as number) as PeriodKey | undefined;
        if (period && availGrid[day] && period in availGrid[day]) {
          availGrid[day][period] = true;
        }
      });

      setAvailabilities(availGrid);

      // Process stats
      if (statsResult.error) {
        Logger.error('Failed to load player stats', statsResult.error as Error, { playerId });
      } else if (statsResult.data) {
        type MatchRow = {
          match_date: string | null;
          duration: '30' | '60' | '90' | '120' | 'custom' | null;
          custom_duration_minutes: number | null;
          created_by: string;
          closed_at: string | null;
          cancelled_at: string | null;
          mutually_cancelled: boolean | null;
        };
        type MatchData = {
          match_id: string;
          showed_up: boolean | null;
          match: MatchRow | null;
        };
        const matchData = statsResult.data as unknown as MatchData[];

        // Matches that actually happened with this player on the court.
        const playedMatches = matchData.filter(
          m =>
            !!m.match &&
            m.match.closed_at !== null &&
            m.match.cancelled_at === null &&
            m.match.mutually_cancelled !== true &&
            m.showed_up !== false
        );

        const totalMinutes = playedMatches.reduce(
          (sum, m) => sum + matchDurationMinutes(m.match!),
          0
        );
        const hostedMatches = playedMatches.filter(m => m.match!.created_by === playerId).length;
        const playedDates = playedMatches
          .map(m => m.match!.match_date)
          .filter((d): d is string => !!d);

        setStats({
          hoursPlayed: Math.round(totalMinutes / 60),
          gamesHosted: hostedMatches,
          weekStreak: calculateWeekStreak(playedDates),
        });
      }
    } catch (error) {
      Logger.error('Failed to fetch player profile', error as Error, { playerId });
      Alert.alert(t('alerts.error'), getNetworkErrorMessage(error));
    } finally {
      setLoading(false);
    }
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

      // Check if viewed player is certified (only certified players can give valid references)
      if (!viewedPlayerSport.isCertified) {
        toast.warning(t('playerProfile.referenceRequest.playerNotCertified'));
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

      // Check if a request already exists for this player/rating (pending or completed)
      const { count: existingCount } = await supabase
        .from('rating_reference_request')
        .select('id', { count: 'exact', head: true })
        .eq('requester_id', currentUserId)
        .eq('referee_id', playerId)
        .eq('player_rating_score_id', currentUserRatingScoreId)
        .in('status', ['pending', 'completed']);

      if (existingCount && existingCount > 0) {
        toast.warning(t('profile.certification.referenceRequest.alreadyRequested'));
        return;
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
        Analytics.playerBlocked();
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

  // Block + favorite icons in the screen header right
  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacingPixels[3],
            marginRight: spacingPixels[2],
          }}
        >
          <TouchableOpacity
            onPress={handleToggleBlock}
            disabled={blockLoading || !currentUserId}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            {blockLoading ? (
              <ActivityIndicator size="small" color={colors.headerForeground} />
            ) : (
              <Ionicons
                name={isBlocked ? 'ban' : 'ban-outline'}
                size={22}
                color={isBlocked ? status.error.DEFAULT : colors.headerForeground}
              />
            )}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleToggleFavorite}
            disabled={favoriteLoading || !currentUserId || isBlocked}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            {favoriteLoading ? (
              <ActivityIndicator size="small" color={colors.headerForeground} />
            ) : (
              <Ionicons
                name={isFavorite ? 'heart' : 'heart-outline'}
                size={24}
                color={
                  isFavorite
                    ? status.error.DEFAULT
                    : isBlocked
                      ? colors.border
                      : colors.headerForeground
                }
              />
            )}
          </TouchableOpacity>
        </View>
      ),
    });
  }, [
    navigation,
    currentUserId,
    blockLoading,
    favoriteLoading,
    isBlocked,
    isFavorite,
    handleToggleBlock,
    handleToggleFavorite,
    colors.headerForeground,
    colors.border,
  ]);

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
      const currentValue = primarySport?.ratingValue;
      if (!prsId || currentValue == null) {
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
            file:file_id(id, url, thumbnail_url, file_type, original_name, mime_type),
            rating_score:rating_score_id!inner(value)
          `
          )
          .eq('player_rating_score_id', prsId)
          .eq('is_active', true)
          .gte('rating_score.value', currentValue)
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
  }, [primarySport?.playerRatingScoreId, primarySport?.ratingValue]);

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
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={[]}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Profile Header Skeleton */}
          <View
            style={[
              styles.profileHeader,
              {
                backgroundColor: isDark ? primary[950] : primary[50],
                borderColor: isDark ? `${primary[400]}40` : `${primary[500]}20`,
              },
            ]}
          >
            <View style={styles.profileTopRow}>
              <SkeletonAvatar
                size={100}
                backgroundColor={heroSkeletonBg}
                highlightColor={heroSkeletonHighlight}
              />
              <View style={styles.profileIdentity}>
                {/* Name */}
                <Skeleton
                  width="55%"
                  height={24}
                  borderRadius={4}
                  backgroundColor={heroSkeletonBg}
                  highlightColor={heroSkeletonHighlight}
                />
                {/* Location row: pin · distance · separator · activity */}
                <View style={styles.locationRow}>
                  <Skeleton
                    width={13}
                    height={13}
                    circle
                    backgroundColor={heroSkeletonBg}
                    highlightColor={heroSkeletonHighlight}
                  />
                  <Skeleton
                    width={42}
                    height={14}
                    borderRadius={4}
                    backgroundColor={heroSkeletonBg}
                    highlightColor={heroSkeletonHighlight}
                  />
                  <Skeleton
                    width={3}
                    height={3}
                    circle
                    backgroundColor={heroSkeletonBg}
                    highlightColor={heroSkeletonHighlight}
                  />
                  <Skeleton
                    width={62}
                    height={14}
                    borderRadius={4}
                    backgroundColor={heroSkeletonBg}
                    highlightColor={heroSkeletonHighlight}
                  />
                </View>
                {/* Joined date row */}
                <View style={styles.joinedRow}>
                  <Skeleton
                    width={13}
                    height={13}
                    circle
                    backgroundColor={heroSkeletonBg}
                    highlightColor={heroSkeletonHighlight}
                  />
                  <Skeleton
                    width={110}
                    height={14}
                    borderRadius={4}
                    backgroundColor={heroSkeletonBg}
                    highlightColor={heroSkeletonHighlight}
                  />
                </View>
                {/* Badges row */}
                <View style={styles.profileBadgesRow}>
                  <Skeleton
                    width={80}
                    height={26}
                    borderRadius={radiusPixels.full}
                    backgroundColor={heroSkeletonBg}
                    highlightColor={heroSkeletonHighlight}
                  />
                  <Skeleton
                    width={60}
                    height={26}
                    borderRadius={radiusPixels.full}
                    backgroundColor={heroSkeletonBg}
                    highlightColor={heroSkeletonHighlight}
                  />
                  <Skeleton
                    width={80}
                    height={26}
                    borderRadius={radiusPixels.full}
                    backgroundColor={heroSkeletonBg}
                    highlightColor={heroSkeletonHighlight}
                  />
                </View>
              </View>
            </View>
          </View>

          {/* Action buttons skeleton (horizontal scroll under the card) */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.actionScrollContent}
            style={styles.actionScroll}
          >
            <Skeleton
              width={160}
              height={44}
              borderRadius={radiusPixels.lg}
              backgroundColor={skeletonBg}
              highlightColor={skeletonHighlight}
            />
            <Skeleton
              width={120}
              height={44}
              borderRadius={radiusPixels.lg}
              backgroundColor={skeletonBg}
              highlightColor={skeletonHighlight}
            />
            <Skeleton
              width={180}
              height={44}
              borderRadius={radiusPixels.lg}
              backgroundColor={skeletonBg}
              highlightColor={skeletonHighlight}
            />
          </ScrollView>

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
        </ScrollView>
      </SafeAreaView>
    );
  }

  const displayName =
    `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim() ||
    profile?.display_name ||
    t('common.player');

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={[]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Profile Header */}
        <View
          style={[
            styles.profileHeader,
            {
              backgroundColor: isDark ? primary[950] : primary[50],
              borderColor: isDark ? `${primary[400]}40` : `${primary[500]}20`,
            },
          ]}
        >
          <View style={styles.profileTopRow}>
            <View style={styles.avatarWrapper}>
              <View
                style={[
                  styles.profilePicContainer,
                  {
                    borderColor: isDark ? primary[400] : primary[500],
                    shadowColor: isDark ? primary[400] : primary[500],
                  },
                ]}
              >
                {profile?.profile_picture_url ? (
                  <Image
                    source={{ uri: getProfilePictureUrl(profile.profile_picture_url) || '' }}
                    style={styles.profileImage}
                  />
                ) : (
                  <Ionicons name="person-outline" size={40} color={colors.primary} />
                )}
              </View>
            </View>

            <View style={styles.profileIdentity}>
              <Text style={[styles.profileName, { color: colors.text }]} numberOfLines={1}>
                {displayName}
              </Text>
              {/* Location + activity — same layout as PlayerCard locationRow */}
              {(!!distanceText || isOnline || !!lastSeenLabel) && (
                <View style={styles.locationRow}>
                  {!!distanceText && (
                    <>
                      <Ionicons name="location" size={13} color={colors.textMuted} />
                      <Text
                        size="sm"
                        color={colors.textMuted}
                        numberOfLines={1}
                        style={styles.locationDistance}
                      >
                        {distanceText}
                      </Text>
                    </>
                  )}
                  {!!distanceText && (isOnline || !!lastSeenLabel) && (
                    <Text size="sm" color={colors.textMuted}>
                      ·
                    </Text>
                  )}
                  {isOnline ? (
                    <View style={styles.onlineInline}>
                      <Animated.View
                        style={[
                          styles.onlineDot,
                          { backgroundColor: onlineColor, opacity: pulseAnim },
                        ]}
                      />
                      <Text size="sm" weight="semibold" color={onlineColor} numberOfLines={1}>
                        {t('playerDirectory.online')}
                      </Text>
                    </View>
                  ) : lastSeenLabel ? (
                    <Text
                      size="sm"
                      color={colors.textMuted}
                      numberOfLines={1}
                      style={styles.activityText}
                    >
                      {lastSeenLabel}
                    </Text>
                  ) : null}
                </View>
              )}

              {/* Joined date */}
              {player?.created_at && (
                <View style={styles.joinedRow}>
                  <Ionicons name="calendar-outline" size={13} color={colors.textMuted} />
                  <Text size="sm" color={colors.textMuted} numberOfLines={1}>
                    {t('playerProfile.joined')} {formatDateMonthYear(player.created_at, locale)}
                  </Text>
                </View>
              )}

              {/* Badges row */}
              <View style={styles.profileBadgesRow}>
                <CovetedBadge
                  reputationScore={reputationDisplay?.score}
                  certificationStatus={primarySport?.badgeStatus}
                  totalEvents={reputationTotalEvents}
                  isDark={isDark}
                  isLoading={loading}
                />
                <RatingBadge
                  ratingValue={primarySport?.ratingValue}
                  ratingLabel={primarySport?.ratingLabel}
                  certificationStatus={
                    primarySport?.badgeStatus as
                      | 'self_declared'
                      | 'certified'
                      | 'disputed'
                      | undefined
                  }
                  isDark={isDark}
                  isLoading={loading}
                  onInfoPress={() =>
                    SheetManager.show('rating-explainer', {
                      payload: {
                        sportName: (primarySport?.name as 'tennis' | 'pickleball') ?? 'tennis',
                      },
                    })
                  }
                />
                <ReputationBadge
                  reputationDisplay={reputationDisplay ?? undefined}
                  isDark={isDark}
                  isLoading={loading}
                  onInfoPress={() => SheetManager.show('reputation-explainer')}
                />
              </View>
            </View>
          </View>
        </View>

        {/* Action buttons — horizontal scroll, transparent, sits under the hero card */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.actionScrollContent}
          style={styles.actionScroll}
        >
          <HeroActionButton
            label={t('playerProfile.inviteToMatch')}
            onPress={handleInviteToMatch}
            icon={
              <SportIcon sportName={selectedSport?.name ?? 'tennis'} size={18} color="#ffffff" />
            }
          />
          <HeroActionButton
            label={t('playerProfile.chat')}
            onPress={handleStartChat}
            loading={chatLoading}
            disabled={!currentUserId}
            icon={<Ionicons name="chatbubble-outline" size={18} color="#ffffff" />}
          />
          <HeroActionButton
            label={t('playerProfile.requestReference')}
            onPress={handleRequestReference}
            loading={referenceLoading}
            icon={<Ionicons name="document-text-outline" size={18} color="#ffffff" />}
          />
        </ScrollView>

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
                  {(primarySport.referencesCount ?? 0) > 0 && primarySport.playerRatingScoreId && (
                    <TouchableOpacity
                      style={[styles.referencesBadge, { backgroundColor: `${colors.primary}15` }]}
                      onPress={() => {
                        lightHaptic();
                        SheetManager.show('references-list', {
                          payload: {
                            playerRatingScoreId: primarySport.playerRatingScoreId!,
                            sportId: primarySport.id,
                          },
                        });
                      }}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="people-outline" size={14} color={colors.primary} />
                      <Text style={[styles.referencesBadgeText, { color: colors.primary }]}>
                        {t('profile.rating.references', {
                          count: primarySport.referencesCount || 0,
                        })}
                      </Text>
                      <Ionicons name="chevron-forward" size={12} color={colors.primary} />
                    </TouchableOpacity>
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
              {(proofsLoading || approvedProofs.length > 0) && (
                <Text style={[styles.proofGallerySectionTitle, { color: colors.text }]}>
                  {t('playerProfile.rating.proofGalleryTitle' as TranslationKey)}
                </Text>
              )}
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
                currentUserId={currentUserId}
                isOwnProfile={false}
                onReport={(proofId, proofTitle) => {
                  setShowProofViewer(false);
                  setSelectedProof(null);
                  // Delay to let the Modal unmount before opening the sheet
                  setTimeout(() => {
                    if (currentUserId) {
                      SheetManager.show('report-proof', {
                        payload: { reporterId: currentUserId, proofId, proofTitle },
                      });
                    }
                  }, 350);
                }}
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
              {!availabilityExpanded ? (
                <>
                  {/* Compact AM/PM heatmap — same widget as PlayerCard. */}
                  <View style={styles.availabilityCompactWrapper}>
                    <CompactAvailabilityGrid
                      availability={availabilityForCompactWidget ?? null}
                      activeColor={colors.primary}
                      mutedColor={colors.textMuted}
                    />
                  </View>
                  <TouchableOpacity
                    style={styles.availabilityToggle}
                    onPress={() => setAvailabilityExpanded(true)}
                    activeOpacity={0.7}
                  >
                    <Text size="sm" weight="semibold" color={colors.primary}>
                      {t('playerProfile.availability.showDetails')}
                    </Text>
                    <Ionicons name="chevron-down" size={16} color={colors.primary} />
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  {/* Full 6×7 grid: time-block rows, day-letter columns. */}
                  <View style={styles.availabilityGrid}>
                    <View style={styles.availabilityRow}>
                      <View style={styles.dayCell} />
                      {DAYS_ORDER.map(day => (
                        <View key={`hdr-${day}`} style={styles.headerCell}>
                          <Text size="xs" weight="semibold" color={colors.textMuted}>
                            {t(`playerDirectory.dayLetters.${day}` as TranslationKey)}
                          </Text>
                        </View>
                      ))}
                    </View>

                    {PERIOD_KEYS.map(period => (
                      <View key={period} style={styles.availabilityRow}>
                        <View style={styles.dayCell}>
                          <Text size="sm" weight="semibold" color={colors.text}>
                            {t(`onboarding.availabilityStep.${period}` as TranslationKey)}
                          </Text>
                          <Text size="xs" color={colors.textMuted} style={styles.timeRangeText}>
                            {t(`onboarding.availabilityStep.${period}Range` as TranslationKey)}
                          </Text>
                        </View>
                        {DAYS_ORDER.map(day => {
                          const isSelected = availabilities[day]?.[period] ?? false;
                          return (
                            <View
                              key={`${period}-${day}`}
                              style={[
                                styles.slotCell,
                                {
                                  backgroundColor: colors.inputBackground,
                                  borderColor: colors.inputBorder,
                                },
                                isSelected && {
                                  backgroundColor: colors.primary,
                                  borderColor: colors.primary,
                                },
                              ]}
                            />
                          );
                        })}
                      </View>
                    ))}
                  </View>
                  <TouchableOpacity
                    style={styles.availabilityToggle}
                    onPress={() => setAvailabilityExpanded(false)}
                    activeOpacity={0.7}
                  >
                    <Text size="sm" weight="semibold" color={colors.primary}>
                      {t('playerProfile.availability.hideDetails')}
                    </Text>
                    <Ionicons name="chevron-up" size={16} color={colors.primary} />
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        )}
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
  scrollContent: {
    paddingBottom: spacingPixels[10],
  },
  profileHeader: {
    marginTop: spacingPixels[4],
    marginHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[5],
    paddingHorizontal: spacingPixels[4],
    borderRadius: radiusPixels.xl,
    borderWidth: 1,
    position: 'relative',
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
  avatarWrapper: {
    position: 'relative',
  },
  profilePicContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  profileImage: {
    width: '100%',
    height: '100%',
  },
  profileName: {
    fontSize: fontSizePixels.xl,
    fontWeight: fontWeightNumeric.bold,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
  },
  joinedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
  },
  locationDistance: {
    flexShrink: 1,
    minWidth: 0,
  },
  onlineInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    flexShrink: 0,
  },
  onlineDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  activityText: {
    flexShrink: 1,
    minWidth: 0,
  },
  actionScroll: {
    marginTop: spacingPixels[3],
  },
  actionScrollContent: {
    paddingHorizontal: spacingPixels[4],
    gap: spacingPixels[2],
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
  proofGallerySectionTitle: {
    fontSize: fontSizePixels.sm,
    fontWeight: fontWeightNumeric.semibold,
    marginTop: spacingPixels[3],
    marginBottom: spacingPixels[2],
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
    flexWrap: 'wrap',
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
  // Availability Grid Styles — kept in sync with AvailabilitiesStep,
  // PlayerAvailabilitiesOverlay, and UserProfile so all four surfaces feel
  // identical.
  availabilityGrid: {
    marginTop: spacingPixels[2],
  },
  availabilityRow: {
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
  slotCell: {
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
  availabilityCompactWrapper: {
    paddingVertical: spacingPixels[2],
    paddingHorizontal: spacingPixels[2],
  },
  availabilityToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[1],
    paddingTop: spacingPixels[3],
    marginTop: spacingPixels[2],
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
  },
});

export default PlayerProfile;
