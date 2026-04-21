/**
 * SportSelectionStep Component
 *
 * Second step of onboarding - sport selection.
 * Migrated from SportSelectionOverlay with theme-aware colors.
 */

import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, TouchableOpacity, Image, Alert } from 'react-native';
import { ScrollView as SheetScrollView } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text, Spinner } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';

const BASE_WHITE = '#ffffff';
import DatabaseService, { Logger } from '@rallia/shared-services';
import { selectionHaptic } from '@rallia/shared-utils';
import type { Sport } from '@rallia/shared-types';
import type { TranslationKey } from '@rallia/shared-translations';
import type { OnboardingFormData } from '../../../hooks/useOnboardingWizard';
import { useSport } from '../../../../../context/SportContext';
import TennisIcon from '../../../../../../assets/icons/tennis.svg';
import PickleballIcon from '../../../../../../assets/icons/pickleball.svg';

interface ThemeColors {
  background: string;
  cardBackground: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  buttonActive: string;
  buttonInactive: string;
  buttonTextActive: string;
}

interface SportSelectionStepProps {
  formData: OnboardingFormData;
  onUpdateFormData: (updates: Partial<OnboardingFormData>) => void;
  colors: ThemeColors;
  t: (key: TranslationKey) => string;
  isDark: boolean;
}

export const SportSelectionStep: React.FC<SportSelectionStepProps> = ({
  formData,
  onUpdateFormData,
  colors,
  t,
  isDark,
}) => {
  const [sports, setSports] = useState<Sport[]>([]);
  const [isLoadingSports, setIsLoadingSports] = useState(true);
  const [playerId, setPlayerId] = useState<string | null>(null);

  // Get guest-selected sports from context (selected in SportSelectionScreen)
  const { userSports: contextSports } = useSport();
  const hasPrePopulatedFromContext = useRef(false);

  // Fetch player ID
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

    fetchPlayerId();
  }, []);

  // Fetch active sports from database
  useEffect(() => {
    const fetchSports = async () => {
      setIsLoadingSports(true);
      const { data, error } = await DatabaseService.Sport.getAllSports();

      if (error) {
        Logger.error('Failed to fetch sports', error as Error);
        Alert.alert(t('alerts.error'), t('onboarding.validation.failedToLoadSports'));
        setSports([
          {
            id: 'tennis-fallback',
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
            id: 'pickleball-fallback',
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
        const activeSports = data.filter((sport: Sport) => sport.is_active);
        setSports(activeSports);
      }

      setIsLoadingSports(false);
    };

    fetchSports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pre-populate from guest sports context (selected in SportSelectionScreen)
  // This runs before/instead of database lookup for guest users
  useEffect(() => {
    if (
      !hasPrePopulatedFromContext.current &&
      sports.length > 0 &&
      contextSports.length > 0 &&
      formData.selectedSportIds.length === 0
    ) {
      hasPrePopulatedFromContext.current = true;

      // Map context sports to available sports by ID
      const preSelectedIds: string[] = [];
      const preSelectedNames: string[] = [];

      contextSports.forEach(contextSport => {
        const matchingSport = sports.find(s => s.id === contextSport.id);
        if (matchingSport) {
          preSelectedIds.push(matchingSport.id);
          preSelectedNames.push(matchingSport.name);
        }
      });

      if (preSelectedIds.length > 0) {
        onUpdateFormData({
          selectedSportIds: preSelectedIds,
          selectedSportNames: preSelectedNames,
        });
      }
    }
  }, [sports, contextSports, formData.selectedSportIds.length, onUpdateFormData]);

  // Load already selected sports from database (for authenticated users)
  useEffect(() => {
    const loadSelectedSportIds = async () => {
      if (!playerId) return;

      // Skip if already pre-populated from context
      if (hasPrePopulatedFromContext.current) return;

      const { data, error } = await DatabaseService.PlayerSport.getPlayerSports(playerId);
      if (data && !error) {
        const sportIds = data.map((ps: { sport_id: string }) => ps.sport_id);
        const sportNames = sportIds
          .map(id => sports.find(s => s.id === id)?.name)
          .filter((name): name is string => name !== undefined);

        onUpdateFormData({
          selectedSportIds: sportIds,
          selectedSportNames: sportNames,
        });
      }
    };

    if (playerId && sports.length > 0) {
      loadSelectedSportIds();
    }
  }, [playerId, sports, onUpdateFormData]);

  const toggleSport = async (sportId: string) => {
    selectionHaptic();

    if (!playerId) {
      Alert.alert(t('alerts.error'), t('onboarding.validation.playerNotFound'));
      return;
    }

    const sport = sports.find(s => s.id === sportId);
    if (!sport) return;

    const isCurrentlySelected = formData.selectedSportIds.includes(sportId);
    const newSelectionState = !isCurrentlySelected;

    // Optimistically update UI
    if (isCurrentlySelected) {
      onUpdateFormData({
        selectedSportIds: formData.selectedSportIds.filter(id => id !== sportId),
        selectedSportNames: formData.selectedSportNames.filter(name => name !== sport.name),
      });
    } else {
      onUpdateFormData({
        selectedSportIds: [...formData.selectedSportIds, sportId],
        selectedSportNames: [...formData.selectedSportNames, sport.name],
      });
    }

    // Persist to database
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
      if (newSelectionState) {
        onUpdateFormData({
          selectedSportIds: formData.selectedSportIds.filter(id => id !== sportId),
          selectedSportNames: formData.selectedSportNames.filter(name => name !== sport.name),
        });
      } else {
        onUpdateFormData({
          selectedSportIds: [...formData.selectedSportIds, sportId],
          selectedSportNames: [...formData.selectedSportNames, sport.name],
        });
      }
      Alert.alert(t('alerts.error'), t('onboarding.validation.failedToUpdateSportSelection'));
    }
  };

  const getSportImage = (sportName: string) => {
    const lowerName = sportName.toLowerCase();
    if (lowerName.includes('tennis')) {
      return require('../../../../../../assets/images/tennis.jpg');
    } else if (lowerName.includes('pickleball')) {
      return require('../../../../../../assets/images/pickleball.jpg');
    }
    return require('../../../../../../assets/images/tennis.jpg');
  };

  return (
    <SheetScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
    >
      {/* Title */}
      <Text size="xl" weight="bold" color={colors.text} style={styles.title}>
        {t('onboarding.sportSelectionStep.title')}
      </Text>
      <Text size="base" color={colors.textSecondary} style={styles.subtitle}>
        {t('onboarding.sportSelectionStep.subtitle')}
      </Text>

      {/* Sports Grid */}
      {isLoadingSports ? (
        <View style={styles.loadingContainer}>
          <Spinner size="lg" />
          <Text size="sm" color={colors.textMuted} style={styles.loadingText}>
            {t('common.loading')}
          </Text>
        </View>
      ) : (
        sports.map((sport, index) => {
          const isSelected = formData.selectedSportIds.includes(sport.id);
          const isLastCard = index === sports.length - 1;

          return (
            <TouchableOpacity
              key={sport.id}
              style={[
                styles.sportCard,
                isSelected
                  ? { borderWidth: 3, borderColor: colors.buttonActive }
                  : styles.sportCardUnselected,
                isLastCard && styles.lastSportCard,
              ]}
              onPress={() => toggleSport(sport.id)}
              activeOpacity={0.8}
            >
              <View style={styles.sportImageContainer}>
                <Image
                  source={getSportImage(sport.name)}
                  style={styles.sportImage}
                  resizeMode="cover"
                />
                <View
                  style={[
                    styles.sportImageOverlay,
                    { backgroundColor: isDark ? 'rgba(0, 0, 0, 0.5)' : 'rgba(0, 0, 0, 0.4)' },
                  ]}
                />
              </View>

              <View style={styles.sportNameContainer}>
                <View style={styles.sportNameRow}>
                  {sport.name.toLowerCase() === 'pickleball' ? (
                    <PickleballIcon
                      width={24}
                      height={24}
                      fill={BASE_WHITE}
                      style={styles.sportNameIcon}
                    />
                  ) : (
                    <TennisIcon
                      width={24}
                      height={24}
                      fill={BASE_WHITE}
                      style={styles.sportNameIcon}
                    />
                  )}
                  <Text size="xl" weight="bold" color={BASE_WHITE}>
                    {sport.display_name}
                  </Text>
                </View>
                {isSelected && <Ionicons name="checkmark-outline" size={24} color={BASE_WHITE} />}
              </View>
            </TouchableOpacity>
          );
        })
      )}
    </SheetScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    padding: spacingPixels[4],
    paddingBottom: spacingPixels[8],
    flexGrow: 1,
  },
  title: {
    textAlign: 'center',
    marginBottom: spacingPixels[2],
  },
  subtitle: {
    textAlign: 'center',
    marginBottom: spacingPixels[6],
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacingPixels[16],
  },
  loadingText: {
    marginTop: spacingPixels[3],
  },
  sportCard: {
    height: 180,
    borderRadius: radiusPixels.xl,
    marginBottom: spacingPixels[4],
    overflow: 'hidden',
    position: 'relative',
  },
  sportCardUnselected: {
    borderWidth: 0,
  },
  lastSportCard: {
    marginBottom: 0,
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
  },
  sportNameContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: spacingPixels[4],
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sportNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sportNameIcon: {
    marginRight: spacingPixels[2],
  },
});

export default SportSelectionStep;
