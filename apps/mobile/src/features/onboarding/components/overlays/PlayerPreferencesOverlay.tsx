import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Animated,
  ActivityIndicator,
  Alert,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { Ionicons } from '@expo/vector-icons';
import { Overlay } from '@rallia/shared-components';
import { OnboardingService, SportService, Logger } from '@rallia/shared-services';
import type { OnboardingPlayerPreferences } from '@rallia/shared-types';
import ProgressIndicator from '../ProgressIndicator';
import { selectionHaptic, mediumHaptic } from '@rallia/shared-utils';
import { useThemeStyles, useTranslation } from '../../../../hooks';

interface PlayerPreferencesOverlayProps {
  visible: boolean;
  onClose: () => void;
  onBack?: () => void;
  onContinue?: (preferences: PlayerPreferences) => void;
  selectedSports: string[]; // ['tennis', 'pickleball'] or just one
  currentStep?: number;
  totalSteps?: number;
}

interface PlayerPreferences {
  playingHand: 'left' | 'right' | 'both';
  maxTravelDistance: number;
  matchDuration: '30' | '60' | '90' | '120';
  tennisMatchDuration?: '30' | '60' | '90' | '120';
  pickleballMatchDuration?: '30' | '60' | '90' | '120';
  sameForAllSports: boolean;
  tennisMatchType?: 'casual' | 'competitive' | 'both';
  pickleballMatchType?: 'casual' | 'competitive' | 'both';
}

const PlayerPreferencesOverlay: React.FC<PlayerPreferencesOverlayProps> = ({
  visible,
  onClose,
  onBack,
  onContinue,
  selectedSports,
  currentStep = 1,
  totalSteps = 8,
}) => {
  const { colors } = useThemeStyles();
  const { t } = useTranslation();
  const [playingHand, setPlayingHand] = useState<'left' | 'right' | 'both'>('right');
  const [maxTravelDistance, setMaxTravelDistance] = useState<number>(15);
  const [matchDuration, setMatchDuration] = useState<'30' | '60' | '90' | '120'>('90');
  const [tennisMatchDuration, setTennisMatchDuration] = useState<'30' | '60' | '90' | '120'>('90');
  const [pickleballMatchDuration, setPickleballMatchDuration] = useState<
    '30' | '60' | '90' | '120'
  >('90');
  const [sameDurationForAllSports, setSameDurationForAllSports] = useState(true);
  const [sameMatchTypeForAllSports, setSameMatchTypeForAllSports] = useState(true);
  const [tennisMatchType, setTennisMatchType] = useState<'casual' | 'competitive' | 'both'>(
    'competitive'
  );
  const [pickleballMatchType, setPickleballMatchType] = useState<'casual' | 'competitive' | 'both'>(
    'competitive'
  );
  const [isSaving, setIsSaving] = useState(false);

  const hasTennis = selectedSports.includes('tennis');
  const hasPickleball = selectedSports.includes('pickleball');

  // Animation values - using useMemo to create stable Animated.Value instances
  const fadeAnim = useMemo(() => new Animated.Value(0), []);
  const slideAnim = useMemo(() => new Animated.Value(50), []);

  // Trigger animations when overlay becomes visible
  useEffect(() => {
    if (visible) {
      fadeAnim.setValue(0);
      slideAnim.setValue(50);

      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, fadeAnim, slideAnim]);

  const handleContinue = async () => {
    if (isSaving) return;

    if (onContinue) {
      mediumHaptic();
      setIsSaving(true);

      try {
        // Get sport IDs from sport names
        const sportsData: OnboardingPlayerPreferences['sports'] = [];

        if (hasTennis) {
          const { data: tennisSport } = await SportService.getSportByName('tennis');
          if (tennisSport) {
            sportsData.push({
              sport_id: tennisSport.id,
              sport_name: 'tennis',
              preferred_match_duration: sameDurationForAllSports
                ? matchDuration
                : tennisMatchDuration,
              preferred_match_type: tennisMatchType,
              is_primary: selectedSports.length === 1 || selectedSports[0] === 'tennis',
            });
          }
        }

        if (hasPickleball) {
          const { data: pickleballSport } = await SportService.getSportByName('pickleball');
          if (pickleballSport) {
            sportsData.push({
              sport_id: pickleballSport.id,
              sport_name: 'pickleball',
              preferred_match_duration: sameDurationForAllSports
                ? matchDuration
                : pickleballMatchDuration,
              preferred_match_type: sameMatchTypeForAllSports
                ? tennisMatchType
                : pickleballMatchType || 'competitive',
              is_primary: selectedSports.length === 1 || selectedSports[0] === 'pickleball',
            });
          }
        }

        // Save preferences to database
        const preferencesData: OnboardingPlayerPreferences = {
          playing_hand: playingHand,
          max_travel_distance: maxTravelDistance,
          sports: sportsData,
        };

        const { error } = await OnboardingService.savePreferences(preferencesData);

        if (error) {
          Logger.error('Failed to save player preferences', error as Error, { preferencesData });
          setIsSaving(false);
          Alert.alert(t('common.error'), t('onboarding.validation.failedToSavePreferences'), [
            { text: t('common.ok') },
          ]);
          return;
        }

        // Call the original onContinue with local preferences
        const preferences: PlayerPreferences = {
          playingHand,
          maxTravelDistance,
          matchDuration,
          sameForAllSports: sameDurationForAllSports && sameMatchTypeForAllSports,
          ...(hasTennis && { tennisMatchType }),
          ...(hasPickleball && { pickleballMatchType }),
          ...(hasTennis &&
            hasPickleball &&
            !sameDurationForAllSports && {
              tennisMatchDuration,
              pickleballMatchDuration,
            }),
        };

        Logger.debug('player_preferences_saved', { preferencesData });
        onContinue(preferences);
      } catch (error) {
        Logger.error('Unexpected error saving preferences', error as Error);
        setIsSaving(false);
        Alert.alert(t('common.error'), t('onboarding.validation.unexpectedError'), [
          { text: t('common.ok') },
        ]);
      }
    }
  };

  return (
    <Overlay
      visible={visible}
      onClose={onClose}
      onBack={onBack}
      type="bottom"
      showBackButton={false}
    >
      <View style={styles.overlayContent}>
        <ScrollView
          style={styles.scrollContainer}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Animated.View
            style={[
              styles.container,
              {
                opacity: fadeAnim,
                transform: [{ translateY: slideAnim }],
              },
            ]}
          >
            <ProgressIndicator currentStep={currentStep} totalSteps={totalSteps} />

            {/* Back Button */}
            <TouchableOpacity
              style={styles.backButton}
              onPress={onBack || onClose}
              activeOpacity={0.7}
            >
              <Text style={[styles.backButtonText, { color: colors.text }]}>←</Text>
            </TouchableOpacity>

            {/* Title */}
            <Text style={[styles.title, { color: colors.text }]}>
              Tell us about your{'\n'}preferences
            </Text>

            {/* Playing Hand */}
            <Text style={[styles.sectionLabel, { color: colors.text }]}>
              Preferred Playing Hand
            </Text>
            <View style={styles.buttonGroup}>
              <TouchableOpacity
                style={[styles.optionButton, playingHand === 'left' && styles.optionButtonSelected]}
                onPress={() => {
                  selectionHaptic();
                  setPlayingHand('left');
                }}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.optionButtonText,
                    playingHand === 'left' && styles.optionButtonTextSelected,
                  ]}
                >
                  Left
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.optionButton,
                  playingHand === 'right' && styles.optionButtonSelected,
                ]}
                onPress={() => {
                  selectionHaptic();
                  setPlayingHand('right');
                }}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.optionButtonText,
                    playingHand === 'right' && styles.optionButtonTextSelected,
                  ]}
                >
                  Right
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.optionButton, playingHand === 'both' && styles.optionButtonSelected]}
                onPress={() => {
                  selectionHaptic();
                  setPlayingHand('both');
                }}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.optionButtonText,
                    playingHand === 'both' && styles.optionButtonTextSelected,
                  ]}
                >
                  Both
                </Text>
              </TouchableOpacity>
            </View>

            {/* Maximum Travel Distance */}
            <Text style={[styles.sectionLabel, { color: colors.text }]}>
              Maximum Travel Distance
            </Text>
            <View style={styles.sliderContainer}>
              <Text style={[styles.sliderValue, { color: colors.text }]}>
                {maxTravelDistance} km
              </Text>
              <Slider
                style={styles.slider}
                minimumValue={1}
                maximumValue={50}
                step={1}
                value={maxTravelDistance}
                onValueChange={setMaxTravelDistance}
                minimumTrackTintColor={colors.primary}
                maximumTrackTintColor={colors.inputBorder}
                thumbTintColor={colors.primary}
              />
            </View>

            {/* Preferred Match Duration */}
            <Text style={[styles.sectionLabel, { color: colors.text }]}>
              Preferred Match Duration
            </Text>

            {/* Show unified buttons when sameDurationForAllSports is true OR only one sport selected */}
            {(sameDurationForAllSports || !(hasTennis && hasPickleball)) && (
              <View style={styles.buttonGroup}>
                <TouchableOpacity
                  style={[
                    styles.optionButton,
                    {
                      backgroundColor:
                        matchDuration === '60' ? colors.primary : colors.inputBackground,
                      borderColor: matchDuration === '60' ? colors.primary : 'transparent',
                    },
                  ]}
                  onPress={() => {
                    selectionHaptic();
                    setMatchDuration('60');
                    setTennisMatchDuration('60');
                    setPickleballMatchDuration('60');
                  }}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      styles.optionButtonText,
                      {
                        color: matchDuration === '60' ? colors.primaryForeground : colors.textMuted,
                      },
                    ]}
                  >
                    1h
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.optionButton,
                    {
                      backgroundColor:
                        matchDuration === '90' ? colors.primary : colors.inputBackground,
                      borderColor: matchDuration === '90' ? colors.primary : 'transparent',
                    },
                  ]}
                  onPress={() => {
                    selectionHaptic();
                    setMatchDuration('90');
                    setTennisMatchDuration('90');
                    setPickleballMatchDuration('90');
                  }}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      styles.optionButtonText,
                      {
                        color: matchDuration === '90' ? colors.primaryForeground : colors.textMuted,
                      },
                    ]}
                  >
                    1.5h
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.optionButton,
                    {
                      backgroundColor:
                        matchDuration === '120' ? colors.primary : colors.inputBackground,
                      borderColor: matchDuration === '120' ? colors.primary : 'transparent',
                    },
                  ]}
                  onPress={() => {
                    selectionHaptic();
                    setMatchDuration('120');
                    setTennisMatchDuration('120');
                    setPickleballMatchDuration('120');
                  }}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      styles.optionButtonText,
                      {
                        color:
                          matchDuration === '120' ? colors.primaryForeground : colors.textMuted,
                      },
                    ]}
                  >
                    2h
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Show separate rows for Tennis and Pickleball when checkbox is unchecked */}
            {!sameDurationForAllSports && hasTennis && hasPickleball && (
              <>
                {/* Tennis Duration */}
                <Text style={[styles.sportSubLabel, { color: colors.textMuted }]}>Tennis</Text>
                <View style={styles.buttonGroup}>
                  <TouchableOpacity
                    style={[
                      styles.optionButton,
                      {
                        backgroundColor:
                          tennisMatchDuration === '60' ? colors.primary : colors.inputBackground,
                        borderColor: tennisMatchDuration === '60' ? colors.primary : 'transparent',
                      },
                    ]}
                    onPress={() => {
                      selectionHaptic();
                      setTennisMatchDuration('60');
                    }}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        styles.optionButtonText,
                        {
                          color:
                            tennisMatchDuration === '60'
                              ? colors.primaryForeground
                              : colors.textMuted,
                        },
                      ]}
                    >
                      1h
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.optionButton,
                      {
                        backgroundColor:
                          tennisMatchDuration === '90' ? colors.primary : colors.inputBackground,
                        borderColor: tennisMatchDuration === '90' ? colors.primary : 'transparent',
                      },
                    ]}
                    onPress={() => {
                      selectionHaptic();
                      setTennisMatchDuration('90');
                    }}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        styles.optionButtonText,
                        {
                          color:
                            tennisMatchDuration === '90'
                              ? colors.primaryForeground
                              : colors.textMuted,
                        },
                      ]}
                    >
                      1.5h
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.optionButton,
                      {
                        backgroundColor:
                          tennisMatchDuration === '120' ? colors.primary : colors.inputBackground,
                        borderColor: tennisMatchDuration === '120' ? colors.primary : 'transparent',
                      },
                    ]}
                    onPress={() => {
                      selectionHaptic();
                      setTennisMatchDuration('120');
                    }}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        styles.optionButtonText,
                        {
                          color:
                            tennisMatchDuration === '120'
                              ? colors.primaryForeground
                              : colors.textMuted,
                        },
                      ]}
                    >
                      2h
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Pickleball Duration */}
                <Text style={[styles.sportSubLabel, { color: colors.textMuted }]}>Pickleball</Text>
                <View style={styles.buttonGroup}>
                  <TouchableOpacity
                    style={[
                      styles.optionButton,
                      pickleballMatchDuration === '60' && styles.optionButtonSelected,
                    ]}
                    onPress={() => {
                      selectionHaptic();
                      setPickleballMatchDuration('60');
                    }}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        styles.optionButtonText,
                        pickleballMatchDuration === '60' && styles.optionButtonTextSelected,
                      ]}
                    >
                      1h
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.optionButton,
                      pickleballMatchDuration === '90' && styles.optionButtonSelected,
                    ]}
                    onPress={() => {
                      selectionHaptic();
                      setPickleballMatchDuration('90');
                    }}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        styles.optionButtonText,
                        pickleballMatchDuration === '90' && styles.optionButtonTextSelected,
                      ]}
                    >
                      1.5h
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.optionButton,
                      pickleballMatchDuration === '120' && styles.optionButtonSelected,
                    ]}
                    onPress={() => {
                      selectionHaptic();
                      setPickleballMatchDuration('120');
                    }}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        styles.optionButtonText,
                        pickleballMatchDuration === '120' && styles.optionButtonTextSelected,
                      ]}
                    >
                      2h
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}

            {/* Same duration for all sports checkbox (only show if both sports selected) */}
            {hasTennis && hasPickleball && (
              <TouchableOpacity
                style={styles.checkboxContainer}
                onPress={() => {
                  selectionHaptic();
                  setSameDurationForAllSports(!sameDurationForAllSports);
                }}
                activeOpacity={0.8}
              >
                <View
                  style={[
                    styles.checkbox,
                    {
                      borderColor: colors.primary,
                      backgroundColor: sameDurationForAllSports ? colors.primary : 'transparent',
                    },
                  ]}
                >
                  {sameDurationForAllSports && (
                    <Ionicons name="checkmark-outline" size={16} color={colors.primaryForeground} />
                  )}
                </View>
                <Text style={styles.checkboxLabel}>Same for all sports</Text>
              </TouchableOpacity>
            )}

            {/* Preferred Match Type */}
            <Text style={[styles.sectionLabel, { color: colors.text }]}>Preferred Match Type</Text>

            {/* Tennis Match Type */}
            {hasTennis && (
              <>
                <Text style={[styles.sportSubLabel, { color: colors.textMuted }]}>Tennis</Text>
                <View style={styles.buttonGroup}>
                  <TouchableOpacity
                    style={[
                      styles.optionButton,
                      {
                        backgroundColor:
                          tennisMatchType === 'casual' ? colors.primary : colors.inputBackground,
                        borderColor: tennisMatchType === 'casual' ? colors.primary : 'transparent',
                      },
                    ]}
                    onPress={() => {
                      selectionHaptic();
                      setTennisMatchType('casual');
                    }}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        styles.optionButtonText,
                        {
                          color:
                            tennisMatchType === 'casual'
                              ? colors.primaryForeground
                              : colors.textMuted,
                        },
                      ]}
                    >
                      Casual
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.optionButton,
                      {
                        backgroundColor:
                          tennisMatchType === 'competitive'
                            ? colors.primary
                            : colors.inputBackground,
                        borderColor:
                          tennisMatchType === 'competitive' ? colors.primary : 'transparent',
                      },
                    ]}
                    onPress={() => {
                      selectionHaptic();
                      setTennisMatchType('competitive');
                    }}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        styles.optionButtonText,
                        {
                          color:
                            tennisMatchType === 'competitive'
                              ? colors.primaryForeground
                              : colors.textMuted,
                        },
                      ]}
                    >
                      Competitive
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.optionButton,
                      {
                        backgroundColor:
                          tennisMatchType === 'both' ? colors.primary : colors.inputBackground,
                        borderColor: tennisMatchType === 'both' ? colors.primary : 'transparent',
                      },
                    ]}
                    onPress={() => {
                      selectionHaptic();
                      setTennisMatchType('both');
                    }}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        styles.optionButtonText,
                        {
                          color:
                            tennisMatchType === 'both'
                              ? colors.primaryForeground
                              : colors.textMuted,
                        },
                      ]}
                    >
                      Both
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}

            {/* Pickleball Match Type - only show if not "same for all sports" or if only pickleball selected */}
            {hasPickleball && (!sameMatchTypeForAllSports || !hasTennis) && (
              <>
                <Text style={[styles.sportSubLabel, { color: colors.textMuted }]}>Pickleball</Text>
                <View style={styles.buttonGroup}>
                  <TouchableOpacity
                    style={[
                      styles.optionButton,
                      {
                        backgroundColor:
                          pickleballMatchType === 'casual'
                            ? colors.primary
                            : colors.inputBackground,
                        borderColor:
                          pickleballMatchType === 'casual' ? colors.primary : 'transparent',
                      },
                    ]}
                    onPress={() => {
                      selectionHaptic();
                      setPickleballMatchType('casual');
                    }}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        styles.optionButtonText,
                        {
                          color:
                            pickleballMatchType === 'casual'
                              ? colors.primaryForeground
                              : colors.textMuted,
                        },
                      ]}
                    >
                      Casual
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.optionButton,
                      {
                        backgroundColor:
                          pickleballMatchType === 'competitive'
                            ? colors.primary
                            : colors.inputBackground,
                        borderColor:
                          pickleballMatchType === 'competitive' ? colors.primary : 'transparent',
                      },
                    ]}
                    onPress={() => {
                      selectionHaptic();
                      setPickleballMatchType('competitive');
                    }}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        styles.optionButtonText,
                        {
                          color:
                            pickleballMatchType === 'competitive'
                              ? colors.primaryForeground
                              : colors.textMuted,
                        },
                      ]}
                    >
                      Competitive
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.optionButton,
                      {
                        backgroundColor:
                          pickleballMatchType === 'both' ? colors.primary : colors.inputBackground,
                        borderColor:
                          pickleballMatchType === 'both' ? colors.primary : 'transparent',
                      },
                    ]}
                    onPress={() => {
                      selectionHaptic();
                      setPickleballMatchType('both');
                    }}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        styles.optionButtonText,
                        {
                          color:
                            pickleballMatchType === 'both'
                              ? colors.primaryForeground
                              : colors.textMuted,
                        },
                      ]}
                    >
                      Both
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}

            {/* Same match type for all sports checkbox (only show if both sports selected) */}
            {hasTennis && hasPickleball && (
              <TouchableOpacity
                style={styles.checkboxContainer}
                onPress={() => {
                  selectionHaptic();
                  setSameMatchTypeForAllSports(!sameMatchTypeForAllSports);
                }}
                activeOpacity={0.8}
              >
                <View
                  style={[
                    styles.checkbox,
                    {
                      borderColor: colors.primary,
                      backgroundColor: sameMatchTypeForAllSports ? colors.primary : 'transparent',
                    },
                  ]}
                >
                  {sameMatchTypeForAllSports && (
                    <Ionicons name="checkmark-outline" size={16} color={colors.primaryForeground} />
                  )}
                </View>
                <Text style={styles.checkboxLabel}>Same for all sports</Text>
              </TouchableOpacity>
            )}
          </Animated.View>
        </ScrollView>

        {/* Continue Button - Fixed at bottom */}
        <TouchableOpacity
          style={[
            styles.continueButton,
            {
              backgroundColor: isSaving ? colors.buttonInactive : colors.primary,
              shadowColor: 'rgba(0, 0, 0, 0.2)',
            },
            isSaving && styles.continueButtonDisabled,
          ]}
          onPress={handleContinue}
          activeOpacity={0.8}
          disabled={isSaving}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color={colors.primaryForeground} />
          ) : (
            <Text style={[styles.continueButtonText, { color: colors.primaryForeground }]}>
              Continue
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </Overlay>
  );
};

const styles = StyleSheet.create({
  overlayContent: {
    height: '100%',
    maxHeight: 650,
    flexDirection: 'column',
  },
  scrollContainer: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 20,
  },
  container: {
    paddingVertical: 20,
    paddingBottom: 20,
  },
  backButton: {
    position: 'absolute',
    top: 20,
    left: 0,
    padding: 10,
    zIndex: 10,
  },
  backButtonText: {
    fontSize: 24,
    // color will be set dynamically
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 25,
    lineHeight: 28,
    // color will be set dynamically
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 12,
    marginTop: 20,
    // color will be set dynamically
  },
  sportSubLabel: {
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 10,
    marginTop: 10,
    // color will be set dynamically
  },
  buttonGroup: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  optionButton: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 2,
    // backgroundColor and borderColor will be set dynamically
  },
  optionButtonSelected: {
    // Styles applied dynamically
  },
  optionButtonText: {
    fontSize: 14,
    fontWeight: '600',
    // color will be set dynamically
  },
  optionButtonTextSelected: {
    // color will be set dynamically
  },
  sliderContainer: {
    marginBottom: 10,
  },
  sliderValue: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
    // color will be set dynamically
  },
  slider: {
    width: '100%',
    height: 40,
  },
  checkboxContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 15,
    marginBottom: 5,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    marginRight: 10,
    justifyContent: 'center',
    alignItems: 'center',
    // borderColor and backgroundColor will be set dynamically
  },
  checkboxChecked: {
    // Styles applied dynamically
  },
  checkboxLabel: {
    fontSize: 14,
    // color will be set dynamically
  },
  continueButton: {
    borderRadius: 10,
    paddingVertical: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 15,
    marginHorizontal: 20,
    marginBottom: 20,
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
    // backgroundColor and shadowColor will be set dynamically
  },
  continueButtonText: {
    fontSize: 16,
    fontWeight: '600',
    // color will be set dynamically
  },
  continueButtonDisabled: {
    shadowOpacity: 0,
    elevation: 0,
    // backgroundColor will be set dynamically
  },
});

export default PlayerPreferencesOverlay;
