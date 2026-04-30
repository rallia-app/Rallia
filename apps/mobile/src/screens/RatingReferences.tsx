/**
 * RatingReferences Screen
 *
 * Lets a player review reference requests they've sent for a given
 * player_rating_score. Horizontal filter chips (All / Approved / Contested /
 * Pending) switch the visible subset. Header "+" opens the reference-request
 * sheet to send new requests.
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  ScrollView,
  Animated,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { SheetManager } from 'react-native-actions-sheet';
import { Text, Skeleton, useToast } from '@rallia/shared-components';
import {
  supabase,
  Logger,
  notifyReferenceRequestReceived,
  computeBadgeStatus,
} from '@rallia/shared-services';
import { usePlayer } from '@rallia/shared-hooks';
import { lightHaptic, getHumanName, getProfilePictureUrl } from '@rallia/shared-utils';
import type { RatingReferencesScreenParams } from '@rallia/shared-types';
import {
  spacingPixels,
  radiusPixels,
  fontSizePixels,
  primary,
  neutral,
  status as statusColors,
} from '@rallia/design-system';

import { useThemeStyles, useTranslation, useNavigateToPlayerProfile } from '../hooks';
import RatingBadge from '../components/RatingBadge';
import { formatDateShort } from '../utils/dateFormatting';

type RatingReferencesRouteProp = RouteProp<
  { RatingReferences: RatingReferencesScreenParams },
  'RatingReferences'
>;

type ReferenceStatus = 'pending' | 'completed' | 'declined' | 'expired' | 'cancelled';

interface RefereeRating {
  label: string | null;
  value: number | null;
  badgeStatus: 'self_declared' | 'certified' | 'disputed';
}

interface ReferenceRow {
  id: string;
  referee_id: string;
  status: ReferenceStatus;
  rating_supported: boolean;
  message: string | null;
  response_message: string | null;
  responded_at: string | null;
  expires_at: string;
  created_at: string;
  rating_score_id: string | null;
  rating_score: { label: string | null; value: number | null } | null;
  referee: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    display_name: string | null;
    profile_picture_url: string | null;
  } | null;
  referee_rating: RefereeRating | null;
}

type FilterKey = 'all' | 'approved' | 'contested' | 'pending';

const FILTERS: { key: FilterKey; icon?: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'all' },
  { key: 'approved', icon: 'checkmark-circle-outline' },
  { key: 'contested', icon: 'alert-circle-outline' },
  { key: 'pending', icon: 'hourglass-outline' },
];

function isApproved(r: ReferenceRow): boolean {
  return r.status === 'completed' && r.rating_supported === true;
}
function isContested(r: ReferenceRow): boolean {
  return r.status === 'completed' && r.rating_supported === false;
}
function isPending(r: ReferenceRow): boolean {
  return r.status === 'pending' && new Date(r.expires_at).getTime() > Date.now();
}

function getRefereeFullName(referee: ReferenceRow['referee'], fallback: string): string {
  if (!referee) return fallback;
  const name = `${referee.first_name ?? ''} ${referee.last_name ?? ''}`.trim();
  return name || fallback;
}

function daysUntil(isoDate: string): number {
  const diffMs = new Date(isoDate).getTime() - Date.now();
  return Math.max(0, Math.ceil(diffMs / 86400000));
}

// =============================================================================
// FILTER CHIP
// =============================================================================

interface ChipProps {
  label: string;
  isActive: boolean;
  onPress: () => void;
  isDark: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
}

function FilterChip({ label, isActive, onPress, isDark, icon }: ChipProps) {
  const scaleAnim = useMemo(() => new Animated.Value(1), []);

  const bgColor = isActive ? primary[500] : isDark ? neutral[800] : neutral[100];
  const borderColor = isActive ? primary[400] : isDark ? neutral[700] : neutral[200];
  const textColor = isActive ? '#ffffff' : isDark ? neutral[300] : neutral[600];

  const handlePress = () => {
    lightHaptic();
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 0.95, duration: 50, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 1, duration: 50, useNativeDriver: true }),
    ]).start();
    onPress();
  };

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        style={[styles.chip, { backgroundColor: bgColor, borderColor }]}
        onPress={handlePress}
        activeOpacity={0.85}
      >
        {icon && <Ionicons name={icon} size={14} color={textColor} style={styles.chipIcon} />}
        <Text size="xs" weight={isActive ? 'semibold' : 'medium'} color={textColor}>
          {label}
        </Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

// =============================================================================
// SCREEN
// =============================================================================

const RatingReferences: React.FC = () => {
  const navigation = useNavigation();
  const route = useRoute<RatingReferencesRouteProp>();
  const {
    playerRatingScoreId,
    sportId,
    sportName,
    ratingValue,
    ratingLabel,
    ratingSystemCode,
    openSheet,
  } = route.params;

  const { colors, isDark } = useThemeStyles();
  const { t, locale } = useTranslation();
  const toast = useToast();
  const navigateToPlayerProfile = useNavigateToPlayerProfile();
  const { player } = usePlayer();
  const userId = player?.id || '';

  const [references, setReferences] = useState<ReferenceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>('all');

  const fetchReferences = useCallback(async () => {
    if (!playerRatingScoreId) return;
    setLoading(true);
    try {
      const { data: rows, error } = await supabase
        .from('rating_reference_request')
        .select(
          `
          id,
          referee_id,
          status,
          rating_supported,
          message,
          response_message,
          responded_at,
          expires_at,
          created_at,
          rating_score_id,
          rating_score:rating_score_id ( label, value )
        `
        )
        .eq('player_rating_score_id', playerRatingScoreId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Fetch referee profiles in a second query (FK on referee_id points to
      // player, not profile, so PostgREST can't auto-embed).
      const refereeIds = Array.from(new Set((rows || []).map(r => r.referee_id)));
      const profilesById = new Map<string, ReferenceRow['referee']>();
      const refereeRatingsById = new Map<string, RefereeRating>();

      if (refereeIds.length > 0) {
        const [profilesRes, ratingsRes] = await Promise.all([
          supabase
            .from('profile')
            .select('id, first_name, last_name, display_name, profile_picture_url')
            .in('id', refereeIds),
          supabase
            .from('player_rating_score')
            .select(
              `
              player_id,
              is_certified,
              badge_status,
              referrals_count,
              rating_score:rating_score_id!inner (
                label,
                value,
                rating_system:rating_system_id!inner ( sport_id )
              )
            `
            )
            .in('player_id', refereeIds)
            .eq('rating_score.rating_system.sport_id', sportId),
        ]);

        if (profilesRes.error) throw profilesRes.error;
        if (ratingsRes.error) throw ratingsRes.error;

        for (const p of profilesRes.data || []) {
          profilesById.set(p.id, p);
        }

        type RatingRow = {
          player_id: string;
          is_certified: boolean;
          badge_status: string | null;
          referrals_count: number | null;
          rating_score:
            | { label: string | null; value: number | null }
            | { label: string | null; value: number | null }[]
            | null;
        };
        for (const row of (ratingsRes.data || []) as RatingRow[]) {
          const rsRaw = row.rating_score;
          const rs = Array.isArray(rsRaw) ? rsRaw[0] : rsRaw;
          if (!rs) continue;
          // If the player has multiple rating scores for this sport, keep the highest.
          const existing = refereeRatingsById.get(row.player_id);
          if (
            !existing ||
            (rs.value != null && existing.value != null && rs.value > existing.value)
          ) {
            const badgeStatus = computeBadgeStatus({
              rawBadgeStatus: row.badge_status,
              isCertified: row.is_certified,
              referralsCount: row.referrals_count ?? 0,
            });
            refereeRatingsById.set(row.player_id, {
              label: rs.label,
              value: rs.value,
              badgeStatus,
            });
          }
        }
      }

      const enriched: ReferenceRow[] = (rows || []).map(r => ({
        ...(r as unknown as Omit<ReferenceRow, 'referee' | 'referee_rating'>),
        referee: profilesById.get(r.referee_id) ?? null,
        referee_rating: refereeRatingsById.get(r.referee_id) ?? null,
      }));
      setReferences(enriched);
    } catch (error) {
      Logger.error('Failed to fetch references', error as Error, { playerRatingScoreId });
      toast.error(t('profile.referencesManage.error'));
    } finally {
      setLoading(false);
    }
  }, [playerRatingScoreId, sportId, toast, t]);

  // Send-reference-requests handler (moved from SportProfile.tsx)
  const handleSendReferenceRequests = useCallback(
    async (selectedPlayerIds: string[]) => {
      try {
        if (!playerRatingScoreId || !userId) {
          throw new Error('Missing required data for reference request');
        }

        Logger.logUserAction('send_reference_requests', {
          count: selectedPlayerIds.length,
          playerRatingScoreId,
        });

        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 14);

        const referenceRequests = selectedPlayerIds.map(refereePlayerId => ({
          player_rating_score_id: playerRatingScoreId,
          requester_id: userId,
          referee_id: refereePlayerId,
          status: 'pending' as const,
          expires_at: expiresAt.toISOString(),
        }));

        const { data: insertedRequests, error: insertError } = await supabase
          .from('rating_reference_request')
          .insert(referenceRequests)
          .select('id, referee_id');

        if (insertError) {
          if (insertError.code === '23505') {
            toast.warning(t('profile.certification.referenceRequest.alreadyRequested'));
          } else {
            throw insertError;
          }
        } else {
          toast.success(t('alerts.referenceRequestsSent', { count: selectedPlayerIds.length }));

          if (insertedRequests?.length) {
            const { data: profile } = await supabase
              .from('profile')
              .select('first_name, last_name, display_name')
              .eq('id', userId)
              .single();

            const requesterName = getHumanName(profile, 'A player');

            for (const req of insertedRequests) {
              notifyReferenceRequestReceived(
                req.referee_id,
                req.id,
                requesterName,
                sportName,
                ratingLabel,
                playerRatingScoreId
              ).catch(err => {
                Logger.error('Failed to send reference request notification', err);
              });
            }
          }

          void fetchReferences();
        }

        void SheetManager.hide('reference-request');
      } catch (error) {
        Logger.error('Failed to send reference requests', error as Error, {
          count: selectedPlayerIds.length,
          playerRatingScoreId,
        });
        toast.error(t('alerts.failedToSendReferenceRequests'));
      }
    },
    [playerRatingScoreId, userId, sportName, ratingLabel, toast, t, fetchReferences]
  );

  const handleRequestReference = useCallback(() => {
    lightHaptic();
    SheetManager.show('reference-request', {
      payload: {
        currentUserId: userId,
        sportId,
        currentUserRatingScore: ratingValue,
        currentUserRatingScoreId: playerRatingScoreId,
        ratingSystemCode,
        onSendRequests: handleSendReferenceRequests,
      },
    });
  }, [
    userId,
    sportId,
    ratingValue,
    playerRatingScoreId,
    ratingSystemCode,
    handleSendReferenceRequests,
  ]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: t('profile.referencesManage.title'),
      headerRight: () => (
        <TouchableOpacity
          onPress={handleRequestReference}
          style={{ marginRight: spacingPixels[2] }}
        >
          <Ionicons name="add-outline" size={28} color={colors.headerForeground} />
        </TouchableOpacity>
      ),
    });
  }, [navigation, colors.headerForeground, handleRequestReference, t]);

  useEffect(() => {
    void fetchReferences();
  }, [fetchReferences]);

  // Auto-open via openSheet=request
  useEffect(() => {
    if (openSheet === 'request' && playerRatingScoreId) {
      handleRequestReference();
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredReferences = useMemo(() => {
    switch (filter) {
      case 'approved':
        return references.filter(isApproved);
      case 'contested':
        return references.filter(isContested);
      case 'pending':
        return references.filter(isPending);
      case 'all':
      default:
        return references.filter(r => isApproved(r) || isContested(r) || isPending(r));
    }
  }, [references, filter]);

  const handleFilterPress = (next: FilterKey) => {
    if (filter === next && next !== 'all') {
      setFilter('all');
      return;
    }
    setFilter(next);
  };

  const renderRow = ({ item }: { item: ReferenceRow }) => {
    const fallbackName = t('common.player');
    const name = getRefereeFullName(item.referee, fallbackName);
    const approved = isApproved(item);
    const contested = isContested(item);
    const pending = isPending(item);

    const badge = approved
      ? {
          key: 'approved',
          label: t('profile.referencesManage.status.approved'),
          color: statusColors.success.DEFAULT,
          icon: 'checkmark-circle' as const,
        }
      : contested
        ? {
            key: 'contested',
            label: t('profile.referencesManage.status.contested'),
            color: statusColors.error.DEFAULT,
            icon: 'alert-circle' as const,
          }
        : {
            key: 'pending',
            label: t('profile.referencesManage.status.pending'),
            color: statusColors.warning.DEFAULT,
            icon: 'time-outline' as const,
          };

    return (
      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.cardBackground,
            borderColor: colors.border,
            shadowColor: isDark ? 'transparent' : '#000',
          },
        ]}
      >
        <TouchableOpacity
          style={styles.cardHeader}
          activeOpacity={0.7}
          onPress={() => item.referee && navigateToPlayerProfile(item.referee.id)}
        >
          {item.referee?.profile_picture_url ? (
            <Image
              source={{ uri: getProfilePictureUrl(item.referee.profile_picture_url) ?? '' }}
              style={styles.avatar}
            />
          ) : (
            <View
              style={[
                styles.avatar,
                styles.avatarPlaceholder,
                { backgroundColor: colors.inputBackground },
              ]}
            >
              <Ionicons name="person-outline" size={20} color={colors.textMuted} />
            </View>
          )}
          <View style={styles.nameColumn}>
            <Text weight="semibold" color={colors.text} numberOfLines={1}>
              {name}
            </Text>
            {item.referee_rating?.label ? (
              <View style={styles.ratingRow}>
                <RatingBadge
                  ratingValue={item.referee_rating.value}
                  ratingLabel={item.referee_rating.label}
                  certificationStatus={item.referee_rating.badgeStatus}
                  isDark={isDark}
                  size="sm"
                />
              </View>
            ) : null}
          </View>
          <View style={[styles.statusPill, { backgroundColor: badge.color + '18' }]}>
            <Ionicons name={badge.icon} size={14} color={badge.color} />
            <Text size="xs" weight="semibold" color={badge.color}>
              {badge.label}
            </Text>
          </View>
        </TouchableOpacity>

        {/* Requested rating */}
        {item.rating_score?.label ? (
          <View style={styles.metaRow}>
            <Ionicons name="ribbon-outline" size={14} color={colors.textMuted} />
            <Text size="xs" color={colors.textMuted} style={styles.metaText}>
              {t('profile.referencesManage.requestedFor')}
            </Text>
            <RatingBadge
              ratingValue={item.rating_score.value}
              ratingLabel={item.rating_score.label}
              isDark={isDark}
              size="sm"
            />
          </View>
        ) : null}

        {/* Meta */}
        <View style={styles.metaRow}>
          <Ionicons name="calendar-outline" size={14} color={colors.textMuted} />
          <Text size="xs" color={colors.textMuted} style={styles.metaText}>
            {t('profile.referencesManage.sentOn', {
              date: formatDateShort(item.created_at, locale),
            })}
          </Text>
        </View>

        {/* Pending expiry */}
        {pending && (
          <View style={styles.metaRow}>
            <Ionicons name="hourglass-outline" size={14} color={statusColors.warning.DEFAULT} />
            <Text size="xs" color={statusColors.warning.DEFAULT} style={styles.metaText}>
              {t('profile.referencesManage.expiresIn', { days: daysUntil(item.expires_at) })}
            </Text>
          </View>
        )}

        {/* Response message (only for completed rows) */}
        {(approved || contested) && item.response_message ? (
          <View
            style={[
              styles.commentBlock,
              {
                backgroundColor: colors.background,
                borderLeftColor: badge.color,
              },
            ]}
          >
            <Text size="xs" weight="medium" color={colors.textMuted}>
              {t('profile.referencesManage.responseLabel')}
            </Text>
            <Text size="sm" color={colors.text} style={styles.commentText}>
              {item.response_message}
            </Text>
          </View>
        ) : null}
      </View>
    );
  };

  const emptyKey: 'empty' | 'emptyApproved' | 'emptyContested' | 'emptyPending' =
    filter === 'approved'
      ? 'emptyApproved'
      : filter === 'contested'
        ? 'emptyContested'
        : filter === 'pending'
          ? 'emptyPending'
          : 'empty';

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['bottom']}
    >
      {/* Filter chips */}
      <View style={styles.chipsWrapper}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsContent}
        >
          {FILTERS.map(option => (
            <FilterChip
              key={option.key}
              label={t(`profile.referencesManage.filters.${option.key}`)}
              icon={option.icon}
              isActive={filter === option.key}
              onPress={() => handleFilterPress(option.key)}
              isDark={isDark}
            />
          ))}
        </ScrollView>
      </View>

      {loading ? (
        <View style={styles.loadingContent}>
          {[1, 2, 3, 4].map(i => {
            const skeletonBg = isDark ? '#262626' : '#E1E9EE';
            const skeletonHighlight = isDark ? '#404040' : '#F2F8FC';
            return (
              <View
                key={i}
                style={[
                  styles.card,
                  { backgroundColor: colors.cardBackground, borderColor: colors.border },
                ]}
              >
                <View style={styles.cardHeader}>
                  <Skeleton
                    width={44}
                    height={44}
                    borderRadius={22}
                    backgroundColor={skeletonBg}
                    highlightColor={skeletonHighlight}
                  />
                  <View style={styles.skeletonNameColumn}>
                    <Skeleton
                      width="65%"
                      height={16}
                      backgroundColor={skeletonBg}
                      highlightColor={skeletonHighlight}
                    />
                    <Skeleton
                      width={70}
                      height={20}
                      borderRadius={radiusPixels.full}
                      backgroundColor={skeletonBg}
                      highlightColor={skeletonHighlight}
                    />
                  </View>
                  <Skeleton
                    width={88}
                    height={22}
                    borderRadius={radiusPixels.full}
                    backgroundColor={skeletonBg}
                    highlightColor={skeletonHighlight}
                  />
                </View>
                <View style={styles.skeletonRow}>
                  <Skeleton
                    width={14}
                    height={14}
                    borderRadius={7}
                    backgroundColor={skeletonBg}
                    highlightColor={skeletonHighlight}
                  />
                  <Skeleton
                    width="45%"
                    height={12}
                    backgroundColor={skeletonBg}
                    highlightColor={skeletonHighlight}
                  />
                </View>
              </View>
            );
          })}
        </View>
      ) : (
        <FlatList
          data={filteredReferences}
          keyExtractor={item => item.id}
          renderItem={renderRow}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="people-outline" size={64} color={colors.textMuted} />
              <Text size="lg" weight="semibold" color={colors.textMuted} style={styles.emptyTitle}>
                {t(`profile.referencesManage.${emptyKey}.title`)}
              </Text>
              <Text size="sm" color={colors.textMuted} style={styles.emptyText}>
                {t(`profile.referencesManage.${emptyKey}.description`)}
              </Text>
            </View>
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  chipsWrapper: {
    paddingTop: spacingPixels[4],
    paddingBottom: spacingPixels[2],
  },
  chipsContent: {
    paddingHorizontal: spacingPixels[4],
    gap: spacingPixels[2],
    alignItems: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[2],
    borderRadius: radiusPixels.full,
    borderWidth: 1,
    gap: spacingPixels[1],
  },
  chipIcon: {
    marginRight: 2,
  },
  loadingContent: {
    paddingHorizontal: spacingPixels[5],
    paddingTop: spacingPixels[3],
    gap: spacingPixels[3],
  },
  skeletonNameColumn: {
    flex: 1,
    gap: spacingPixels[2],
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  listContent: {
    paddingHorizontal: spacingPixels[5],
    paddingTop: spacingPixels[3],
    paddingBottom: spacingPixels[5],
    flexGrow: 1,
  },
  card: {
    borderRadius: radiusPixels.lg,
    padding: spacingPixels[4],
    marginBottom: spacingPixels[3],
    borderWidth: 1,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: Platform.OS === 'android' ? 2 : 0,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
    marginBottom: spacingPixels[2],
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: radiusPixels.full,
  },
  avatarPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameColumn: {
    flex: 1,
    gap: spacingPixels[1],
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.full,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    marginBottom: spacingPixels[1],
  },
  metaText: {
    marginLeft: 0,
  },
  commentBlock: {
    marginTop: spacingPixels[2],
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[2],
    borderLeftWidth: 3,
    borderRadius: radiusPixels.md,
  },
  commentText: {
    marginTop: spacingPixels[1],
    lineHeight: fontSizePixels.sm * 1.45,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[8],
    paddingVertical: 60,
  },
  emptyTitle: {
    marginTop: spacingPixels[4],
    marginBottom: spacingPixels[2],
  },
  emptyText: {
    textAlign: 'center',
    lineHeight: fontSizePixels.sm * 1.43,
  },
});

export default RatingReferences;
