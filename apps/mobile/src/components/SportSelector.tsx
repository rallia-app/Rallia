/**
 * SportSelector - Header pill + dropdown to switch between sports.
 * Moved from shared-components so we can use SportIcon (tennis/pickleball SVGs) directly.
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  TouchableOpacity,
  Modal,
  ScrollView,
  StyleSheet,
  Animated,
  Dimensions,
  TouchableWithoutFeedback,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import {
  lightTheme,
  darkTheme,
  spacingPixels,
  radiusPixels,
  primary,
  neutral,
  duration,
} from '@rallia/design-system';
import { lightHaptic, selectionHaptic, mediumHaptic } from '@rallia/shared-utils';
import { SportIcon } from './SportIcon';

export interface Sport {
  id: string;
  name: string;
  display_name: string;
  icon_url?: string | null;
}

export interface SportSelectorProps {
  selectedSport: Sport | null;
  userSports: Sport[];
  onSelectSport: (sport: Sport) => void;
  isDark?: boolean;
  confirmBeforeSwitch?: boolean;
  t?: (key: string) => string;
  /** Unread notification counts keyed by sport name, for non-selected sports */
  otherSportsUnreadCount?: Record<string, number>;
}

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

const SportSelector: React.FC<SportSelectorProps> = ({
  selectedSport,
  userSports,
  onSelectSport,
  isDark = false,
  confirmBeforeSwitch = true,
  t,
  otherSportsUnreadCount = {},
}) => {
  const [showDropdown, setShowDropdown] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [pendingSport, setPendingSport] = useState<Sport | null>(null);

  const translate = (key: string, fallback: string): string => {
    return t ? t(key) : fallback;
  };

  const fadeAnim = React.useMemo(() => new Animated.Value(0), []);
  const scaleAnim = React.useMemo(() => new Animated.Value(0.9), []);
  const buttonScaleAnim = React.useMemo(() => new Animated.Value(1), []);

  const themeColors = isDark ? darkTheme : lightTheme;
  const colors = {
    selectorBg: primary[500],
    selectorText: '#ffffff',
    dropdownBg: themeColors.card,
    dropdownBorder: themeColors.border,
    itemText: themeColors.foreground,
    itemTextSelected: primary[500],
    itemBg: 'transparent',
    itemBgSelected: isDark ? `${primary[500]}20` : `${primary[500]}10`,
    itemBorder: themeColors.border,
    overlayBg: 'rgba(0, 0, 0, 0.5)',
    checkmark: primary[500],
    chevron: '#ffffff',
  };

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

  const handleSportSelect = (sport: Sport) => {
    selectionHaptic();
    setShowDropdown(false);
    if (confirmBeforeSwitch && selectedSport?.id !== sport.id) {
      setPendingSport(sport);
      setShowConfirmation(true);
    } else {
      onSelectSport(sport);
    }
  };

  const handleConfirmSwitch = () => {
    mediumHaptic();
    if (pendingSport) onSelectSport(pendingSport);
    setShowConfirmation(false);
    setPendingSport(null);
  };

  const handleCancelSwitch = () => {
    lightHaptic();
    setShowConfirmation(false);
    setPendingSport(null);
  };

  const handleClose = () => {
    lightHaptic();
    setShowDropdown(false);
  };

  if (!selectedSport || userSports.length === 0) return null;

  const hasMultipleSports = userSports.length > 1;
  const totalOtherSportsUnread = Object.values(otherSportsUnreadCount).reduce((a, b) => a + b, 0);

  const handleButtonPress = () => {
    if (hasMultipleSports) {
      lightHaptic();
      Animated.sequence([
        Animated.timing(buttonScaleAnim, { toValue: 0.95, duration: 100, useNativeDriver: true }),
        Animated.timing(buttonScaleAnim, { toValue: 1, duration: 100, useNativeDriver: true }),
      ]).start();
      setShowDropdown(!showDropdown);
    }
  };

  return (
    <>
      <Animated.View style={[styles.selectorWrapper, { transform: [{ scale: buttonScaleAnim }] }]}>
        <TouchableOpacity
          style={[styles.selector, { backgroundColor: colors.selectorBg }]}
          onPress={handleButtonPress}
          activeOpacity={hasMultipleSports ? 0.85 : 1}
          disabled={!hasMultipleSports}
        >
          <SportIcon
            sportName={selectedSport.name}
            size={14}
            color={colors.selectorText}
            style={styles.selectorIcon}
          />
          {/* <Text color={colors.selectorText} weight="semibold" size="xs" numberOfLines={1}>
            {selectedSport.display_name}
          </Text> */}
          {hasMultipleSports && (
            <Ionicons
              name={showDropdown ? 'chevron-up' : 'chevron-down'}
              size={12}
              color={colors.chevron}
              style={{ marginLeft: 2 }}
            />
          )}
          {totalOtherSportsUnread > 0 && <View style={styles.pillBadge} />}
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
              { opacity: fadeAnim, backgroundColor: colors.overlayBg },
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
            <View style={[styles.dropdownHeader, { borderBottomColor: colors.itemBorder }]}>
              <Text size="base" weight="semibold" color={themeColors.foreground}>
                {translate('sportSelector.selectSport', 'Select Sport')}
              </Text>
              <TouchableOpacity
                onPress={handleClose}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close-outline" size={22} color={themeColors.mutedForeground} />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.scrollView}
              showsVerticalScrollIndicator={false}
              bounces={userSports.length > 5}
            >
              {userSports.map((sport, index) => {
                const isSelected = selectedSport?.id === sport.id;
                const isLast = index === userSports.length - 1;
                return (
                  <TouchableOpacity
                    key={sport.id}
                    style={[
                      styles.dropdownItem,
                      {
                        backgroundColor: isSelected ? colors.itemBgSelected : colors.itemBg,
                        borderBottomColor: isLast ? 'transparent' : colors.itemBorder,
                      },
                    ]}
                    onPress={() => handleSportSelect(sport)}
                    activeOpacity={0.7}
                  >
                    <View
                      style={[
                        styles.sportIcon,
                        {
                          backgroundColor: isSelected
                            ? `${primary[500]}25`
                            : isDark
                              ? neutral[700]
                              : neutral[100],
                        },
                      ]}
                    >
                      <SportIcon
                        sportName={sport.name}
                        size={18}
                        color={isSelected ? primary[500] : themeColors.mutedForeground}
                      />
                    </View>
                    <View style={styles.sportInfo}>
                      <Text
                        size="base"
                        weight={isSelected ? 'semibold' : 'regular'}
                        color={isSelected ? colors.itemTextSelected : colors.itemText}
                      >
                        {sport.display_name}
                      </Text>
                    </View>
                    {!isSelected && (otherSportsUnreadCount[sport.name] ?? 0) > 0 && (
                      <View style={styles.dropdownBadge}>
                        <Text
                          size="xs"
                          weight="semibold"
                          color="#ffffff"
                          style={styles.dropdownBadgeText}
                        >
                          {otherSportsUnreadCount[sport.name]}
                        </Text>
                      </View>
                    )}
                    {isSelected && (
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
            </ScrollView>
          </Animated.View>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={showConfirmation}
        transparent
        animationType="fade"
        onRequestClose={handleCancelSwitch}
        statusBarTranslucent
      >
        <TouchableWithoutFeedback onPress={handleCancelSwitch}>
          <View style={styles.confirmationBackdrop}>
            <TouchableWithoutFeedback>
              <View style={[styles.confirmationModal, { backgroundColor: themeColors.card }]}>
                <View style={styles.confirmationIconRow}>
                  {pendingSport && (
                    <SportIcon
                      sportName={pendingSport.name}
                      size={32}
                      color={primary[500]}
                      style={styles.confirmationIcon}
                    />
                  )}
                  <Text
                    size="lg"
                    weight="semibold"
                    style={[styles.confirmationTitle, { color: themeColors.foreground }]}
                  >
                    {translate('sportSelector.switchConfirmTitle', 'Switch Sport?')}
                  </Text>
                </View>
                <Text
                  size="base"
                  style={[styles.confirmationMessage, { color: themeColors.mutedForeground }]}
                >
                  {translate(
                    'sportSelector.switchConfirmMessage',
                    `You are about to switch to ${pendingSport?.display_name || 'another sport'}. Your match feed will update to show games for this sport.`
                  )}
                </Text>
                <View style={styles.confirmationButtonContainer}>
                  <TouchableOpacity
                    style={[
                      styles.confirmationButton,
                      styles.confirmationCancelButton,
                      { borderColor: themeColors.border },
                    ]}
                    onPress={handleCancelSwitch}
                    activeOpacity={0.7}
                  >
                    <Text
                      size="base"
                      weight="medium"
                      style={{ color: themeColors.foreground, textAlign: 'center' }}
                    >
                      {translate('common.cancel', 'Cancel')}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.confirmationButton,
                      styles.confirmationConfirmButton,
                      { backgroundColor: primary[500] },
                    ]}
                    onPress={handleConfirmSwitch}
                    activeOpacity={0.7}
                  >
                    <Text
                      size="base"
                      weight="medium"
                      style={{ color: '#ffffff', textAlign: 'center' }}
                    >
                      {translate('sportSelector.switchConfirmButton', 'Switch')}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  selectorWrapper: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
    alignSelf: 'flex-start',
  },
  selector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: radiusPixels.full,
    shadowColor: primary[500],
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 0,
  },
  selectorIcon: {
    marginRight: 4,
  },
  pillBadge: {
    position: 'absolute',
    top: -1,
    right: -2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#ef4444',
    borderWidth: 1.5,
    borderColor: '#ffffff',
  },
  dropdownBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#ef4444',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    marginLeft: spacingPixels[2],
  },
  dropdownBadgeText: {
    lineHeight: 20,
    textAlign: 'center',
    includeFontPadding: false,
    textAlignVertical: 'center',
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
    shadowOffset: { width: 0, height: 4 },
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
  scrollView: {
    flexGrow: 0,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3.5],
    borderBottomWidth: 1,
  },
  sportIcon: {
    width: spacingPixels[10],
    height: spacingPixels[10],
    borderRadius: radiusPixels.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacingPixels[3],
  },
  sportInfo: {
    flex: 1,
  },
  checkContainer: {
    marginLeft: spacingPixels[2],
  },
  confirmationBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[5],
  },
  confirmationModal: {
    width: '100%',
    maxWidth: 340,
    borderRadius: radiusPixels.xl,
    paddingTop: spacingPixels[6],
    paddingHorizontal: spacingPixels[5],
    paddingBottom: spacingPixels[5],
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  confirmationIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[3],
    marginBottom: spacingPixels[2],
  },
  confirmationIcon: {},
  confirmationTitle: {
    textAlign: 'center',
  },
  confirmationMessage: {
    textAlign: 'center',
    marginBottom: spacingPixels[4],
    lineHeight: 22,
  },
  confirmationButtonContainer: {
    flexDirection: 'row',
    gap: spacingPixels[3],
  },
  confirmationButton: {
    flex: 1,
    paddingVertical: spacingPixels[3],
    borderRadius: radiusPixels.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  confirmationCancelButton: {
    borderWidth: 1,
  },
  confirmationConfirmButton: {},
});

export default SportSelector;
