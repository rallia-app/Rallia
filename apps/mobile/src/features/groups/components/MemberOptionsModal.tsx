/**
 * MemberOptionsModal
 * A styled bottom sheet modal for member action options
 */

import React, { useCallback } from 'react';
import { View, TouchableOpacity, StyleSheet, Image } from 'react-native';
import ActionSheet, { SheetManager, SheetProps } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { useThemeStyles, useTranslation } from '../../../hooks';
import { radiusPixels, spacingPixels } from '@rallia/design-system';

interface OptionItem {
  id: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  destructive?: boolean;
}

interface MemberInfo {
  name: string;
  role: 'member' | 'moderator';
  isCreator: boolean;
  profilePictureUrl?: string | null;
  playerId?: string;
}

export function MemberOptionsActionSheet({ payload }: SheetProps<'member-options'>) {
  const member = payload?.member ?? null;
  const options = payload?.options ?? [];
  const onAvatarPress = payload?.onAvatarPress;

  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();

  const handleClose = useCallback(() => {
    SheetManager.hide('member-options');
  }, []);

  if (!member) return null;

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={[styles.sheetBackground, { backgroundColor: colors.cardBackground }]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
    >
      <View style={styles.container}>
        {/* Member Header */}
        <View style={[styles.memberHeader, { borderBottomColor: colors.border }]}>
          <TouchableOpacity
            style={[styles.avatar, { backgroundColor: isDark ? '#2C2C2E' : '#E5E5EA' }]}
            onPress={() => {
              if (member.playerId && onAvatarPress) {
                handleClose();
                onAvatarPress(member.playerId);
              }
            }}
            activeOpacity={0.7}
            disabled={!member.playerId || !onAvatarPress}
          >
            {member.profilePictureUrl ? (
              <Image source={{ uri: member.profilePictureUrl }} style={styles.avatarImage} />
            ) : (
              <Ionicons name="person-outline" size={32} color={colors.textMuted} />
            )}
          </TouchableOpacity>
          <View style={styles.memberInfo}>
            <Text weight="semibold" size="lg" style={{ color: colors.text }}>
              {member.name}
            </Text>
            <View style={styles.badges}>
              {member.role === 'moderator' && (
                <View style={[styles.badge, { backgroundColor: isDark ? '#FF9500' : '#FFF3E0' }]}>
                  <Text size="xs" style={{ color: isDark ? '#FFFFFF' : '#FF9500' }}>
                    {t('groups.moderator')}
                  </Text>
                </View>
              )}
              {member.isCreator && (
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
          <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
            <Ionicons name="close-outline" size={24} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Options List */}
        <View style={styles.optionsList}>
          {options.map((option, index) => (
            <TouchableOpacity
              key={option.id}
              style={[
                styles.optionItem,
                index < options.length - 1 && {
                  borderBottomColor: colors.border,
                  borderBottomWidth: StyleSheet.hairlineWidth,
                },
              ]}
              onPress={() => {
                // Close the options sheet first, then execute the action after a delay
                // This prevents race conditions when opening another sheet
                handleClose();
                setTimeout(() => {
                  option.onPress();
                }, 300);
              }}
              activeOpacity={0.7}
            >
              <View
                style={[
                  styles.optionIcon,
                  {
                    backgroundColor: option.destructive
                      ? isDark
                        ? 'rgba(255, 59, 48, 0.15)'
                        : 'rgba(255, 59, 48, 0.1)'
                      : isDark
                        ? 'rgba(0, 122, 255, 0.15)'
                        : 'rgba(0, 122, 255, 0.1)',
                  },
                ]}
              >
                <Ionicons
                  name={option.icon as keyof typeof Ionicons.glyphMap}
                  size={22}
                  color={option.destructive ? '#FF3B30' : colors.primary}
                />
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
          onPress={handleClose}
          activeOpacity={0.7}
        >
          <Text weight="semibold" size="base" style={{ color: colors.primary }}>
            {t('common.cancel')}
          </Text>
        </TouchableOpacity>
      </View>
    </ActionSheet>
  );
}

// Keep old export for backwards compatibility during migration
export const MemberOptionsModal = MemberOptionsActionSheet;

const styles = StyleSheet.create({
  sheetBackground: {
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
    paddingBottom: spacingPixels[4],
  },
  memberHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[5],
    paddingVertical: spacingPixels[4],
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
  },
  badges: {
    flexDirection: 'row',
    marginTop: 4,
    gap: 6,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  closeButton: {
    padding: 4,
  },
  optionsList: {
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[2],
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
    marginHorizontal: spacingPixels[4],
    marginTop: spacingPixels[2],
    paddingVertical: spacingPixels[3.5],
    borderRadius: radiusPixels.lg,
    alignItems: 'center',
  },
});
