/**
 * ChatMemberOptionsModal
 * A styled bottom sheet modal for chat member action options
 * Used in GroupChatInfo screen for managing members
 */

import React from 'react';
import {
  View,
  Modal,
  TouchableOpacity,
  StyleSheet,
  TouchableWithoutFeedback,
  Image,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { useThemeStyles, useTranslation } from '../../../hooks';

interface OptionItem {
  id: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  destructive?: boolean;
  isLoading?: boolean;
}

interface MemberInfo {
  name: string;
  isAdmin: boolean;
  profilePictureUrl?: string | null;
  playerId?: string;
}

interface ChatMemberOptionsModalProps {
  visible: boolean;
  onClose: () => void;
  member: MemberInfo | null;
  options: OptionItem[];
  onAvatarPress?: (playerId: string) => void;
  isLoading?: boolean;
}

export function ChatMemberOptionsModal({
  visible,
  onClose,
  member,
  options,
  onAvatarPress,
  isLoading = false,
}: ChatMemberOptionsModalProps) {
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();

  if (!member) return null;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback>
            <View style={[styles.container, { backgroundColor: colors.cardBackground }]}>
              {/* Member Header */}
              <View style={[styles.memberHeader, { borderBottomColor: colors.border }]}>
                <TouchableOpacity 
                  style={[styles.avatar, { backgroundColor: isDark ? '#2C2C2E' : '#E5E5EA' }]}
                  onPress={() => {
                    if (member.playerId && onAvatarPress) {
                      onClose();
                      onAvatarPress(member.playerId);
                    }
                  }}
                  activeOpacity={0.7}
                  disabled={!member.playerId || !onAvatarPress}
                >
                  {member.profilePictureUrl ? (
                    <Image
                      source={{ uri: member.profilePictureUrl }}
                      style={styles.avatarImage}
                    />
                  ) : (
                    <Ionicons name="person" size={32} color={colors.textMuted} />
                  )}
                </TouchableOpacity>
                <View style={styles.memberInfo}>
                  <Text weight="semibold" size="lg" style={{ color: colors.text }}>
                    {member.name}
                  </Text>
                  {member.isAdmin && (
                    <View style={[styles.badge, { backgroundColor: isDark ? colors.primary : '#E8F5E9' }]}>
                      <Text size="xs" style={{ color: isDark ? '#FFFFFF' : colors.primary }}>
                        {t('chat.groupChat.admin' as any)}
                      </Text>
                    </View>
                  )}
                </View>
                <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                  <Ionicons name="close" size={24} color={colors.text} />
                </TouchableOpacity>
              </View>

              {/* Loading Overlay */}
              {isLoading && (
                <View style={styles.loadingOverlay}>
                  <ActivityIndicator size="large" color={colors.primary} />
                </View>
              )}

              {/* Options List */}
              <View style={[styles.optionsList, isLoading && styles.optionsListDisabled]}>
                {options.map((option, index) => (
                  <TouchableOpacity
                    key={option.id}
                    style={[
                      styles.optionItem,
                      index < options.length - 1 && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
                    ]}
                    onPress={() => {
                      option.onPress();
                    }}
                    activeOpacity={0.7}
                    disabled={isLoading}
                  >
                    <View
                      style={[
                        styles.optionIcon,
                        {
                          backgroundColor: option.destructive
                            ? isDark ? 'rgba(255, 59, 48, 0.15)' : 'rgba(255, 59, 48, 0.1)'
                            : isDark ? 'rgba(0, 122, 255, 0.15)' : 'rgba(0, 122, 255, 0.1)',
                        },
                      ]}
                    >
                      {option.isLoading ? (
                        <ActivityIndicator size="small" color={option.destructive ? '#FF3B30' : colors.primary} />
                      ) : (
                        <Ionicons
                          name={option.icon}
                          size={22}
                          color={option.destructive ? '#FF3B30' : colors.primary}
                        />
                      )}
                    </View>
                    <Text
                      weight="medium"
                      size="base"
                      style={{
                        color: option.destructive ? '#FF3B30' : colors.text,
                        flex: 1,
                      }}
                    >
                      {option.label}
                    </Text>
                    <Ionicons
                      name="chevron-forward"
                      size={20}
                      color={option.destructive ? '#FF3B30' : colors.textMuted}
                    />
                  </TouchableOpacity>
                ))}
              </View>

              {/* Cancel Button */}
              <TouchableOpacity
                style={[styles.cancelButton, { backgroundColor: isDark ? '#2C2C2E' : '#F2F2F7' }]}
                onPress={onClose}
                activeOpacity={0.7}
                disabled={isLoading}
              >
                <Text weight="semibold" size="base" style={{ color: colors.primary }}>
                  {t('common.cancel')}
                </Text>
              </TouchableOpacity>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  container: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 34, // Safe area
  },
  memberHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  avatarImage: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  memberInfo: {
    flex: 1,
    gap: 4,
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  closeButton: {
    padding: 4,
  },
  optionsList: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  optionsListDisabled: {
    opacity: 0.5,
  },
  optionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 4,
  },
  optionIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  cancelButton: {
    marginHorizontal: 16,
    marginTop: 8,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  loadingOverlay: {
    position: 'absolute',
    top: 80,
    left: 0,
    right: 0,
    bottom: 60,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
});
