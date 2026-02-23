/**
 * MemberListModal
 * Modal showing all group members with management options
 */

import React, { useCallback, useState, useMemo } from 'react';
import { View, TouchableOpacity, StyleSheet, Alert, Image } from 'react-native';
import ActionSheet, { SheetManager, SheetProps, FlatList } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';

import { Text, useToast } from '@rallia/shared-components';
import { useThemeStyles, useTranslation } from '../../../hooks';
import {
  useRemoveGroupMember,
  usePromoteMember,
  useDemoteMember,
  type GroupWithMembers,
  type GroupMember,
} from '@rallia/shared-hooks';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import { SearchBar } from '../../../components/SearchBar';

/**
 * Format a date as relative time or date string for join dates
 */
function formatJoinDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffDays === 0) return 'Joined today';
  if (diffDays === 1) return 'Joined yesterday';
  if (diffDays < 7) return `Joined ${diffDays} days ago`;
  if (diffDays < 30) return `Joined ${Math.floor(diffDays / 7)} weeks ago`;

  return `Joined ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined })}`;
}

/**
 * Format last active status - returns null if never active
 */
function formatLastActive(
  dateStr: string | null | undefined
): { text: string; isOnline: boolean } | null {
  if (!dateStr) return null;

  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  // Consider online if active within last 5 minutes
  if (diffMins < 5) return { text: 'Online now', isOnline: true };
  if (diffMins < 60) return { text: `Active ${diffMins}m ago`, isOnline: false };
  if (diffHours < 24) return { text: `Active ${diffHours}h ago`, isOnline: false };
  if (diffDays < 7) return { text: `Active ${diffDays}d ago`, isOnline: false };

  return {
    text: `Active ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
    isOnline: false,
  };
}

export function MemberListActionSheet({ payload }: SheetProps<'member-list'>) {
  const group = payload?.group as GroupWithMembers;
  const currentUserId = payload?.currentUserId ?? '';
  const isModerator = payload?.isModerator ?? false;
  const type = payload?.type ?? 'group'; // Default to 'group' for backwards compatibility
  const onMemberRemoved = payload?.onMemberRemoved;
  const onPlayerPress = payload?.onPlayerPress;

  const isCommunity = type === 'community';

  const { colors, isDark } = useThemeStyles();
  const toast = useToast();
  const { t } = useTranslation();

  const [searchQuery, setSearchQuery] = useState('');
  // Track locally removed members for immediate UI update
  const [removedMemberIds, setRemovedMemberIds] = useState<string[]>([]);
  // Track role changes for immediate UI update: { playerId: 'moderator' | 'member' }
  const [roleOverrides, setRoleOverrides] = useState<Record<string, 'moderator' | 'member'>>({});

  const handleClose = useCallback(() => {
    setSearchQuery('');
    setRemovedMemberIds([]);
    setRoleOverrides({});
    SheetManager.hide('member-list');
  }, []);

  // Filter members based on search query and exclude removed members
  const filteredMembers = useMemo(() => {
    // First filter out removed members
    let members = group.members.filter(m => !removedMemberIds.includes(m.player_id));

    // Apply role overrides for UI consistency
    members = members.map(m => {
      if (roleOverrides[m.player_id]) {
        return { ...m, role: roleOverrides[m.player_id] };
      }
      return m;
    });

    // Then apply search filter
    if (!searchQuery.trim()) return members;
    const query = searchQuery.toLowerCase().trim();
    return members.filter(member => {
      const firstName = member.player?.profile?.first_name?.toLowerCase() || '';
      const lastName = member.player?.profile?.last_name?.toLowerCase() || '';
      const displayName = member.player?.profile?.display_name?.toLowerCase() || '';
      return firstName.includes(query) || lastName.includes(query) || displayName.includes(query);
    });
  }, [group.members, searchQuery, removedMemberIds, roleOverrides]);

  const removeGroupMemberMutation = useRemoveGroupMember();
  const promoteMemberMutation = usePromoteMember();
  const demoteMemberMutation = useDemoteMember();

  const handleMemberOptions = useCallback(
    (member: GroupMember) => {
      // Get effective role (with any local overrides applied)
      const effectiveRole = roleOverrides[member.player_id] || member.role;

      // Show member options sheet
      const memberInfo = {
        name:
          member.player?.profile?.display_name ||
          `${member.player?.profile?.first_name || ''} ${member.player?.profile?.last_name || ''}`.trim() ||
          'Unknown',
        role: effectiveRole as 'member' | 'moderator',
        isCreator: group.created_by === member.player_id,
        profilePictureUrl: member.player?.profile?.profile_picture_url,
        playerId: member.player_id,
      };

      const isCreator = group.created_by === member.player_id;
      const isSelf = member.player_id === currentUserId;
      const memberIsModerator = effectiveRole === 'moderator';

      const options: Array<{
        id: string;
        label: string;
        icon: string;
        onPress: () => void;
        destructive?: boolean;
      }> = [];

      if (isModerator && !isSelf && !isCreator) {
        if (!memberIsModerator) {
          options.push({
            id: 'promote',
            label: t('groups.promoteToModerator'),
            icon: 'arrow-up-circle-outline',
            onPress: async () => {
              try {
                await promoteMemberMutation.mutateAsync({
                  groupId: group.id,
                  moderatorId: currentUserId,
                  playerIdToPromote: member.player_id,
                });
                // Update role immediately in UI
                setRoleOverrides(prev => ({ ...prev, [member.player_id]: 'moderator' }));
                toast.success(t('groups.memberPromoted'));
                onMemberRemoved?.();
              } catch (error) {
                toast.error(error instanceof Error ? error.message : t('groups.failedToPromote'));
              }
            },
          });
        } else {
          options.push({
            id: 'demote',
            label: t('groups.demoteToMember'),
            icon: 'arrow-down-circle-outline',
            onPress: async () => {
              try {
                await demoteMemberMutation.mutateAsync({
                  groupId: group.id,
                  moderatorId: currentUserId,
                  playerIdToDemote: member.player_id,
                });
                // Update role immediately in UI
                setRoleOverrides(prev => ({ ...prev, [member.player_id]: 'member' }));
                toast.success(t('groups.moderatorDemoted'));
                onMemberRemoved?.();
              } catch (error) {
                toast.error(error instanceof Error ? error.message : t('groups.failedToDemote'));
              }
            },
          });
        }

        options.push({
          id: 'remove',
          label: isCommunity ? t('community.removeFromCommunity') : t('groups.removeFromGroup'),
          icon: 'person-remove-outline',
          destructive: true,
          onPress: () => {
            Alert.alert(
              isCommunity ? t('community.removeMember') : t('groups.removeMember'),
              isCommunity
                ? t('community.removeMemberConfirm', {
                    name: member.player?.profile?.first_name || t('community.thisMember'),
                  })
                : t('groups.removeMemberConfirm', {
                    name: member.player?.profile?.first_name || t('groups.thisMember'),
                  }),
              [
                { text: t('common.cancel'), style: 'cancel' },
                {
                  text: t('common.remove'),
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      await removeGroupMemberMutation.mutateAsync({
                        groupId: group.id,
                        moderatorId: currentUserId,
                        playerIdToRemove: member.player_id,
                      });
                      // Remove member immediately from UI
                      setRemovedMemberIds(prev => [...prev, member.player_id]);
                      toast.success(
                        isCommunity ? t('community.memberRemoved') : t('groups.memberRemoved')
                      );
                      onMemberRemoved?.();
                    } catch (error) {
                      toast.error(
                        error instanceof Error
                          ? error.message
                          : isCommunity
                            ? t('community.failedToRemoveMember')
                            : t('groups.failedToRemoveMember')
                      );
                    }
                  },
                },
              ]
            );
          },
        });
      }

      SheetManager.show('member-options', {
        payload: {
          member: memberInfo,
          options,
          onAvatarPress: (playerId: string) => {
            onPlayerPress?.(playerId);
          },
        },
      });
    },
    [
      group,
      currentUserId,
      isModerator,
      isCommunity,
      roleOverrides,
      promoteMemberMutation,
      demoteMemberMutation,
      removeGroupMemberMutation,
      onMemberRemoved,
      onPlayerPress,
      toast,
      t,
    ]
  );

  const renderMemberItem = useCallback(
    ({ item }: { item: GroupMember }) => {
      const isCreator = group.created_by === item.player_id;
      const isSelf = item.player_id === currentUserId;
      const canManage = isModerator && !isSelf && !isCreator;
      const lastActive = formatLastActive(item.player?.profile?.last_active_at);
      const joinDate = formatJoinDate(item.joined_at);

      return (
        <TouchableOpacity
          style={[styles.memberItem, { borderBottomColor: colors.border }]}
          onPress={() => handleMemberOptions(item)}
          disabled={!canManage}
          activeOpacity={canManage ? 0.7 : 1}
        >
          <View style={styles.avatarContainer}>
            <View
              style={[styles.memberAvatar, { backgroundColor: isDark ? '#2C2C2E' : '#E5E5EA' }]}
            >
              {item.player?.profile?.profile_picture_url ? (
                <Image
                  source={{ uri: item.player.profile.profile_picture_url }}
                  style={styles.avatarImage}
                />
              ) : (
                <Ionicons name="person-outline" size={24} color={colors.textMuted} />
              )}
            </View>
            {/* Online indicator */}
            {lastActive?.isOnline && <View style={styles.onlineIndicator} />}
          </View>

          <View style={styles.memberInfo}>
            <View style={styles.memberNameRow}>
              <Text weight="medium" style={{ color: colors.text }}>
                {item.player?.profile?.display_name ||
                  `${item.player?.profile?.first_name || ''} ${item.player?.profile?.last_name || ''}`.trim() ||
                  'Unknown'}
              </Text>
              {isSelf && (
                <Text size="xs" style={{ color: colors.textSecondary, marginLeft: 6 }}>
                  ({t('common.you')})
                </Text>
              )}
            </View>
            {/* Last active / Join date */}
            <Text
              size="xs"
              style={{
                color: lastActive?.isOnline ? colors.primary : colors.textMuted,
                marginTop: 2,
              }}
            >
              {lastActive ? lastActive.text : joinDate}
            </Text>
            <View style={styles.memberBadges}>
              {item.role === 'moderator' && (
                <View style={[styles.badge, { backgroundColor: isDark ? '#FF9500' : '#FFF3E0' }]}>
                  <Text size="xs" style={{ color: isDark ? '#FFFFFF' : '#FF9500' }}>
                    {t('groups.moderator')}
                  </Text>
                </View>
              )}
              {isCreator && (
                <View
                  style={[styles.badge, { backgroundColor: isDark ? colors.primary : '#E8F5E9' }]}
                >
                  <Text size="xs" style={{ color: isDark ? '#FFFFFF' : colors.primary }}>
                    {t('groups.creator')}
                  </Text>
                </View>
              )}
            </View>
          </View>

          {canManage && <Ionicons name="ellipsis-horizontal" size={20} color={colors.textMuted} />}
        </TouchableOpacity>
      );
    },
    [colors, isDark, group, currentUserId, isModerator, handleMemberOptions, t]
  );

  if (!group) return null;

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={[styles.sheetBackground, { backgroundColor: colors.cardBackground }]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Text weight="semibold" size="lg" style={{ color: colors.text }}>
            {t('groups.members')} ({group.member_count})
          </Text>
          <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
            <Ionicons name="close-outline" size={24} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Search Bar - show when 10+ members */}
        {group.member_count >= 10 && (
          <View style={[styles.searchContainer, { borderBottomColor: colors.border }]}>
            <SearchBar
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder={t('groups.searchMembers')}
              colors={colors}
            />
          </View>
        )}

        {/* Member List */}
        <FlatList
          data={filteredMembers}
          renderItem={renderMemberItem}
          keyExtractor={item => item.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
        />
      </View>
    </ActionSheet>
  );
}

// Keep old export for backwards compatibility during migration
export const MemberListModal = MemberListActionSheet;

const styles = StyleSheet.create({
  sheetBackground: {
    flex: 1,
    borderTopLeftRadius: radiusPixels['2xl'],
    borderTopRightRadius: radiusPixels['2xl'],
  },
  handleIndicator: {
    width: spacingPixels[10],
    height: 4,
    borderRadius: 4,
    alignSelf: 'center',
  },
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
  },
  closeButton: {
    padding: 4,
  },
  searchContainer: {
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    borderBottomWidth: 1,
  },
  listContent: {
    paddingBottom: spacingPixels[4],
  },
  memberItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    borderBottomWidth: 1,
  },
  avatarContainer: {
    position: 'relative',
    marginRight: 12,
  },
  memberAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  onlineIndicator: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#34C759', // iOS green
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  memberInfo: {
    flex: 1,
  },
  memberNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  memberBadges: {
    flexDirection: 'row',
    marginTop: 4,
    gap: 6,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
});
