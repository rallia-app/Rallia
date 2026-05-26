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
import { lightHaptic, getProfilePictureUrl } from '@rallia/shared-utils';
import {
  spacingPixels,
  radiusPixels,
  fontSizePixels,
  fontWeightNumeric,
  status,
} from '@rallia/design-system';
import { SheetManager } from 'react-native-actions-sheet';

import { useThemeStyles, useTranslation, useNavigateToPlayerProfile } from '#/hooks';
import { CertificationBadge } from '#/features/ratings/components';

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
    SheetManager.show('respond-to-reference', {
      payload: {
        request,
        onResponseComplete: () => fetchIncomingRequests(),
      },
    });
  };

  const navigateToPlayerProfile = useNavigateToPlayerProfile();
  const handleViewRequesterProfile = (requesterId: string) => {
    lightHaptic();
    navigateToPlayerProfile(requesterId);
  };

  // Helper function to calculate days between two dates
  const getDaysLeft = (expiresAt: string): number => {
    const expiryDate = new Date(expiresAt);
    const now = new Date();
    const diffTime = expiryDate.getTime() - now.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
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

    return (
      <TouchableOpacity
        style={[styles.requestCard, { backgroundColor: colors.card }]}
        onPress={() => handleOpenRequest(item)}
        activeOpacity={0.8}
      >
        {/* Header with requester info and claimed rating */}
        <View style={styles.cardHeader}>
          <TouchableOpacity
            style={styles.requesterInfo}
            onPress={() => handleViewRequesterProfile(item.requester.id)}
          >
            {item.requester.profile_picture_url ? (
              <Image
                source={{ uri: getProfilePictureUrl(item.requester.profile_picture_url) ?? '' }}
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
            <View style={styles.requesterText}>
              <Text style={[styles.requesterName, { color: colors.text }]}>
                {item.requester.first_name} {item.requester.last_name}
              </Text>
              <Text style={[styles.requesterUsername, { color: colors.textMuted }]}>
                {t('referenceRequest.claimsToBeRated')} {item.rating_info.label}
              </Text>
              <View style={styles.expiryContainer}>
                <Ionicons name="time-outline" size={11} color={expiryInfo.color} />
                <Text style={[styles.expiryText, { color: expiryInfo.color }]}>
                  {expiryInfo.text}
                </Text>
              </View>
            </View>
          </TouchableOpacity>

          <CertificationBadge status="self_declared" size="sm" />
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

        {/* CTA */}
        <TouchableOpacity
          style={[styles.respondButton, { backgroundColor: colors.buttonActive }]}
          onPress={() => handleOpenRequest(item)}
          activeOpacity={0.8}
        >
          <Text style={[styles.respondButtonText, { color: colors.buttonTextActive }]}>
            {t('referenceRequest.reviewAndRespond')}
          </Text>
        </TouchableOpacity>
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
    flexGrow: 1,
    justifyContent: 'center',
    paddingBottom: 0,
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
  expiryContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    marginTop: spacingPixels[1],
  },
  expiryText: {
    fontSize: fontSizePixels.xs,
  },
  respondButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[2],
    paddingVertical: spacingPixels[3],
    marginHorizontal: spacingPixels[4],
    marginTop: spacingPixels[3],
    marginBottom: spacingPixels[4],
    borderRadius: radiusPixels.lg,
  },
  respondButtonText: {
    fontSize: fontSizePixels.base,
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
