/**
 * SportsStep Component
 *
 * Recovery step shown only when the wizard cannot resolve any sport for the
 * player (pre-onboarding rows missing). Presentational: the selection lives in
 * formData and OnboardingWizard persists the player_sport rows on Next.
 */

import React, { useEffect, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { ScrollView as SheetScrollView } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text, Spinner } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, base } from '@rallia/design-system';
import DatabaseService, { Logger } from '@rallia/shared-services';
import { selectionHaptic } from '@rallia/shared-utils';
import type { TranslationKey } from '@rallia/shared-translations';

import type { OnboardingFormData } from '#/features/onboarding/hooks/useOnboardingWizard';

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

interface SportsStepProps {
  formData: OnboardingFormData;
  onUpdateFormData: (updates: Partial<OnboardingFormData>) => void;
  colors: ThemeColors;
  t: (key: TranslationKey) => string;
  isDark: boolean;
}

interface SportOption {
  id: string;
  name: string;
  display_name: string;
}

// Synthetic ids are resolved to real uuids by the service layer (resolveSportId).
const FALLBACK_SPORTS: SportOption[] = [
  { id: 'tennis-fallback', name: 'tennis', display_name: 'Tennis' },
  { id: 'pickleball-fallback', name: 'pickleball', display_name: 'Pickleball' },
];

const getSportImage = (sportName: string) =>
  sportName.toLowerCase().includes('pickleball')
    ? require('../../../../../../assets/images/pickleball.webp')
    : require('../../../../../../assets/images/tennis.webp');

export const SportsStep: React.FC<SportsStepProps> = ({
  formData,
  onUpdateFormData,
  colors,
  t,
  isDark,
}) => {
  const [sports, setSports] = useState<SportOption[]>([]);
  const [isLoadingSports, setIsLoadingSports] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetchSports = async () => {
      const { data, error } = await DatabaseService.Sport.getAllSports();
      if (cancelled) return;
      if (error || !data) {
        Logger.error('Failed to fetch sports for onboarding sport step', error as Error);
        setSports(FALLBACK_SPORTS);
      } else {
        const active = data
          .filter(sport => sport.is_active)
          .map(sport => ({ id: sport.id, name: sport.name, display_name: sport.display_name }));
        setSports(active.length > 0 ? active : FALLBACK_SPORTS);
      }
      setIsLoadingSports(false);
    };
    fetchSports();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleSport = (sport: SportOption) => {
    selectionHaptic();
    const isSelected = formData.selectedSportIds.includes(sport.id);
    if (isSelected) {
      onUpdateFormData({
        selectedSportIds: formData.selectedSportIds.filter(id => id !== sport.id),
        selectedSportNames: formData.selectedSportNames.filter(name => name !== sport.name),
      });
    } else {
      onUpdateFormData({
        selectedSportIds: [...formData.selectedSportIds, sport.id],
        selectedSportNames: [...formData.selectedSportNames, sport.name],
      });
    }
  };

  return (
    <SheetScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
    >
      <Text size="xl" weight="bold" color={colors.text} style={styles.title}>
        {t('onboarding.sportSelectionStep.title')}
      </Text>
      <Text size="sm" color={colors.textSecondary} style={styles.subtitle}>
        {t('onboarding.sportSelectionStep.subtitle')}
      </Text>

      {isLoadingSports ? (
        <View style={styles.loadingContainer}>
          <Spinner size="lg" />
          <Text size="sm" color={colors.textMuted} style={styles.loadingText}>
            {t('common.loading')}
          </Text>
        </View>
      ) : (
        <View style={styles.cardsContainer}>
          {sports.map(sport => {
            const isSelected = formData.selectedSportIds.includes(sport.id);
            const SportGlyph =
              sport.name.toLowerCase() === 'pickleball' ? PickleballIcon : TennisIcon;
            return (
              <TouchableOpacity
                key={sport.id}
                style={[
                  styles.sportCard,
                  { borderColor: isSelected ? colors.buttonActive : 'transparent' },
                ]}
                onPress={() => toggleSport(sport)}
                activeOpacity={0.85}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: isSelected }}
                accessibilityLabel={sport.display_name}
              >
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
                <View style={styles.sportNameContainer}>
                  <View style={styles.sportNameRow}>
                    <SportGlyph
                      width={24}
                      height={24}
                      fill={base.white}
                      style={styles.sportNameIcon}
                    />
                    <Text size="xl" weight="bold" color={base.white}>
                      {sport.display_name}
                    </Text>
                  </View>
                  <Ionicons
                    name={isSelected ? 'checkmark-circle' : 'add-circle-outline'}
                    size={28}
                    color={base.white}
                  />
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
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
    lineHeight: 20,
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
  cardsContainer: {
    gap: spacingPixels[4],
  },
  sportCard: {
    height: 180,
    borderRadius: radiusPixels.xl,
    borderWidth: 3,
    overflow: 'hidden',
  },
  sportImage: {
    width: '100%',
    height: '100%',
  },
  sportImageOverlay: {
    ...StyleSheet.absoluteFillObject,
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

export default SportsStep;
