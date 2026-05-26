/**
 * Match Expectation Step
 *
 * Choose between Friendly (casual) or Competitive match.
 */

import React, { useState, useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text, Button } from '@rallia/shared-components';
import { primary } from '@rallia/design-system';

import { useThemeStyles, useTranslation, type TranslationKey } from '#/hooks';

import { useAddScore } from './AddScoreContext';
import type { MatchExpectation } from './types';

interface MatchExpectationStepProps {
  onContinue: () => void;
}

export function MatchExpectationStep({ onContinue }: MatchExpectationStepProps) {
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const { formData, updateFormData } = useAddScore();

  const [expectation, setExpectation] = useState<MatchExpectation>(
    formData.expectation || 'competitive'
  );

  const options: {
    value: MatchExpectation;
    label: string;
    description: string;
    icon: string;
  }[] = [
    {
      value: 'friendly',
      label: t('addScore.matchExpectation.friendly'),
      description: t('addScore.matchExpectation.friendlyDescription'),
      icon: 'happy',
    },
    {
      value: 'competitive',
      label: t('addScore.matchExpectation.competitive'),
      description: t('addScore.matchExpectation.competitiveDescription'),
      icon: 'trophy',
    },
  ];

  const handleContinue = useCallback(() => {
    updateFormData({ expectation });
    onContinue();
  }, [expectation, updateFormData, onContinue]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Title */}
      <Text weight="bold" size="xl" style={[styles.title, { color: colors.text }]}>
        {t('addScore.matchExpectation.title')}
      </Text>
      <Text size="sm" style={[styles.subtitle, { color: colors.textSecondary }]}>
        {t('addScore.matchExpectation.subtitle')}
      </Text>

      {/* Options */}
      <View style={styles.options}>
        {options.map(option => {
          const isSelected = expectation === option.value;
          return (
            <TouchableOpacity
              key={option.value}
              style={[
                styles.optionButton,
                {
                  backgroundColor: isSelected
                    ? isDark
                      ? primary[900]
                      : primary[50]
                    : colors.cardBackground,
                  borderColor: isSelected ? colors.primary : colors.border,
                },
              ]}
              onPress={() => setExpectation(option.value)}
              activeOpacity={0.7}
            >
              <View
                style={[
                  styles.iconContainer,
                  { backgroundColor: isSelected ? colors.primary : isDark ? '#2C2C2E' : '#F0F0F0' },
                ]}
              >
                <Ionicons
                  name={option.icon as keyof typeof Ionicons.glyphMap}
                  size={28}
                  color={isSelected ? '#FFFFFF' : colors.textMuted}
                />
              </View>
              <View style={styles.optionText}>
                <Text
                  weight="semibold"
                  size="base"
                  style={{ color: isSelected ? colors.text : colors.text }}
                >
                  {option.label}
                </Text>
                <Text size="sm" style={{ color: colors.textSecondary, marginTop: 2 }}>
                  {option.description}
                </Text>
              </View>
              {isSelected && (
                <View style={[styles.checkmark, { backgroundColor: colors.primary }]}>
                  <Ionicons name="checkmark-outline" size={16} color="#FFFFFF" />
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Continue button */}
      <View style={styles.bottomButton}>
        <Button variant="primary" onPress={handleContinue}>
          {t('addScore.matchExpectation.continue')}
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
  options: {
    gap: 16,
  },
  optionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    borderRadius: 16,
    borderWidth: 2,
    position: 'relative',
  },
  iconContainer: {
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
  },
  optionText: {
    marginLeft: 16,
    flex: 1,
  },
  checkmark: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bottomButton: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingVertical: 16,
  },
});
