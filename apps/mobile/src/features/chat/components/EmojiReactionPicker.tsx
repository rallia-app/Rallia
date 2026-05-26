/**
 * EmojiReactionPicker Component
 * WhatsApp-style emoji picker for reacting to messages
 * Can be positioned near a message or centered
 */

import React, { useCallback, memo } from 'react';
import {
  View,
  Modal,
  TouchableOpacity,
  StyleSheet,
  TouchableWithoutFeedback,
  Dimensions,
} from 'react-native';
import { Text } from '@rallia/shared-components';
import { spacingPixels } from '@rallia/design-system';
import { COMMON_REACTIONS } from '@rallia/shared-services';

import { useThemeStyles } from '#/hooks';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const PICKER_HEIGHT = 60; // Approximate picker height

interface EmojiReactionPickerProps {
  visible: boolean;
  onSelect: (emoji: string) => void;
  onClose: () => void;
  /** Y position of the message to anchor the picker near */
  anchorY?: number;
  /** Whether the message is from the current user (positions picker on left vs right) */
  isOwnMessage?: boolean;
}

function EmojiReactionPickerComponent({
  visible,
  onSelect,
  onClose,
  anchorY,
  isOwnMessage = false,
}: EmojiReactionPickerProps) {
  const { colors, isDark } = useThemeStyles();

  const handleSelect = useCallback(
    (emoji: string) => {
      onSelect(emoji);
    },
    [onSelect]
  );

  // Calculate position based on anchor
  const getPositionStyle = () => {
    if (anchorY === undefined) {
      // Center if no anchor provided
      return {
        justifyContent: 'center' as const,
        alignItems: 'center' as const,
      };
    }

    // Position near the message
    // Ensure picker stays within screen bounds
    const topPosition = Math.max(
      50, // Min distance from top
      Math.min(anchorY - PICKER_HEIGHT - 10, SCREEN_HEIGHT - PICKER_HEIGHT - 100)
    );

    return {
      position: 'absolute' as const,
      top: topPosition,
      // Position on the left for own messages, right for others
      ...(isOwnMessage ? { right: 16 } : { left: 16 }),
    };
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={[styles.overlay, anchorY === undefined && styles.centered]}>
          <TouchableWithoutFeedback>
            <View
              style={[
                styles.pickerContainer,
                { backgroundColor: isDark ? colors.card : '#FFFFFF' },
                anchorY !== undefined && getPositionStyle(),
              ]}
            >
              <View style={styles.emojiRow}>
                {COMMON_REACTIONS.map(emoji => (
                  <TouchableOpacity
                    key={emoji}
                    style={styles.emojiButton}
                    onPress={() => handleSelect(emoji)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.emoji}>{emoji}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

export const EmojiReactionPicker = memo(EmojiReactionPickerComponent);

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  pickerContainer: {
    borderRadius: 28,
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 5,
  },
  emojiRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiButton: {
    width: 46,
    height: 46,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 2,
  },
  emoji: {
    fontSize: 30,
    lineHeight: 38,
    textAlign: 'center',
  },
});
