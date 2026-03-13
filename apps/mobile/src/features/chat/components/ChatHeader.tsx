/**
 * ChatHeader Component
 * Header for the chat screen showing group/conversation info
 * Includes 3-dot menu with contextual options
 */

import React, { memo, useState, useCallback } from 'react';
import { View, TouchableOpacity, StyleSheet, Image, Modal, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@rallia/shared-components';
import { lightHaptic } from '@rallia/shared-utils';
import { useThemeStyles, useTranslation } from '../../../hooks';
import { spacingPixels, fontSizePixels, primary, status } from '@rallia/design-system';

interface ChatHeaderProps {
  title: string;
  subtitle?: string;
  imageUrl?: string | null;
  onBack: () => void;
  onTitlePress?: () => void;
  /** Whether this is a direct (user-to-user) chat */
  isDirectChat?: boolean;
  /** Whether notifications are muted for this chat */
  isMuted?: boolean;
  /** Whether the other user is blocked (only for direct chats) */
  isBlocked?: boolean;
  /** Whether the other user is favorited (only for direct chats) */
  isFavorite?: boolean;
  /** Callback when search is pressed */
  onSearchPress?: () => void;
  /** Callback when mute is toggled */
  onToggleMute?: () => void;
  /** Callback when favorite is toggled (only for direct chats) */
  onToggleFavorite?: () => void;
  /** Callback when block is toggled (only for direct chats) */
  onToggleBlock?: () => void;
  /** Callback when report is pressed (only for direct chats) */
  onReport?: () => void;
  /** Callback when clear chat is pressed (only for direct chats) */
  onClearChat?: () => void;
}

type MenuItem = {
  id: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  destructive?: boolean;
  directOnly?: boolean;
};

function ChatHeaderComponent({
  title,
  subtitle,
  imageUrl,
  onBack,
  onTitlePress,
  isDirectChat = false,
  isMuted = false,
  isBlocked = false,
  isFavorite = false,
  onSearchPress,
  onToggleMute,
  onToggleFavorite,
  onToggleBlock,
  onReport,
  onClearChat,
}: ChatHeaderProps) {
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [showMenu, setShowMenu] = useState(false);

  const handleMenuPress = useCallback(() => {
    lightHaptic();
    setShowMenu(true);
  }, []);

  const handleCloseMenu = useCallback(() => {
    setShowMenu(false);
  }, []);

  const handleMenuItemPress = useCallback((action: () => void) => {
    setShowMenu(false);
    // Small delay to allow menu to close before action
    setTimeout(action, 100);
  }, []);

  const menuItems: MenuItem[] = [
    {
      id: 'search',
      label: t('chat.menu.search'),
      icon: 'search',
      onPress: () => handleMenuItemPress(() => onSearchPress?.()),
    },
    {
      id: 'mute',
      label: isMuted ? t('chat.menu.unmuteNotifications') : t('chat.menu.muteNotifications'),
      icon: isMuted ? 'notifications' : 'notifications-off',
      onPress: () => handleMenuItemPress(() => onToggleMute?.()),
    },
    {
      id: 'favorite',
      label: isFavorite ? t('chat.menu.removeFromFavorites') : t('chat.menu.addToFavorites'),
      icon: isFavorite ? 'heart-dislike' : 'heart',
      onPress: () => handleMenuItemPress(() => onToggleFavorite?.()),
      directOnly: true,
    },
    {
      id: 'block',
      label: isBlocked ? t('chat.menu.unblock') : t('chat.menu.block'),
      icon: isBlocked ? 'person-add' : 'ban',
      onPress: () => handleMenuItemPress(() => onToggleBlock?.()),
      directOnly: true,
    },
    {
      id: 'report',
      label: t('chat.menu.report'),
      icon: 'flag',
      onPress: () => handleMenuItemPress(() => onReport?.()),
      destructive: true,
      directOnly: true,
    },
    {
      id: 'clear',
      label: t('chat.menu.clearChat'),
      icon: 'trash-outline',
      onPress: () => handleMenuItemPress(() => onClearChat?.()),
      destructive: true,
      directOnly: true,
    },
  ];

  // Filter menu items based on chat type
  const visibleMenuItems = menuItems.filter(item => !item.directOnly || isDirectChat);

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: isDark ? colors.background : '#FFFFFF',
          borderBottomColor: colors.border,
          paddingTop: insets.top + spacingPixels[2],
        },
      ]}
    >
      {/* Back button */}
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => {
          lightHaptic();
          onBack();
        }}
      >
        <Ionicons name="chevron-back" size={24} color={colors.text} />
      </TouchableOpacity>

      {/* Avatar and info */}
      <TouchableOpacity
        style={styles.infoContainer}
        onPress={onTitlePress}
        disabled={!onTitlePress}
        activeOpacity={onTitlePress ? 0.7 : 1}
      >
        {/* Avatar */}
        <View style={styles.avatarContainer}>
          {imageUrl ? (
            <Image source={{ uri: imageUrl }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatarPlaceholder, { backgroundColor: primary[100] }]}>
              <Ionicons name={isDirectChat ? 'person' : 'people'} size={20} color={primary[500]} />
            </View>
          )}
        </View>

        {/* Title and subtitle */}
        <View style={styles.textContainer}>
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
            {title}
          </Text>
          {subtitle && (
            <Text style={[styles.subtitle, { color: primary[500] }]} numberOfLines={1}>
              {subtitle}
            </Text>
          )}
        </View>
      </TouchableOpacity>

      {/* 3-dot menu button */}
      <TouchableOpacity style={styles.menuButton} onPress={handleMenuPress}>
        <Ionicons name="ellipsis-vertical" size={22} color={colors.text} />
      </TouchableOpacity>

      {/* Dropdown Menu Modal */}
      <Modal visible={showMenu} transparent animationType="fade" onRequestClose={handleCloseMenu}>
        <Pressable style={styles.menuOverlay} onPress={handleCloseMenu}>
          <Pressable
            style={[
              styles.menuContainer,
              {
                backgroundColor: isDark ? colors.card : '#FFFFFF',
                top: insets.top + 50,
              },
            ]}
            onPress={e => e.stopPropagation()}
          >
            {visibleMenuItems.map((item, index) => (
              <TouchableOpacity
                key={item.id}
                style={[
                  styles.menuItem,
                  index < visibleMenuItems.length - 1 && {
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: colors.border,
                  },
                ]}
                onPress={item.onPress}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={item.icon}
                  size={20}
                  color={item.destructive ? status.error.DEFAULT : colors.text}
                  style={styles.menuItemIcon}
                />
                <Text
                  style={[
                    styles.menuItemText,
                    { color: item.destructive ? status.error.DEFAULT : colors.text },
                  ]}
                >
                  {item.label}
                </Text>
              </TouchableOpacity>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

export const ChatHeader = memo(ChatHeaderComponent);

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[2],
    paddingBottom: spacingPixels[3],
    borderBottomWidth: 1,
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarContainer: {
    marginRight: spacingPixels[3],
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  avatarPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textContainer: {
    flex: 1,
  },
  title: {
    fontSize: fontSizePixels.lg,
    fontWeight: '600',
  },
  subtitle: {
    fontSize: fontSizePixels.sm,
    marginTop: 2,
  },
  // Menu styles
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  menuContainer: {
    position: 'absolute',
    right: spacingPixels[3],
    minWidth: 200,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 5,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
  },
  menuItemIcon: {
    marginRight: spacingPixels[3],
    width: 24,
  },
  menuItemText: {
    fontSize: fontSizePixels.base,
  },
});
