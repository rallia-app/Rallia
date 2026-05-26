/**
 * Create Teams Step
 *
 * Step where the user selects their partner from the 3 selected players.
 * The remaining 2 players automatically form the opposing team.
 */

import React, { useState, useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity, Image, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text, Button } from '@rallia/shared-components';
import { getProfilePictureUrl } from '@rallia/shared-utils';
import { primary } from '@rallia/design-system';

import { useThemeStyles, useTranslation, type TranslationKey } from '#/hooks';

import { useAddScore } from './AddScoreContext';
import type { SelectedPlayer } from './types';

interface CreateTeamsStepProps {
  onContinue: () => void;
}

export function CreateTeamsStep({ onContinue }: CreateTeamsStepProps) {
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const { formData, updateFormData } = useAddScore();
  const opponents = formData.opponents || [];

  const [selectedPartner, setSelectedPartner] = useState<SelectedPlayer | null>(
    formData.partner || null
  );

  const handleSelectPartner = useCallback(
    (player: SelectedPlayer) => {
      if (selectedPartner?.id === player.id) {
        setSelectedPartner(null);
      } else {
        setSelectedPartner(player);
      }
    },
    [selectedPartner]
  );

  const handleContinue = useCallback(() => {
    if (selectedPartner) {
      updateFormData({ partner: selectedPartner });
      onContinue();
    }
  }, [selectedPartner, updateFormData, onContinue]);

  const isPlayerSelected = (playerId: string) => selectedPartner?.id === playerId;

  const canContinue = selectedPartner !== null;

  const renderPlayerItem = (player: SelectedPlayer) => {
    const isSelected = isPlayerSelected(player.id);
    return (
      <TouchableOpacity
        key={player.id}
        style={[
          styles.playerItem,
          {
            backgroundColor: isSelected
              ? isDark
                ? primary[900]
                : primary[50]
              : colors.cardBackground,
            borderColor: isSelected ? colors.primary : colors.border,
          },
        ]}
        onPress={() => handleSelectPartner(player)}
        activeOpacity={0.7}
      >
        <View style={[styles.playerAvatar, { backgroundColor: isDark ? '#2C2C2E' : '#E5E5EA' }]}>
          {player.profilePictureUrl ? (
            <Image
              source={{ uri: getProfilePictureUrl(player.profilePictureUrl) ?? '' }}
              style={styles.avatarImage}
            />
          ) : (
            <Text weight="bold" size="lg" style={{ color: colors.primary }}>
              {(player.firstName || 'P')[0].toUpperCase()}
            </Text>
          )}
        </View>
        <Text weight="medium" style={[styles.playerName, { color: colors.text }]}>
          {`${player.firstName} ${player.lastName || ''}`.trim()}
        </Text>
        {isSelected && (
          <View style={[styles.checkmark, { backgroundColor: colors.primary }]}>
            <Ionicons name="checkmark-outline" size={16} color="#fff" />
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
    >
      {/* Title */}
      <Text weight="bold" size="xl" style={[styles.title, { color: colors.text }]}>
        {t('addScore.createTeams.title')}
      </Text>
      <Text size="sm" style={[styles.subtitle, { color: colors.textSecondary }]}>
        {t('addScore.createTeams.pickPartner')}
      </Text>

      {/* Player list */}
      <View style={styles.playerList}>{opponents.map(renderPlayerItem)}</View>

      {/* Team preview */}
      {selectedPartner && (
        <View style={styles.teamPreview}>
          <Text weight="semibold" style={[styles.previewTitle, { color: colors.text }]}>
            {t('addScore.createTeams.teamsPreview')}
          </Text>

          {/* Your Team */}
          <View
            style={[
              styles.teamCard,
              { backgroundColor: colors.cardBackground, borderColor: colors.border },
            ]}
          >
            <Text size="sm" weight="medium" style={[styles.teamLabel, { color: colors.primary }]}>
              {t('addScore.createTeams.yourTeam')}
            </Text>
            <View style={styles.teamAvatars}>
              <View
                style={[styles.previewAvatar, { backgroundColor: isDark ? '#2C2C2E' : '#E5E5EA' }]}
              >
                <Ionicons name="person-outline" size={20} color={colors.primary} />
              </View>
              <View
                style={[
                  styles.previewAvatar,
                  styles.previewAvatarOverlap,
                  { backgroundColor: isDark ? '#2C2C2E' : '#E5E5EA' },
                ]}
              >
                {selectedPartner.profilePictureUrl ? (
                  <Image
                    source={{ uri: getProfilePictureUrl(selectedPartner.profilePictureUrl) ?? '' }}
                    style={styles.previewAvatarImage}
                  />
                ) : (
                  <Text weight="semibold" style={{ color: colors.primary }}>
                    {(selectedPartner.firstName || 'P')[0].toUpperCase()}
                  </Text>
                )}
              </View>
            </View>
            <Text size="sm" style={{ color: colors.textSecondary }}>
              {t('addScore.createTeams.youAnd', {
                name: selectedPartner.firstName,
              })}
            </Text>
          </View>

          {/* Opponent Team */}
          <View
            style={[
              styles.teamCard,
              { backgroundColor: colors.cardBackground, borderColor: colors.border },
            ]}
          >
            <Text
              size="sm"
              weight="medium"
              style={[styles.teamLabel, { color: colors.textSecondary }]}
            >
              {t('addScore.createTeams.opponents')}
            </Text>
            <View style={styles.teamAvatars}>
              {opponents
                .filter(p => p.id !== selectedPartner.id)
                .map((player, index) => (
                  <View
                    key={player.id}
                    style={[
                      styles.previewAvatar,
                      index > 0 && styles.previewAvatarOverlap,
                      { backgroundColor: isDark ? '#2C2C2E' : '#E5E5EA' },
                    ]}
                  >
                    {player.profilePictureUrl ? (
                      <Image
                        source={{ uri: getProfilePictureUrl(player.profilePictureUrl) ?? '' }}
                        style={styles.previewAvatarImage}
                      />
                    ) : (
                      <Text weight="semibold" style={{ color: colors.textMuted }}>
                        {(player.firstName || 'P')[0].toUpperCase()}
                      </Text>
                    )}
                  </View>
                ))}
            </View>
            <Text size="sm" style={{ color: colors.textSecondary }}>
              {opponents
                .filter(p => p.id !== selectedPartner.id)
                .map(p => p.firstName)
                .join(' & ')}
            </Text>
          </View>
        </View>
      )}

      {/* Continue button */}
      <View style={styles.bottomButton}>
        <Button
          variant="primary"
          onPress={handleContinue}
          disabled={!canContinue}
          style={[!canContinue && styles.disabledButton]}
        >
          Choose
        </Button>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  title: {
    marginBottom: 8,
  },
  subtitle: {
    marginBottom: 24,
  },
  playerList: {
    gap: 12,
    marginBottom: 32,
  },
  playerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    borderWidth: 2,
  },
  playerAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  playerName: {
    flex: 1,
    marginLeft: 12,
  },
  checkmark: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  teamPreview: {
    marginBottom: 24,
  },
  previewTitle: {
    marginBottom: 16,
    textAlign: 'center',
  },
  teamCard: {
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  teamLabel: {
    marginBottom: 8,
  },
  teamAvatars: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 8,
  },
  previewAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#fff',
  },
  previewAvatarOverlap: {
    marginLeft: -12,
  },
  previewAvatarImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  bottomButton: {
    marginTop: 'auto',
    paddingTop: 16,
  },
  disabledButton: {
    opacity: 0.5,
  },
});
