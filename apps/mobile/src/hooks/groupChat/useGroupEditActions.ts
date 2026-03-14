/**
 * useGroupEditActions Hook
 * Handles group info editing actions
 * - Edit group name
 * - Change group image
 * - Edit description (placeholder)
 */

import { useState, useCallback } from 'react';
import { Alert } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { chatKeys } from '@rallia/shared-hooks';
import {
  updateConversation,
  updateGroup,
  getNetworkByConversationId,
} from '@rallia/shared-services';

import { uploadImage } from '../../services/imageUpload';
import { pickImageWithCropper } from '../../utils/imagePicker';

interface NetworkInfo {
  id: string;
  name: string;
  cover_image_url: string | null;
  description: string | null;
  member_count: number;
  type: string | null;
}

interface UseGroupEditActionsProps {
  conversationId: string;
  conversationTitle: string | undefined;
  playerId: string | undefined;
  networkInfo: NetworkInfo | null;
  onRefetch: () => Promise<unknown>;
  onNetworkInfoUpdate: (info: NetworkInfo | null) => void;
}

interface UseGroupEditActionsReturn {
  // Name editing state
  isEditingName: boolean;
  editedName: string;
  setEditedName: (name: string) => void;
  isUpdating: boolean;

  // Actions
  handleStartEditName: () => void;
  handleSaveName: () => Promise<void>;
  handleCancelEditName: () => void;
  handleChangeImage: () => Promise<void>;
  handleEditDescription: () => void;
}

export function useGroupEditActions({
  conversationId,
  conversationTitle,
  playerId,
  networkInfo,
  onRefetch,
  onNetworkInfoUpdate,
}: UseGroupEditActionsProps): UseGroupEditActionsReturn {
  const queryClient = useQueryClient();

  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);

  // Handle edit group name
  const handleStartEditName = useCallback(() => {
    setEditedName(conversationTitle || '');
    setIsEditingName(true);
  }, [conversationTitle]);

  const handleSaveName = useCallback(async () => {
    if (!editedName.trim() || editedName.trim() === conversationTitle) {
      setIsEditingName(false);
      return;
    }

    setIsUpdating(true);
    try {
      await updateConversation(conversationId, { title: editedName.trim() });
      await onRefetch();
      setIsEditingName(false);
    } catch (error) {
      console.error('Error updating group name:', error);
      Alert.alert('Error', 'Failed to update group name');
    } finally {
      setIsUpdating(false);
    }
  }, [conversationId, editedName, conversationTitle, onRefetch]);

  const handleCancelEditName = useCallback(() => {
    setIsEditingName(false);
  }, []);

  // Handle edit description (coming soon)
  const handleEditDescription = useCallback(() => {
    Alert.alert('Coming Soon', 'Description editing will be available soon');
  }, []);

  // Handle image picker
  const handleChangeImage = useCallback(async () => {
    try {
      const { uri, error } = await pickImageWithCropper({
        aspectRatio: [1, 1],
        quality: 0.8,
        source: 'gallery',
      });

      if (error) {
        Alert.alert('Permission Required', 'Please allow access to your photos.');
        return;
      }

      if (uri) {
        setIsUpdating(true);
        try {
          const { url, error: uploadError } = await uploadImage(uri, 'group-images');
          if (uploadError) throw uploadError;
          if (url) {
            // For network-linked groups, update the network cover image
            if (networkInfo?.id && playerId) {
              await updateGroup(networkInfo.id, playerId, { cover_image_url: url });
              // Refetch network info to update local state
              const updatedNetworkInfo = await getNetworkByConversationId(conversationId);
              onNetworkInfoUpdate(updatedNetworkInfo);
            } else {
              // For simple group chats (Direct section), update conversation picture_url
              await updateConversation(conversationId, { picture_url: url });
            }
            // Refetch conversation and invalidate conversations list for preview updates
            await onRefetch();
            if (playerId) {
              void queryClient.invalidateQueries({
                queryKey: chatKeys.playerConversations(playerId),
              });
            }
          }
        } catch (err) {
          console.error('Error updating group image:', err);
          Alert.alert('Error', 'Failed to update group image');
        } finally {
          setIsUpdating(false);
        }
      }
    } catch (err) {
      console.error('Error picking image:', err);
    }
  }, [conversationId, onRefetch, networkInfo, playerId, queryClient, onNetworkInfoUpdate]);

  return {
    // Name editing state
    isEditingName,
    editedName,
    setEditedName,
    isUpdating,

    // Actions
    handleStartEditName,
    handleSaveName,
    handleCancelEditName,
    handleChangeImage,
    handleEditDescription,
  };
}
