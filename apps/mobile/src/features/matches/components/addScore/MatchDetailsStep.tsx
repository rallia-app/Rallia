/**
 * Match Details Step
 *
 * Select date played, location (optional), and sport (Tennis/Pickleball).
 */

import React, { useState, useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity, TextInput, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text, Button } from '@rallia/shared-components';
import { SportIcon } from '../../../../components/SportIcon';
import { useThemeStyles, useTranslation, type TranslationKey } from '../../../../hooks';
import { primary } from '@rallia/design-system';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useAddScore } from './AddScoreContext';
import type { Sport } from './types';

interface MatchDetailsStepProps {
  onContinue: () => void;
}

export function MatchDetailsStep({ onContinue }: MatchDetailsStepProps) {
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const { formData, updateFormData } = useAddScore();

  const [matchDate, setMatchDate] = useState<Date>(formData.matchDate || new Date());
  const [location, setLocation] = useState(formData.location || '');
  const [sport, setSport] = useState<Sport>(formData.sport || 'tennis');
  const [showDatePicker, setShowDatePicker] = useState(false);

  const sports: { value: Sport; label: string }[] = [
    { value: 'tennis', label: 'Tennis' },
    { value: 'pickleball', label: 'Pickleball' },
  ];

  const handleDateChange = useCallback((_event: unknown, selectedDate?: Date) => {
    setShowDatePicker(Platform.OS === 'ios');
    if (selectedDate) {
      setMatchDate(selectedDate);
    }
  }, []);

  const handleContinue = useCallback(() => {
    updateFormData({
      matchDate,
      location: location.trim() || undefined,
      sport,
    });
    onContinue();
  }, [matchDate, location, sport, updateFormData, onContinue]);

  const formatDate = (date: Date) => {
    return date.toLocaleDateString(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Title */}
      <Text weight="bold" size="xl" style={[styles.title, { color: colors.text }]}>
        {t('addScore.matchDetails.title')}
      </Text>
      <Text size="sm" style={[styles.subtitle, { color: colors.textSecondary }]}>
        {t('addScore.matchDetails.whenAndWhere')}
      </Text>

      {/* Date picker */}
      <View style={styles.section}>
        <Text weight="semibold" style={[styles.sectionLabel, { color: colors.text }]}>
          {t('addScore.matchDetails.datePlayed')}
        </Text>
        <TouchableOpacity
          style={[
            styles.dateButton,
            { backgroundColor: colors.cardBackground, borderColor: colors.border },
          ]}
          onPress={() => setShowDatePicker(true)}
        >
          <Ionicons name="calendar" size={20} color={colors.primary} />
          <Text style={{ color: colors.text, marginLeft: 12, flex: 1 }}>
            {formatDate(matchDate)}
          </Text>
          <Ionicons name="chevron-down" size={20} color={colors.textMuted} />
        </TouchableOpacity>

        {showDatePicker && (
          <DateTimePicker
            value={matchDate}
            mode="date"
            display="spinner"
            onChange={handleDateChange}
            maximumDate={new Date()}
            themeVariant={isDark ? 'dark' : 'light'}
          />
        )}
      </View>

      {/* Location (optional) */}
      <View style={styles.section}>
        <Text weight="semibold" style={[styles.sectionLabel, { color: colors.text }]}>
          {t('addScore.matchDetails.location')}
          <Text size="sm" style={{ color: colors.textMuted }}>
            {' '}
            {t('addScore.matchDetails.locationOptional')}
          </Text>
        </Text>
        <View
          style={[
            styles.inputContainer,
            { backgroundColor: colors.cardBackground, borderColor: colors.border },
          ]}
        >
          <Ionicons name="location" size={20} color={colors.textMuted} />
          <TextInput
            style={[styles.input, { color: colors.text }]}
            placeholder={t('addScore.matchDetails.enterLocation')}
            placeholderTextColor={colors.textMuted}
            value={location}
            onChangeText={setLocation}
          />
        </View>
      </View>

      {/* Sport selection */}
      <View style={styles.section}>
        <Text weight="semibold" style={[styles.sectionLabel, { color: colors.text }]}>
          {t('addScore.matchDetails.sport')}
        </Text>
        <View style={styles.sportOptions}>
          {sports.map(sportOption => {
            const isSelected = sport === sportOption.value;
            return (
              <TouchableOpacity
                key={sportOption.value}
                style={[
                  styles.sportButton,
                  {
                    backgroundColor: isSelected
                      ? isDark
                        ? primary[900]
                        : primary[50]
                      : colors.cardBackground,
                    borderColor: isSelected ? colors.primary : colors.border,
                  },
                ]}
                onPress={() => setSport(sportOption.value)}
                activeOpacity={0.7}
              >
                <View
                  style={[
                    styles.sportIcon,
                    {
                      backgroundColor: isSelected ? colors.primary : isDark ? '#2C2C2E' : '#F0F0F0',
                    },
                  ]}
                >
                  <SportIcon
                    sportName={sportOption.value}
                    size={20}
                    color={isSelected ? '#FFFFFF' : colors.textMuted}
                  />
                </View>
                <Text
                  weight={isSelected ? 'semibold' : 'regular'}
                  style={{ color: isSelected ? colors.primary : colors.text, marginTop: 8 }}
                >
                  {sportOption.label}
                </Text>
                {isSelected && (
                  <View style={[styles.checkmark, { backgroundColor: colors.primary }]}>
                    <Ionicons name="checkmark-outline" size={12} color="#FFFFFF" />
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Continue button */}
      <View style={styles.bottomButton}>
        <Button variant="primary" onPress={handleContinue}>
          Continue
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 20,
  },
  title: {
    marginBottom: 8,
  },
  subtitle: {
    marginBottom: 32,
  },
  section: {
    marginBottom: 24,
  },
  sectionLabel: {
    marginBottom: 12,
  },
  dateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  input: {
    flex: 1,
    marginLeft: 12,
    fontSize: 16,
  },
  sportOptions: {
    flexDirection: 'row',
    gap: 16,
  },
  sportButton: {
    flex: 1,
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    borderWidth: 2,
    position: 'relative',
  },
  sportIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkmark: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bottomButton: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingTop: 16,
    paddingBottom: 24,
  },
});
