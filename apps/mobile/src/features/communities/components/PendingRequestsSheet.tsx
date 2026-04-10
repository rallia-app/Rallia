import React from 'react';
import { View, TouchableOpacity, StyleSheet, Image, Alert } from 'react-native';
import { SheetManager, SheetProps } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels } from '@rallia/design-system';
import { mediumHaptic } from '@rallia/shared-utils';
import {
  useApproveCommunityMember,
  useRejectCommunityMember,
  usePendingCommunityMembers,
} from '@rallia/shared-hooks';
import type { PendingMemberRequest } from '@rallia/shared-services';
import { getTierConfig, MIN_EVENTS_FOR_PUBLIC } from '@rallia/shared-services';
import type { ReputationTier, ReputationDisplay } from '@rallia/shared-services';

import { useThemeStyles, useAuth } from '../../../hooks';
import { BaseActionSheet } from '../../../components/BaseActionSheet';
import RatingBadge from '../../../components/RatingBadge';
import ReputationBadge from '../../../components/ReputationBadge';

function buildReputationDisplay(request: PendingMemberRequest): ReputationDisplay | undefined {
  if (!request.reputation_tier || request.reputation_score == null) return undefined;
  const tier = request.reputation_tier as ReputationTier;
  const config = getTierConfig(tier);
  return {
    tier,
    score: Number(request.reputation_score),
    isVisible: (request.reputation_total_events ?? 0) >= MIN_EVENTS_FOR_PUBLIC,
    tierLabel: config.label,
    tierColor: config.color,
    tierIcon: config.icon,
  };
}

export function PendingRequestsActionSheet({ payload }: SheetProps<'pending-requests'>) {
  const { colors, isDark } = useThemeStyles();
  const { session } = useAuth();
  const playerId = session?.user?.id;
  const communityId = payload?.communityId ?? '';
  const sportId = payload?.sportId;

  const { data: pendingRequests, refetch: refetchPendingRequests } = usePendingCommunityMembers(
    communityId || undefined,
    playerId || undefined,
    sportId
  );
  const approveMemberMutation = useApproveCommunityMember();
  const rejectMemberMutation = useRejectCommunityMember();

  const handleClose = () => {
    SheetManager.hide('pending-requests');
  };

  const handleApprove = async (requestId: string) => {
    if (!playerId) return;
    try {
      mediumHaptic();
      await approveMemberMutation.mutateAsync({
        communityId,
        memberId: requestId,
        approverId: playerId,
      });
      refetchPendingRequests();
      payload?.onMemberChanged?.();
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to approve member');
    }
  };

  const handleReject = async (requestId: string) => {
    if (!playerId) return;
    try {
      mediumHaptic();
      await rejectMemberMutation.mutateAsync({
        communityId,
        memberId: requestId,
        rejectorId: playerId,
      });
      refetchPendingRequests();
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to reject request');
    }
  };

  const handleNavigateToPlayer = (targetPlayerId: string) => {
    handleClose();
    payload?.onNavigateToPlayer?.(targetPlayerId);
  };

  const isLoading = approveMemberMutation.isPending || rejectMemberMutation.isPending;

  return (
    <BaseActionSheet title="Pending Requests" onClose={handleClose} scrollable flex={false}>
      {pendingRequests && pendingRequests.length > 0 ? (
        pendingRequests.map((request, index) => {
          const repDisplay = buildReputationDisplay(request);
          return (
            <TouchableOpacity
              key={request.id}
              style={[
                styles.row,
                index < pendingRequests.length - 1 && {
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: colors.border,
                },
              ]}
              onPress={() => handleNavigateToPlayer(request.player_id)}
              activeOpacity={0.7}
            >
              <View style={[styles.avatar, { backgroundColor: isDark ? '#2C2C2E' : '#E5E5EA' }]}>
                {request.player_profile_picture ? (
                  <Image
                    source={{ uri: request.player_profile_picture }}
                    style={styles.avatarImage}
                  />
                ) : (
                  <Ionicons name="person-outline" size={18} color={colors.textMuted} />
                )}
              </View>
              <View style={styles.info}>
                <Text size="sm" weight="medium" style={{ color: colors.text }} numberOfLines={1}>
                  {[request.player_first_name, request.player_last_name]
                    .filter(Boolean)
                    .join(' ') || 'Player'}
                </Text>
                {(request.rating_value != null || repDisplay) && (
                  <View style={styles.badges}>
                    {request.rating_value != null && (
                      <RatingBadge
                        ratingValue={request.rating_value}
                        ratingLabel={request.rating_label}
                        certificationStatus={request.badge_status}
                        isDark={isDark}
                        size="sm"
                      />
                    )}
                    {repDisplay && (
                      <ReputationBadge reputationDisplay={repDisplay} isDark={isDark} size="sm" />
                    )}
                  </View>
                )}
              </View>
              <View style={styles.actions}>
                <TouchableOpacity
                  style={[styles.iconButton, { backgroundColor: colors.primary }]}
                  onPress={() => handleApprove(request.id)}
                  disabled={isLoading}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="checkmark" size={16} color="#FFFFFF" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.iconButton, { backgroundColor: isDark ? '#3A3A3C' : '#E5E5EA' }]}
                  onPress={() => handleReject(request.id)}
                  disabled={isLoading}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close" size={16} color={colors.text} />
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          );
        })
      ) : (
        <View style={styles.empty}>
          <Ionicons name="checkmark-circle-outline" size={48} color={colors.textMuted} />
          <Text style={{ color: colors.textSecondary, marginTop: 12 }}>No pending requests</Text>
        </View>
      )}
    </BaseActionSheet>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacingPixels[3],
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  info: {
    flex: 1,
    marginLeft: spacingPixels[3],
  },
  badges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1.5],
    marginTop: spacingPixels[0.5],
    flexWrap: 'wrap',
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginLeft: spacingPixels[2],
  },
  iconButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  empty: {
    padding: spacingPixels[10],
    alignItems: 'center',
  },
});
