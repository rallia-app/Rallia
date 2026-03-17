/**
 * IncomingReferenceRequests Screen
 *
 * Displays pending reference requests that other players have sent to the current user.
 * Allows users to view requester info and respond (approve/decline) to requests.
 *
 * UX Considerations:
 * - Empty state with helpful messaging
 * - Pull-to-refresh for real-time updates
 * - Swipe actions for quick approve/decline
 * - Request expiration indicators
 * - Requester profile quick-view
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { supabase, Logger } from '@rallia/shared-services';
import { useThemeStyles, useTranslation, useNavigateToPlayerProfile } from '../hooks';
import { lightHaptic } from '@rallia/shared-utils';
import {
  spacingPixels,
  radiusPixels,
  fontSizePixels,
  fontWeightNumeric,
  status,
} from '@rallia/design-system';
import { CertificationBadge } from '../features/ratings/components';
import { RespondToReferenceOverlay } from '../features/ratings/components';

interface ReferenceRequest {
  id: string;
  requester_id: string;
  player_rating_score_id: string;
  message: string | null;
  status: 'pending' | 'completed' | 'declined' | 'expired' | 'cancelled';
  expires_at: string;
  created_at: string;
  // Joined data
  requester: {
    id: string;
    first_name: string;
    last_name: string;
    display_name: string | null;
    profile_picture_url: string | null;
  };
  rating_info: {
    label: string;
    value: number | null;
    sport_name: string;
    sport_display_name: string;
  };
}

const IncomingReferenceRequests: React.FC = () => {
  const { colors } = useThemeStyles();
  const { t } = useTranslation();

  const [requests, setRequests] = useState<ReferenceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<ReferenceRequest | null>(null);
  const [showRespondOverlay, setShowRespondOverlay] = useState(false);

  useEffect(() => {
    fetchIncomingRequests();
  }, []);

  const fetchIncomingRequests = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      Logger.info('Fetching incoming reference requests', {
        userId: user.id,
        currentDate: new Date().toISOString(),
      });

      // Fetch pending reference requests where current user is the referee
      const { data: requestsData, error } = await supabase
        .from('rating_reference_request')
        .select(
          `
          id,
          requester_id,
          player_rating_score_id,
          message,
          status,
          expires_at,
          created_at
        `
        )
        .eq('referee_id', user.id)
        .eq('status', 'pending')
        .gte('expires_at', new Date().toISOString()) // Not expired
        .order('created_at', { ascending: false });

      Logger.info('Incoming reference requests result', {
        count: requestsData?.length || 0,
        error: error?.message,
        userId: user.id,
      });

      if (error) throw error;

      if (!requestsData || requestsData.length === 0) {
        setRequests([]);
        return;
      }

      // Fetch requester profiles
      const requesterIds = [...new Set(requestsData.map(r => r.requester_id))];
      const { data: profiles } = await supabase
        .from('profile')
        .select('id, first_name, last_name, display_name, profile_picture_url')
        .in('id', requesterIds);

      // Fetch player_rating_score info with sport details
      const ratingScoreIds = [...new Set(requestsData.map(r => r.player_rating_score_id))];
      const { data: ratingScores } = await supabase
        .from('player_rating_score')
        .select(
          `
          id,
          rating_score:rating_score_id (
            label,
            value,
            rating_system:rating_system_id (
              sport:sport_id (
                name,
                display_name
              )
            )
          )
        `
        )
        .in('id', ratingScoreIds);

      // Create lookup maps
      const profilesMap = new Map(profiles?.map(p => [p.id, p]) || []);
      const ratingsMap = new Map<
        string,
        { label: string; value: number | null; sport_name: string; sport_display_name: string }
      >();

      ratingScores?.forEach(rs => {
        // Handle Supabase nested relations (can be arrays or single objects)
        const ratingScoreRaw = rs.rating_score;
        const ratingScore = Array.isArray(ratingScoreRaw) ? ratingScoreRaw[0] : ratingScoreRaw;

        if (ratingScore) {
          const ratingSystemRaw = ratingScore.rating_system;
          const ratingSystem = Array.isArray(ratingSystemRaw)
            ? ratingSystemRaw[0]
            : ratingSystemRaw;
          const sportRaw = ratingSystem?.sport;
          const sport = Array.isArray(sportRaw) ? sportRaw[0] : sportRaw;

          ratingsMap.set(rs.id, {
            label: ratingScore.label || '',
            value: ratingScore.value ?? null,
            sport_name: sport?.name || '',
            sport_display_name: sport?.display_name || '',
          });
        }
      });

      // Combine data
      const enrichedRequests: ReferenceRequest[] = requestsData.map(request => {
        const requester = profilesMap.get(request.requester_id);
        const ratingInfo = ratingsMap.get(request.player_rating_score_id);

        return {
          ...request,
          requester: requester || {
            id: request.requester_id,
            first_name: 'Unknown',
            last_name: 'Player',
            display_name: null,
            profile_picture_url: null,
          },
          rating_info: ratingInfo || {
            label: '-',
            value: null,
            sport_name: '',
            sport_display_name: 'Unknown Sport',
          },
        };
      });

      setRequests(enrichedRequests);
    } catch (error) {
      Logger.error('Failed to fetch incoming reference requests', error as Error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    fetchIncomingRequests();
  }, []);

  const handleOpenRequest = (request: ReferenceRequest) => {
    lightHaptic();
    setSelectedRequest(request);
    setShowRespondOverlay(true);
  };

  const navigateToPlayerProfile = useNavigateToPlayerProfile();
  const handleViewRequesterProfile = (requesterId: string) => {
    lightHaptic();
    navigateToPlayerProfile(requesterId);
  };

  const handleResponseComplete = () => {
    setShowRespondOverlay(false);
    setSelectedRequest(null);
    // Refresh the list to remove the responded request
    fetchIncomingRequests();
  };

  // Helper function to calculate days between two dates
  const getDaysLeft = (expiresAt: string): number => {
    const expiryDate = new Date(expiresAt);
    const now = new Date();
    const diffTime = expiryDate.getTime() - now.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  // Helper function to format time ago
  const formatTimeAgo = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return t('common.time.now');
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const getExpiryInfo = (expiresAt: string) => {
    const daysLeft = getDaysLeft(expiresAt);

    if (daysLeft <= 1) {
      return { text: t('referenceRequest.expiresVerySoon'), color: status.error.DEFAULT };
    } else if (daysLeft <= 3) {
      return {
        text: t('referenceRequest.expiresSoon', { days: daysLeft }),
        color: status.warning.DEFAULT,
      };
    }
    return { text: t('referenceRequest.expiresIn', { days: daysLeft }), color: colors.textMuted };
  };

  const renderRequestCard = ({ item }: { item: ReferenceRequest }) => {
    const expiryInfo = getExpiryInfo(item.expires_at);
    const timeAgo = formatTimeAgo(item.created_at);

    return (
      <TouchableOpacity
        style={[styles.requestCard, { backgroundColor: colors.card }]}
        onPress={() => handleOpenRequest(item)}
        activeOpacity={0.8}
      >
        {/* Header with requester info */}
        <View style={styles.cardHeader}>
          <TouchableOpacity
            style={styles.requesterInfo}
            onPress={() => handleViewRequesterProfile(item.requester.id)}
          >
            {item.requester.profile_picture_url ? (
              <Image source={{ uri: item.requester.profile_picture_url }} style={styles.avatar} />
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
            <View style={styles.requesterText}>
              <Text style={[styles.requesterName, { color: colors.text }]}>
                {item.requester.first_name} {item.requester.last_name}
              </Text>
              {item.requester.display_name && (
                <Text style={[styles.requesterUsername, { color: colors.textMuted }]}>
                  @{item.requester.display_name}
                </Text>
              )}
            </View>
          </TouchableOpacity>

          <View style={[styles.sportBadge, { backgroundColor: colors.primary + '20' }]}>
            <Text style={[styles.sportText, { color: colors.primary }]}>
              {item.rating_info.sport_display_name}
            </Text>
          </View>
        </View>

        {/* Rating being verified */}
        <View style={[styles.ratingSection, { backgroundColor: colors.inputBackground }]}>
          <View style={styles.ratingLabelRow}>
            <Text style={[styles.ratingLabel, { color: colors.textMuted }]}>
              {t('referenceRequest.claimedRating')}
            </Text>
            <CertificationBadge status="self_declared" size="sm" />
          </View>
          <View style={styles.ratingValueRow}>
            <Text style={[styles.ratingValue, { color: colors.text }]}>
              {item.rating_info.label}
            </Text>
            {item.rating_info.value && (
              <Text style={[styles.ratingNumeric, { color: colors.textSecondary }]}>
                ({item.rating_info.value.toFixed(1)})
              </Text>
            )}
          </View>
        </View>

        {/* Message (if any) */}
        {item.message && (
          <View style={styles.messageSection}>
            <Ionicons name="chatbubble-outline" size={14} color={colors.textMuted} />
            <Text style={[styles.messageText, { color: colors.textSecondary }]} numberOfLines={2}>
              "{item.message}"
            </Text>
          </View>
        )}

        {/* Footer with time and expiry */}
        <View style={styles.cardFooter}>
          <Text style={[styles.timeText, { color: colors.textMuted }]}>{timeAgo}</Text>
          <View style={styles.expiryContainer}>
            <Ionicons name="time-outline" size={12} color={expiryInfo.color} />
            <Text style={[styles.expiryText, { color: expiryInfo.color }]}>{expiryInfo.text}</Text>
          </View>
        </View>

        {/* Action hint */}
        <View style={[styles.actionHint, { borderTopColor: colors.border }]}>
          <Text style={[styles.actionHintText, { color: colors.primary }]}>
            {t('referenceRequest.tapToRespond')}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={colors.primary} />
        </View>
      </TouchableOpacity>
    );
  };

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.inputBackground }]}>
        <Ionicons name="document-text-outline" size={48} color={colors.textMuted} />
      </View>
      <Text style={[styles.emptyTitle, { color: colors.text }]}>
        {t('referenceRequest.noRequests')}
      </Text>
      <Text style={[styles.emptyDescription, { color: colors.textMuted }]}>
        {t('referenceRequest.noRequestsDescription')}
      </Text>
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.background }]}
        edges={['bottom']}
      >
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textMuted }]}>
            {t('common.loading')}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['bottom']}
    >
      {/* Header info */}
      <View style={[styles.headerInfo, { backgroundColor: colors.card }]}>
        <Ionicons name="information-circle-outline" size={20} color={colors.primary} />
        <Text style={[styles.headerInfoText, { color: colors.textSecondary }]}>
          {t('referenceRequest.headerInfo')}
        </Text>
      </View>

      <FlatList
        data={requests}
        keyExtractor={item => item.id}
        renderItem={renderRequestCard}
        contentContainerStyle={[
          styles.listContent,
          requests.length === 0 && styles.emptyListContent,
        ]}
        ListEmptyComponent={renderEmptyState}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        showsVerticalScrollIndicator={false}
      />

      {/* Respond Overlay */}
      {selectedRequest && (
        <RespondToReferenceOverlay
          visible={showRespondOverlay}
          onClose={() => {
            setShowRespondOverlay(false);
            setSelectedRequest(null);
          }}
          request={selectedRequest}
          onResponseComplete={handleResponseComplete}
        />
      )}
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
    gap: spacingPixels[3],
  },
  loadingText: {
    fontSize: fontSizePixels.sm,
  },
  headerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    marginHorizontal: spacingPixels[4],
    marginTop: spacingPixels[3],
    borderRadius: radiusPixels.lg,
  },
  headerInfoText: {
    flex: 1,
    fontSize: fontSizePixels.sm,
    lineHeight: 20,
  },
  listContent: {
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[4],
    gap: spacingPixels[3],
  },
  emptyListContent: {
    flex: 1,
    justifyContent: 'center',
  },
  requestCard: {
    borderRadius: radiusPixels.xl,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: spacingPixels[4],
    paddingBottom: spacingPixels[3],
  },
  requesterInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
    flex: 1,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  avatarPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  requesterText: {
    flex: 1,
  },
  requesterName: {
    fontSize: fontSizePixels.base,
    fontWeight: fontWeightNumeric.semibold,
  },
  requesterUsername: {
    fontSize: fontSizePixels.sm,
    marginTop: 2,
  },
  sportBadge: {
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.md,
  },
  sportText: {
    fontSize: fontSizePixels.xs,
    fontWeight: fontWeightNumeric.medium,
  },
  ratingSection: {
    marginHorizontal: spacingPixels[4],
    padding: spacingPixels[3],
    borderRadius: radiusPixels.lg,
  },
  ratingLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacingPixels[1],
  },
  ratingLabel: {
    fontSize: fontSizePixels.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  ratingValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacingPixels[2],
  },
  ratingValue: {
    fontSize: fontSizePixels.xl,
    fontWeight: fontWeightNumeric.bold,
  },
  ratingNumeric: {
    fontSize: fontSizePixels.sm,
  },
  messageSection: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacingPixels[2],
    marginHorizontal: spacingPixels[4],
    marginTop: spacingPixels[3],
  },
  messageText: {
    flex: 1,
    fontSize: fontSizePixels.sm,
    fontStyle: 'italic',
    lineHeight: 20,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[3],
    paddingBottom: spacingPixels[2],
  },
  timeText: {
    fontSize: fontSizePixels.xs,
  },
  expiryContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
  },
  expiryText: {
    fontSize: fontSizePixels.xs,
    fontWeight: fontWeightNumeric.medium,
  },
  actionHint: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacingPixels[1],
    paddingVertical: spacingPixels[3],
    borderTopWidth: 1,
    marginTop: spacingPixels[2],
  },
  actionHintText: {
    fontSize: fontSizePixels.sm,
    fontWeight: fontWeightNumeric.semibold,
  },
  emptyState: {
    alignItems: 'center',
    paddingHorizontal: spacingPixels[8],
  },
  emptyIcon: {
    width: 96,
    height: 96,
    borderRadius: 48,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacingPixels[4],
  },
  emptyTitle: {
    fontSize: fontSizePixels.lg,
    fontWeight: fontWeightNumeric.semibold,
    textAlign: 'center',
    marginBottom: spacingPixels[2],
  },
  emptyDescription: {
    fontSize: fontSizePixels.sm,
    textAlign: 'center',
    lineHeight: 22,
  },
});

export default IncomingReferenceRequests;
