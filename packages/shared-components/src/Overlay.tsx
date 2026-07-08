import React, { useMemo } from 'react';
import {
  View,
  Modal,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  ScrollView,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { neutral } from '@rallia/design-system';
import { useThemeStyles } from '@rallia/shared-hooks/src/useThemeStyles.native';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export type OverlayType = 'bottom' | 'center';

interface OverlayProps {
  visible: boolean;
  onClose: () => void;
  onBack?: () => void; // Optional separate handler for back button
  children: React.ReactNode;
  type?: OverlayType;
  title?: string;
  showBackButton?: boolean;
  showCloseButton?: boolean;
  dismissOnBackdropPress?: boolean;
  darkBackground?: boolean; // For center overlays with dark content background
  alignTop?: boolean; // Align center overlay to top instead of center
  height?: number; // Custom height ratio for bottom overlay (0-1, e.g., 0.75 for 75%)
}

const Overlay: React.FC<OverlayProps> = ({
  visible,
  onClose,
  onBack,
  children,
  type = 'bottom',
  title,
  showBackButton = true,
  showCloseButton = true,
  dismissOnBackdropPress = true,
  darkBackground = false,
  alignTop = false,
  height,
}) => {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useThemeStyles();

  // Get theme colors for compatibility
  const themeColors = useMemo(() => {
    return {
      background: colors.background,
      foreground: colors.foreground,
      card: colors.card,
      border: colors.border,
      mutedForeground: colors.textMuted,
    };
  }, [colors]);

  // Calculate overlay height: use custom height ratio if provided, otherwise 2/3 of screen height
  const heightRatio = height ?? 0.67;
  const calculatedHeight = Math.round(SCREEN_HEIGHT * heightRatio);
  const overlayHeight = calculatedHeight - insets.bottom; // Account for bottom safe area

  const handleBackdropPress = () => {
    if (dismissOnBackdropPress) {
      onClose();
    }
  };

  const handleBackPress = () => {
    // If onBack is provided, use it; otherwise fall back to onClose
    if (onBack) {
      onBack();
    } else {
      onClose();
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType={type === 'bottom' ? 'slide' : 'fade'}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={styles.keyboardAvoidingView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        <TouchableWithoutFeedback onPress={handleBackdropPress}>
          <View
            style={[
              styles.overlay,
              {
                backgroundColor: isDark ? 'rgba(0, 0, 0, 0.7)' : 'rgba(0, 0, 0, 0.5)',
              },
              type === 'center' && styles.overlayCentered,
              type === 'center' && alignTop && styles.overlayTop,
            ]}
          >
            <TouchableWithoutFeedback>
              <View
                style={[
                  styles.container,
                  { backgroundColor: darkBackground ? neutral[900] : themeColors.card },
                  type === 'center' && styles.containerCenter,
                  type === 'bottom' && {
                    height: overlayHeight,
                    paddingBottom: insets.bottom + 8, // Safe area + minimal padding
                  },
                ]}
              >
                {/* Header - only for bottom type */}
                {type === 'bottom' && (
                  <View style={styles.header}>
                    {showBackButton && (
                      <TouchableOpacity onPress={handleBackPress} style={styles.backButton}>
                        <Ionicons name="chevron-back" size={24} color={themeColors.foreground} />
                      </TouchableOpacity>
                    )}

                    {title && (
                      <View style={[styles.titleBar, { backgroundColor: themeColors.border }]} />
                    )}

                    {showCloseButton && (
                      <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                        <Ionicons name="close" size={24} color={themeColors.foreground} />
                      </TouchableOpacity>
                    )}
                  </View>
                )}

                {/* Content */}
                {type === 'center' ? (
                  <View style={styles.centerContent}>{children}</View>
                ) : (
                  <ScrollView
                    style={styles.scrollView}
                    contentContainerStyle={styles.content}
                    showsVerticalScrollIndicator={true}
                    bounces={true}
                    keyboardShouldPersistTaps="handled"
                  >
                    {children}
                  </ScrollView>
                )}
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  keyboardAvoidingView: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    // backgroundColor is set inline based on theme (isDark)
    justifyContent: 'flex-end',
  },
  overlayCentered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlayTop: {
    justifyContent: 'flex-start',
    paddingTop: 60, // Space from top of screen
  },
  container: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    // Height is set dynamically in component for bottom type
    // backgroundColor is set inline based on theme
  },
  containerCenter: {
    borderRadius: 16,
    maxHeight: '80%',
    maxWidth: '85%',
    width: '85%',
    paddingVertical: 24,
    paddingHorizontal: 24,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 10,
  },
  backButton: {
    padding: 8,
  },
  closeButton: {
    padding: 8,
  },
  titleBar: {
    width: 60,
    height: 4,
    borderRadius: 2,
    // backgroundColor is set inline based on theme
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    flexGrow: 1,
  },
  centerContent: {
    // For center-type overlays, use a simple View instead of ScrollView
    // This prevents the flex: 1 collapse issue on iOS
  },
});

export default Overlay;
