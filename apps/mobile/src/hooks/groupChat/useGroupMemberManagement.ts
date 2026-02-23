/**
 * useGroupMemberManagement Hook (Refactored)
 * Handles member CRUD operations for group chat
 * - Add members
 * - Remove members
 * - Promote to admin
 * - Demote to member
 * - Leave group
 * 
 * Refactored to use modals instead of Alert.alert for better UX
 */

import { useState, useCallback } from 'react';
import {
  addConversationParticipant,
  removeConversationParticipant,
  addGroupMember,
  removeGroupMember,
  leaveGroup,
  promoteMember,
  demoteMember,
} from '@rallia/shared-services';

interface NetworkInfo {
  id: string;
  name: string;
  cover_image_url: string | null;
  description: string | null;
  member_count: number;
  type?: 'community' | 'player_group' | string | null;
}

export interface SelectedMemberInfo {
  playerId: string;
  name: string;
  profilePictureUrl: string | null;
  isAdmin: boolean;
}

interface UseGroupMemberManagementProps {
  conversationId: string;
  playerId: string | undefined;
  networkInfo: NetworkInfo | null;
  isAdmin: boolean;
  onRefetch: () => Promise<unknown>;
  onRefetchNetworkInfo: () => Promise<void>;
  onLeaveGroup: () => void;
}

export interface ConfirmationConfig {
  title: string;
  message: string;
  confirmLabel: string;
  destructive: boolean;
  onConfirm: () => void;
}

interface UseGroupMemberManagementReturn {
  // State
  isUpdating: boolean;
  showAddMemberModal: boolean;
  setShowAddMemberModal: (show: boolean) => void;
  
  // Member options modal state
  showMemberOptionsModal: boolean;
  selectedMember: SelectedMemberInfo | null;
  closeMemberOptionsModal: () => void;
  
  // Confirmation modal state
  showConfirmationModal: boolean;
  confirmationConfig: ConfirmationConfig | null;
  closeConfirmationModal: () => void;
  
  // Action handlers
  handleAddMember: () => void;
  handleMembersAdded: (memberIds: string[]) => Promise<void>;
  handleMemberPress: (member: SelectedMemberInfo) => void;
  
  // Member option actions (called from options modal)
  handleViewProfile: () => void;
  handleRemoveMember: () => void;
  handlePromoteMember: () => void;
  handleDemoteMember: () => void;
  handleLeaveGroup: () => void;
  
  // Build options for current selected member
  getMemberOptions: () => Array<{
    id: string;
    label: string;
    icon: string;
    onPress: () => void;
    destructive?: boolean;
  }>;
  
  // Error handling
  error: string | null;
  clearError: () => void;
}

export function useGroupMemberManagement({
  conversationId,
  playerId,
  networkInfo,
  isAdmin,
  onRefetch,
  onRefetchNetworkInfo,
  onLeaveGroup,
}: UseGroupMemberManagementProps): UseGroupMemberManagementReturn {
  const [isUpdating, setIsUpdating] = useState(false);
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Member options modal state
  const [showMemberOptionsModal, setShowMemberOptionsModal] = useState(false);
  const [selectedMember, setSelectedMember] = useState<SelectedMemberInfo | null>(null);
  
  // Confirmation modal state
  const [showConfirmationModal, setShowConfirmationModal] = useState(false);
  const [confirmationConfig, setConfirmationConfig] = useState<ConfirmationConfig | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const closeMemberOptionsModal = useCallback(() => {
    setShowMemberOptionsModal(false);
    setSelectedMember(null);
  }, []);

  const closeConfirmationModal = useCallback(() => {
    setShowConfirmationModal(false);
    setConfirmationConfig(null);
  }, []);

  // Handle add member
  const handleAddMember = useCallback(() => {
    setShowAddMemberModal(true);
  }, []);

  const handleMembersAdded = useCallback(async (memberIds: string[]) => {
    setShowAddMemberModal(false);
    setIsUpdating(true);
    try {
      for (const memberId of memberIds) {
        await addConversationParticipant(conversationId, memberId);
        
        if (networkInfo?.id && playerId) {
          try {
            await addGroupMember(networkInfo.id, playerId, memberId);
          } catch (networkError) {
            console.log('Member may already be in network:', networkError);
          }
        }
      }
      await onRefetch();
    } catch (err) {
      console.error('Error adding members:', err);
      setError('Failed to add some members');
    } finally {
      setIsUpdating(false);
    }
  }, [conversationId, onRefetch, networkInfo, playerId]);

  // Handle member press - show options modal
  const handleMemberPress = useCallback((member: SelectedMemberInfo) => {
    setSelectedMember(member);
    setShowMemberOptionsModal(true);
  }, []);

  // View profile action
  const handleViewProfile = useCallback(() => {
    // This will be handled by the screen - just close the modal
    closeMemberOptionsModal();
  }, [closeMemberOptionsModal]);

  // Leave group action (for self)
  const handleLeaveGroupAction = useCallback(() => {
    closeMemberOptionsModal();
    setConfirmationConfig({
      title: 'Leave Group',
      message: 'Are you sure you want to leave this group?',
      confirmLabel: 'Leave',
      destructive: true,
      onConfirm: async () => {
        setIsUpdating(true);
        try {
          if (playerId) {
            await removeConversationParticipant(conversationId, playerId);
            
            if (networkInfo?.id) {
              try {
                await leaveGroup(networkInfo.id, playerId);
              } catch (networkError) {
                console.log('Error leaving network (may not be a member):', networkError);
              }
            }
          }
          closeConfirmationModal();
          onLeaveGroup();
        } catch (err) {
          console.error('Error leaving group:', err);
          setError('Failed to leave group');
          closeConfirmationModal();
        } finally {
          setIsUpdating(false);
        }
      },
    });
    setShowConfirmationModal(true);
  }, [conversationId, playerId, networkInfo, onLeaveGroup, closeMemberOptionsModal, closeConfirmationModal]);

  // Remove member action
  const handleRemoveMemberAction = useCallback(() => {
    if (!selectedMember) return;
    
    const memberName = selectedMember.name;
    const memberId = selectedMember.playerId;
    
    closeMemberOptionsModal();
    setConfirmationConfig({
      title: 'Remove Member',
      message: `Are you sure you want to remove ${memberName} from this group?`,
      confirmLabel: 'Remove',
      destructive: true,
      onConfirm: async () => {
        setIsUpdating(true);
        try {
          await removeConversationParticipant(conversationId, memberId);
          
          if (networkInfo?.id && playerId) {
            try {
              await removeGroupMember(networkInfo.id, playerId, memberId);
            } catch (networkError) {
              console.log('Error removing from network:', networkError);
            }
          }
          
          await onRefetch();
          closeConfirmationModal();
        } catch (err) {
          console.error('Error removing member:', err);
          setError('Failed to remove member');
          closeConfirmationModal();
        } finally {
          setIsUpdating(false);
        }
      },
    });
    setShowConfirmationModal(true);
  }, [selectedMember, conversationId, playerId, networkInfo, onRefetch, closeMemberOptionsModal, closeConfirmationModal]);

  // Promote member action
  const handlePromoteMemberAction = useCallback(() => {
    if (!selectedMember || !networkInfo?.id || !playerId) return;
    
    const memberName = selectedMember.name;
    const memberId = selectedMember.playerId;
    
    closeMemberOptionsModal();
    setConfirmationConfig({
      title: 'Promote to Admin',
      message: `Are you sure you want to make ${memberName} an admin?`,
      confirmLabel: 'Promote',
      destructive: false,
      onConfirm: async () => {
        setIsUpdating(true);
        try {
          await promoteMember(networkInfo.id, playerId, memberId);
          await onRefetchNetworkInfo();
          closeConfirmationModal();
        } catch (err) {
          console.error('Error promoting member:', err);
          setError('Failed to promote member');
          closeConfirmationModal();
        } finally {
          setIsUpdating(false);
        }
      },
    });
    setShowConfirmationModal(true);
  }, [selectedMember, networkInfo, playerId, onRefetchNetworkInfo, closeMemberOptionsModal, closeConfirmationModal]);

  // Demote member action
  const handleDemoteMemberAction = useCallback(() => {
    if (!selectedMember || !networkInfo?.id || !playerId) return;
    
    const memberName = selectedMember.name;
    const memberId = selectedMember.playerId;
    
    closeMemberOptionsModal();
    setConfirmationConfig({
      title: 'Demote to Member',
      message: `Are you sure you want to remove admin privileges from ${memberName}?`,
      confirmLabel: 'Demote',
      destructive: true,
      onConfirm: async () => {
        setIsUpdating(true);
        try {
          await demoteMember(networkInfo.id, playerId, memberId);
          await onRefetchNetworkInfo();
          closeConfirmationModal();
        } catch (err) {
          console.error('Error demoting member:', err);
          setError('Failed to demote member. You may be the last admin.');
          closeConfirmationModal();
        } finally {
          setIsUpdating(false);
        }
      },
    });
    setShowConfirmationModal(true);
  }, [selectedMember, networkInfo, playerId, onRefetchNetworkInfo, closeMemberOptionsModal, closeConfirmationModal]);

  // Build options for the selected member
  const getMemberOptions = useCallback(() => {
    if (!selectedMember) return [];
    
    const options: Array<{
      id: string;
      label: string;
      icon: string;
      onPress: () => void;
      destructive?: boolean;
    }> = [];

    // Always show view profile option
    options.push({
      id: 'view-profile',
      label: 'View Profile',
      icon: 'person-outline',
      onPress: handleViewProfile,
    });

    const isSelf = selectedMember.playerId === playerId;
    
    if (isSelf) {
      // Self - show leave option
      options.push({
        id: 'leave',
        label: 'Leave Group',
        icon: 'exit-outline',
        onPress: handleLeaveGroupAction,
        destructive: true,
      });
    } else if (isAdmin) {
      // Admin can manage other members
      if (networkInfo?.id) {
        // For network-linked groups, show promote/demote
        if (selectedMember.isAdmin) {
          options.push({
            id: 'demote',
            label: 'Demote to Member',
            icon: 'arrow-down-circle-outline',
            onPress: handleDemoteMemberAction,
            destructive: true,
          });
        } else {
          options.push({
            id: 'promote',
            label: 'Promote to Admin',
            icon: 'arrow-up-circle-outline',
            onPress: handlePromoteMemberAction,
          });
          options.push({
            id: 'remove',
            label: 'Remove from Group',
            icon: 'person-remove-outline',
            onPress: handleRemoveMemberAction,
            destructive: true,
          });
        }
      } else {
        // For simple groups, only show remove (for non-admins)
        if (!selectedMember.isAdmin) {
          options.push({
            id: 'remove',
            label: 'Remove from Group',
            icon: 'person-remove-outline',
            onPress: handleRemoveMemberAction,
            destructive: true,
          });
        }
      }
    }

    return options;
  }, [
    selectedMember,
    playerId,
    isAdmin,
    networkInfo,
    handleViewProfile,
    handleLeaveGroupAction,
    handleRemoveMemberAction,
    handlePromoteMemberAction,
    handleDemoteMemberAction,
  ]);

  return {
    isUpdating,
    showAddMemberModal,
    setShowAddMemberModal,
    showMemberOptionsModal,
    selectedMember,
    closeMemberOptionsModal,
    showConfirmationModal,
    confirmationConfig,
    closeConfirmationModal,
    handleAddMember,
    handleMembersAdded,
    handleMemberPress,
    handleViewProfile,
    handleRemoveMember: handleRemoveMemberAction,
    handlePromoteMember: handlePromoteMemberAction,
    handleDemoteMember: handleDemoteMemberAction,
    handleLeaveGroup: handleLeaveGroupAction,
    getMemberOptions,
    error,
    clearError,
  };
}
