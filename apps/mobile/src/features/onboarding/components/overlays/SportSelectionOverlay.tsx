import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Image,
  ScrollView,
  Animated,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Overlay, Text, Heading, Button, Spinner } from '@rallia/shared-components';
import { Sport } from '@rallia/shared-types';
import DatabaseService, { Logger, makeFallbackSportId } from '@rallia/shared-services';
import { selectionHaptic, mediumHaptic } from '@rallia/shared-utils';

import ProgressIndicator from '#/features/onboarding/components/ProgressIndicator';
import { useThemeStyles, useTranslation } from '#/hooks';
import { SportIcon } from '#/components/SportIcon';

interface SportSelectionOverlayProps {
  visible: boolean;
  onClose: () => void;
  onBack?: () => void;
  onContinue?: (selectedSportNames: string[], selectedSportIds: string[]) => void;
  currentStep?: number;
  totalSteps?: number;
}

const SportSelectionOverlay: React.FC<SportSelectionOverlayProps> = ({
  visible,
  onClose,
  onBack,
  onContinue,
  currentStep = 1,
  totalSteps = 8,
}) => {
  const { colors } = useThemeStyles();
  const { t } = useTranslation();
  const [selectedSportIds, setSelectedSportIds] = useState<string[]>([]); // Store IDs for database operations
  const [sports, setSports] = useState<Sport[]>([]);
  const [isLoadingSports, setIsLoadingSports] = useState(true);
  const [playerId, setPlayerId] = useState<string | null>(null);

  // Animation values
  const fadeAnim = useMemo(() => new Animated.Value(0), []);
  const slideAnim = useMemo(() => new Animated.Value(50), []);

  // Fetch player ID when overlay becomes visible
  useEffect(() => {
    const fetchPlayerId = async () => {
      try {
        const userId = await DatabaseService.Auth.getCurrentUserId();
        if (userId) {
          setPlayerId(userId);
        }
      } catch (error) {
        Logger.error('Failed to fetch player ID', error as Error);
      }
    };

    if (visible) {
      fetchPlayerId();
    }
  }, [visible]);

  // Fetch active sports from database
  useEffect(() => {
    const fetchSports = async () => {
      setIsLoadingSports(true);
      const { data, error } = await DatabaseService.Sport.getAllSports();

      if (error) {
        Logger.error('Failed to fetch sports', error as Error);
        Alert.alert(t('common.error'), t('onboarding.validation.failedToLoadSports'));
        // Fallback to hardcoded sports if fetch fails
        setSports([
          {
            id: makeFallbackSportId('tennis'),
            name: 'tennis',
            display_name: 'Tennis',
            description: null,
            icon_url: null,
            slug: 'tennis',
            attributes: null,
            is_active: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          {
            id: makeFallbackSportId('pickleball'),
            name: 'pickleball',
            display_name: 'Pickleball',
            description: null,
            icon_url: null,
            slug: 'pickleball',
            attributes: null,
            is_active: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ]);
      } else if (data) {
        // Filter to only active sports
        const activeSports = data.filter((sport: Sport) => sport.is_active);
        setSports(activeSports);
      }

      setIsLoadingSports(false);
    };

    if (visible) {
      fetchSports();
    }
  }, [visible, t]);

  // Load already selected sports from database
  useEffect(() => {
    const loadSelectedSportIds = async () => {
      if (!playerId || !visible) return;

      const { data, error } = await DatabaseService.PlayerSport.getPlayerSports(playerId);
      if (data && !error) {
        const sportIds = data.map((ps: { sport_id: string }) => ps.sport_id);
        setSelectedSportIds(sportIds);
      }
    };

    if (playerId && visible) {
      loadSelectedSportIds();
    }
  }, [playerId, visible]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const toggleSport = async (sportId: string) => {
    selectionHaptic();

    if (!playerId) {
      Alert.alert(t('common.error'), t('onboarding.validation.playerNotFound'));
      return;
    }

    const isCurrentlySelected = selectedSportIds.includes(sportId);
    const newSelectionState = !isCurrentlySelected;

    // Optimistically update UI
    setSelectedSportIds((prev: string[]) => {
      if (isCurrentlySelected) {
        return prev.filter((id: string) => id !== sportId);
      } else {
        return [...prev, sportId];
      }
    });

    // Persist to database immediately
    const { error } = await DatabaseService.PlayerSport.togglePlayerSport(
      playerId,
      sportId,
      newSelectionState
    );

    if (error) {
      Logger.error('Failed to toggle sport selection', error as Error, {
        sportId,
        newSelectionState,
      });
      // Revert optimistic update on error
      setSelectedSportIds((prev: string[]) => {
        if (newSelectionState) {
          return prev.filter((id: string) => id !== sportId);
        } else {
          return [...prev, sportId];
        }
      });
      Alert.alert(t('common.error'), t('onboarding.validation.failedToUpdateSportSelection'));
    }
  };

  const handleContinue = () => {
    mediumHaptic();

    // Get sport names from IDs for useOnboardingFlow
    const selectedSportNames = selectedSportIds
      .map(id => sports.find(s => s.id === id)?.name)
      .filter(name => name !== undefined);

    Logger.debug('sport_selection_continue', {
      sportIds: selectedSportIds,
      sportNames: selectedSportNames,
      count: selectedSportIds.length,
    });

    if (onContinue) {
      // Pass both names (for flow control) and IDs (for database operations)
      onContinue(selectedSportNames, selectedSportIds);
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
      <Animated.View
        style={[
          styles.container,
          {
            opacity: fadeAnim,
            transform: [{ translateY: slideAnim }],
          },
        ]}
      >
        {/* Progress Indicator */}
        <ProgressIndicator currentStep={currentStep} totalSteps={totalSteps} />

        {/* Title */}
        <Heading level={2} style={styles.title}>
          Which sports would you like to play?
        </Heading>
        <Text variant="caption" color={colors.textMuted} style={styles.subtitle}>
          Select all that apply
        </Text>

        {/* Sports Grid */}
        <ScrollView style={styles.sportsContainer} showsVerticalScrollIndicator={false}>
          {isLoadingSports ? (
            <View style={styles.loadingContainer}>
              <Spinner size="lg" />
              <Text size="sm" color={colors.textMuted} style={styles.loadingText}>
                Loading sports...
              </Text>
            </View>
          ) : (
            sports.map(sport => {
              const isSelected = selectedSportIds.includes(sport.id);

              // Map sport name to local images
              const getSportImage = (sportName: string) => {
                const lowerName = sportName.toLowerCase();
                if (lowerName.includes('tennis')) {
                  return require('../../../../../assets/images/tennis.webp');
                } else if (lowerName.includes('pickleball')) {
                  return require('../../../../../assets/images/pickleball.webp');
                }
                // Default fallback - could add more sports here
                return require('../../../../../assets/images/tennis.webp');
              };

              return (
                <TouchableOpacity
                  key={sport.id}
                  style={[
                    styles.sportCard,
                    { borderColor: isSelected ? colors.primary : 'transparent' },
                  ]}
                  onPress={() => toggleSport(sport.id)}
                  activeOpacity={0.8}
                >
                  {/* Sport Image */}
                  <View style={styles.sportImageContainer}>
                    <Image
                      source={getSportImage(sport.name)}
                      style={styles.sportImage}
                      resizeMode="cover"
                    />
                    {/* Overlay for darkening effect */}
                    <View style={styles.sportImageOverlay} />
                  </View>

                  {/* Sport icon + name */}
                  <View style={styles.sportNameContainer}>
                    <View style={styles.sportNameRow}>
                      <SportIcon
                        sportName={sport.name}
                        size={28}
                        color={colors.primaryForeground}
                        style={styles.sportCardIcon}
                      />
                      <Text size="xl" weight="bold" color={colors.primaryForeground}>
                        {sport.display_name}
                      </Text>
                    </View>
                    {isSelected && (
                      <Ionicons
                        name="checkmark-outline"
                        size={24}
                        color={colors.primaryForeground}
                      />
                    )}
                  </View>
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>

        {/* Continue Button */}
        <Button
          variant="primary"
          onPress={handleContinue}
          disabled={selectedSportIds.length === 0}
          style={styles.continueButton}
        >
          Continue
        </Button>
      </Animated.View>
    </Overlay>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: 20,
  },
  title: {
    textAlign: 'center',
    marginBottom: 10,
  },
  subtitle: {
    textAlign: 'center',
    marginBottom: 25,
  },
  sportsContainer: {
    maxHeight: 400,
    marginBottom: 20,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  loadingText: {
    marginTop: 12,
  },
  sportCard: {
    height: 180,
    borderRadius: 12,
    marginBottom: 15,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 3,
    // borderColor will be set dynamically
  },
  sportCardSelected: {
    // borderColor will be set dynamically
  },
  sportImageContainer: {
    width: '100%',
    height: '100%',
    position: 'relative',
  },
  sportImage: {
    width: '100%',
    height: '100%',
  },
  sportImageOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  sportNameContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 15,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sportNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sportCardIcon: {
    marginRight: 2,
  },
  continueButton: {
    marginTop: 10,
    // backgroundColor handled by Button component
  },
});

export default SportSelectionOverlay;
