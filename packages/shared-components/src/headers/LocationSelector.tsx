import React, { useState, useEffect } from 'react';
import { View, TouchableOpacity, Modal, StyleSheet, Animated, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../foundation/Text';
import {
  lightTheme,
  darkTheme,
  spacingPixels,
  radiusPixels,
  primary,
  neutral,
  duration,
} from '@rallia/design-system';
import { lightHaptic, selectionHaptic } from '@rallia/shared-utils';
import { TranslationKey } from '@rallia/shared-translations';

export type LocationMode = 'current' | 'home';

export interface LocationSelectorProps {
  /** Currently selected location mode */
  selectedMode: LocationMode;
  /** Callback when a mode is selected */
  onSelectMode: (mode: LocationMode) => void;
  /** Whether the home location is available */
  hasHomeLocation: boolean;
  /** Label for home location (e.g., "H2X 1Y4" or "Montreal") */
  homeLocationLabel?: string;
  /** Whether dark mode is enabled */
  isDark?: boolean;
  /** Translation function */
  t: (key: TranslationKey) => string;
}

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

const LocationSelector: React.FC<LocationSelectorProps> = ({
  selectedMode,
  onSelectMode,
  hasHomeLocation,
  homeLocationLabel,
  isDark = false,
  t,
}) => {
  const [showDropdown, setShowDropdown] = useState(false);

  // Animation values - using useMemo to create stable Animated.Value instances
  const fadeAnim = React.useMemo(() => new Animated.Value(0), []);
  const scaleAnim = React.useMemo(() => new Animated.Value(0.9), []);
  const buttonScaleAnim = React.useMemo(() => new Animated.Value(1), []);

  // Theme-aware colors
  const themeColors = isDark ? darkTheme : lightTheme;
  const colors = {
    // Selector button - secondary color for location (different from sport)
    selectorBg: themeColors.card,
    selectorBorder: themeColors.border,
    selectorText: themeColors.foreground,

    // Dropdown
    dropdownBg: themeColors.card,
    dropdownBorder: themeColors.border,
    itemText: themeColors.foreground,
    itemTextSelected: primary[500],
    itemBg: 'transparent',
    itemBgSelected: isDark ? `${primary[500]}20` : `${primary[500]}10`,
    itemBorder: themeColors.border,

    // Overlay
    overlayBg: 'rgba(0, 0, 0, 0.5)',

    // Icons
    checkmark: primary[500],
    icon: themeColors.mutedForeground,
    iconSelected: primary[500],
  };

  // Animate dropdown open/close
  useEffect(() => {
    if (showDropdown) {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: duration.fast,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          friction: 8,
          tension: 100,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: duration.fast,
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 0.9,
          duration: duration.fast,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [showDropdown, fadeAnim, scaleAnim]);

  const handleModeSelect = (mode: LocationMode) => {
    selectionHaptic();
    onSelectMode(mode);
    setShowDropdown(false);
  };

  const handleClose = () => {
    lightHaptic();
    setShowDropdown(false);
  };

  const handleButtonPress = () => {
    lightHaptic();
    // Animate button press
    Animated.sequence([
      Animated.timing(buttonScaleAnim, {
        toValue: 0.95,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(buttonScaleAnim, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start();
    setShowDropdown(!showDropdown);
  };

  // Location options
  const locationOptions: Array<{
    mode: LocationMode;
    icon: 'navigate-outline' | 'home-outline';
    labelKey: TranslationKey;
    descriptionKey?: TranslationKey;
    disabled?: boolean;
  }> = [
    {
      mode: 'current',
      icon: 'navigate-outline',
      labelKey: 'home.location.current',
      descriptionKey: 'home.location.currentDescription',
    },
    {
      mode: 'home',
      icon: 'home-outline',
      labelKey: 'home.location.home',
      descriptionKey: homeLocationLabel ? undefined : 'home.location.homeNotSet',
      disabled: !hasHomeLocation,
    },
  ];

  const selectedOption = locationOptions.find(opt => opt.mode === selectedMode);

  return (
    <>
      <Animated.View
        style={[
          styles.selectorWrapper,
          {
            transform: [{ scale: buttonScaleAnim }],
          },
        ]}
      >
        <TouchableOpacity
          style={[
            styles.selector,
            {
              backgroundColor: colors.selectorBg,
              borderColor: colors.selectorBorder,
            },
          ]}
          onPress={handleButtonPress}
          activeOpacity={0.85}
        >
          <Ionicons
            name={selectedOption?.icon === 'home-outline' ? 'home-outline' : 'navigate-outline'}
            size={14}
            color={colors.selectorText}
          />
          <Ionicons
            name={showDropdown ? 'chevron-up-outline' : 'chevron-down-outline'}
            size={12}
            color={colors.selectorText}
          />
        </TouchableOpacity>
      </Animated.View>

      <Modal
        visible={showDropdown}
        transparent
        animationType="none"
        onRequestClose={handleClose}
        statusBarTranslucent
      >
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={handleClose}>
          <Animated.View
            style={[
              styles.overlayBackground,
              {
                opacity: fadeAnim,
                backgroundColor: colors.overlayBg,
              },
            ]}
          />
          <Animated.View
            style={[
              styles.dropdownContainer,
              {
                backgroundColor: colors.dropdownBg,
                borderColor: colors.dropdownBorder,
                opacity: fadeAnim,
                transform: [{ scale: scaleAnim }],
              },
            ]}
          >
            {/* Header */}
            <View style={[styles.dropdownHeader, { borderBottomColor: colors.itemBorder }]}>
              <Text size="base" weight="semibold" color={themeColors.foreground}>
                {t('home.location.title')}
              </Text>
              <TouchableOpacity
                onPress={handleClose}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close-outline" size={22} color={themeColors.mutedForeground} />
              </TouchableOpacity>
            </View>

            {/* Location options */}
            <View style={styles.optionsList}>
              {locationOptions.map((option, index) => {
                const isSelected = selectedMode === option.mode;
                const isLast = index === locationOptions.length - 1;
                const isDisabled = option.disabled;

                return (
                  <TouchableOpacity
                    key={option.mode}
                    style={[
                      styles.dropdownItem,
                      {
                        backgroundColor: isSelected ? colors.itemBgSelected : colors.itemBg,
                        borderBottomColor: isLast ? 'transparent' : colors.itemBorder,
                        opacity: isDisabled ? 0.5 : 1,
                      },
                    ]}
                    onPress={() => !isDisabled && handleModeSelect(option.mode)}
                    activeOpacity={isDisabled ? 1 : 0.7}
                    disabled={isDisabled}
                  >
                    {/* Icon */}
                    <View
                      style={[
                        styles.optionIcon,
                        {
                          backgroundColor: isSelected
                            ? `${primary[500]}25`
                            : isDark
                              ? neutral[700]
                              : neutral[100],
                        },
                      ]}
                    >
                      <Ionicons
                        name={option.icon}
                        size={18}
                        color={isSelected ? colors.iconSelected : colors.icon}
                      />
                    </View>

                    {/* Label and description */}
                    <View style={styles.optionInfo}>
                      <Text
                        size="base"
                        weight={isSelected ? 'semibold' : 'regular'}
                        color={isSelected ? colors.itemTextSelected : colors.itemText}
                      >
                        {t(option.labelKey)}
                      </Text>
                      {option.mode === 'home' && homeLocationLabel && (
                        <Text size="sm" color={themeColors.mutedForeground}>
                          {homeLocationLabel}
                        </Text>
                      )}
                      {option.descriptionKey && (
                        <Text size="sm" color={themeColors.mutedForeground}>
                          {t(option.descriptionKey)}
                        </Text>
                      )}
                    </View>

                    {/* Checkmark for selected */}
                    {isSelected && !isDisabled && (
                      <View style={styles.checkContainer}>
                        <Ionicons
                          name="checkmark-circle-outline"
                          size={22}
                          color={colors.checkmark}
                        />
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </Animated.View>
        </TouchableOpacity>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  selectorWrapper: {
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  selector: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[3],
    borderRadius: radiusPixels.full,
    borderWidth: 1,
    gap: spacingPixels[1.5],
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlayBackground: {
    ...StyleSheet.absoluteFillObject,
  },
  dropdownContainer: {
    width: '80%',
    maxWidth: 320,
    maxHeight: SCREEN_HEIGHT * 0.6,
    borderRadius: radiusPixels.xl,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  dropdownHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3.5],
    borderBottomWidth: 1,
  },
  optionsList: {
    flexGrow: 0,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3.5],
    borderBottomWidth: 1,
  },
  optionIcon: {
    width: spacingPixels[10],
    height: spacingPixels[10],
    borderRadius: radiusPixels.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacingPixels[3],
  },
  optionInfo: {
    flex: 1,
  },
  checkContainer: {
    marginLeft: spacingPixels[2],
  },
});

export default LocationSelector;
