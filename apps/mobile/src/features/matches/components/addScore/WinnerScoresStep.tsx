/**
 * Winner Scores Step
 *
 * Select the winner and enter set scores.
 * For doubles, shows team cards with 2 overlapping profile pictures per team.
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Image,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text, Button } from '@rallia/shared-components';
import { useThemeStyles, useTranslation } from '../../../../hooks';
import { useProfile } from '@rallia/shared-hooks';
import { primary } from '@rallia/design-system';
import { useAddScore } from './AddScoreContext';
import { MatchResultConfirmModal } from './MatchResultConfirmModal';
import type { SetScore } from './types';

interface WinnerScoresStepProps {
  onSubmit: (winnerId: 'team1' | 'team2', sets: SetScore[]) => void;
  isSubmitting?: boolean;
}

export function WinnerScoresStep({ onSubmit, isSubmitting }: WinnerScoresStepProps) {
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const { formData, updateFormData } = useAddScore();
  const { profile } = useProfile();
  const partner = formData.partner;
  const isDoubles = formData.matchType === 'double';
  const isFriendly = formData.expectation === 'friendly';

  // Confirmation modal state
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingSubmit, setPendingSubmit] = useState<{
    winner: 'team1' | 'team2';
    sets: SetScore[];
  } | null>(null);

  // For doubles: Team 1 = You + Partner, Team 2 = remaining 2 opponents
  // For singles: Team 1 = You, Team 2 = Opponent
  const team2Players = useMemo(() => {
    const opponents = formData.opponents || [];
    if (isDoubles && partner) {
      return opponents.filter(p => p.id !== partner.id);
    }
    return opponents;
  }, [isDoubles, partner, formData.opponents]);

  // Team 1 = current user (and partner for doubles)
  // Team 2 = opponents
  const [winner, setWinner] = useState<'team1' | 'team2' | null>(
    formData.winnerId === 'team1' || formData.winnerId === 'team2' ? formData.winnerId : null
  );
  const [sets, setSets] = useState<SetScore[]>(
    formData.sets?.length ? formData.sets : [{ team1Score: null, team2Score: null }]
  );

  const handleAddSet = useCallback(() => {
    if (sets.length < 5) {
      setSets([...sets, { team1Score: null, team2Score: null }]);
    }
  }, [sets]);

  const handleRemoveSet = useCallback(
    (index: number) => {
      if (sets.length > 1) {
        setSets(sets.filter((_, i) => i !== index));
      }
    },
    [sets]
  );

  const handleScoreChange = useCallback(
    (setIndex: number, team: 'team1' | 'team2', value: string) => {
      const numValue = value === '' ? null : parseInt(value, 10);
      if (numValue !== null && (isNaN(numValue) || numValue < 0 || numValue > 7)) {
        return;
      }
      setSets(prev =>
        prev.map((set, i) =>
          i === setIndex
            ? { ...set, [team === 'team1' ? 'team1Score' : 'team2Score']: numValue }
            : set
        )
      );
    },
    []
  );

  const handleSubmit = useCallback(() => {
    // Validate
    if (!winner && !isFriendly) {
      Alert.alert(
        t('addScore.winnerScores.selectWinner'),
        t('addScore.winnerScores.selectWinnerMessage')
      );
      return;
    }

    if (!isFriendly) {
      // Validate at least one set has scores
      const hasValidScores = sets.some(set => set.team1Score !== null && set.team2Score !== null);
      if (!hasValidScores) {
        Alert.alert(
          t('addScore.winnerScores.enterScores'),
          t('addScore.winnerScores.enterScoresMessage')
        );
        return;
      }
    }

    const finalWinner = winner || 'team1';
    const finalSets = isFriendly
      ? []
      : sets.filter(s => s.team1Score !== null && s.team2Score !== null);

    // Store pending submit data and show confirmation modal
    setPendingSubmit({ winner: finalWinner, sets: finalSets });
    setShowConfirmModal(true);
  }, [winner, sets, isFriendly, t]);

  // Handle confirmation from the modal
  const handleConfirmSubmit = useCallback(() => {
    if (!pendingSubmit) return;

    updateFormData({
      winnerId: pendingSubmit.winner,
      sets: pendingSubmit.sets,
    });
    // Pass values directly to avoid React state async issues
    onSubmit(pendingSubmit.winner, pendingSubmit.sets);
    setShowConfirmModal(false);
  }, [pendingSubmit, updateFormData, onSubmit]);

  // Close confirmation modal
  const handleCloseConfirmModal = useCallback(() => {
    setShowConfirmModal(false);
    setPendingSubmit(null);
  }, []);

  // Get match date formatted
  const matchDateFormatted = useMemo(() => {
    return formData.matchDate
      ? formData.matchDate.toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })
      : t('addScore.winnerScores.today');
  }, [formData.matchDate, t]);

  const canSubmit = isFriendly || winner !== null;

  // Helper to render avatar with fallback
  const renderAvatar = (
    imageUrl: string | undefined | null,
    name: string,
    isPrimary: boolean,
    isOverlap: boolean = false
  ) => (
    <View
      style={[
        styles.teamAvatarCircle,
        isOverlap && styles.avatarOverlap,
        { backgroundColor: isDark ? '#2C2C2E' : '#E5E5EA' },
      ]}
    >
      {imageUrl ? (
        <Image source={{ uri: imageUrl }} style={styles.avatarImage} />
      ) : (
        <Text
          weight="bold"
          size="lg"
          style={{ color: isPrimary ? colors.primary : colors.textMuted }}
        >
          {(name || 'P')[0].toUpperCase()}
        </Text>
      )}
    </View>
  );

  // Get team 1 display name
  const getTeam1Name = () => {
    if (isDoubles && partner) {
      return `${t('addScore.winnerScores.you')}, ${partner.firstName}`;
    }
    return t('addScore.winnerScores.you');
  };

  // Get team 2 display name
  const getTeam2Name = () => {
    if (isDoubles && team2Players.length >= 2) {
      return `${team2Players[0]?.firstName}, ${team2Players[1]?.firstName}`;
    }
    return (
      team2Players[0]?.displayName ||
      team2Players[0]?.firstName ||
      t('addScore.winnerScores.opponent')
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
        {t('addScore.winnerScores.title')}
      </Text>
      <Text size="sm" style={[styles.subtitle, { color: colors.textSecondary }]}>
        {t('addScore.winnerScores.subtitle')}
      </Text>

      {/* Team selection */}
      <View style={styles.teamsContainer}>
        {/* Team 1 - You (and partner for doubles) */}
        <TouchableOpacity
          style={[
            styles.teamCard,
            {
              backgroundColor:
                winner === 'team1' ? (isDark ? primary[900] : primary[50]) : colors.cardBackground,
              borderColor: winner === 'team1' ? colors.primary : colors.border,
            },
          ]}
          onPress={() => setWinner('team1')}
          activeOpacity={0.7}
        >
          {winner === 'team1' && (
            <View style={styles.winnerBadge}>
              <Ionicons name="trophy-outline" size={16} color="#FFD700" />
            </View>
          )}

          {/* Team 1 avatars */}
          <View style={styles.teamAvatarsRow}>
            {renderAvatar(profile?.profile_picture_url, 'You', true)}
            {isDoubles &&
              partner &&
              renderAvatar(partner.profilePictureUrl, partner.firstName, true, true)}
          </View>

          <Text
            weight={winner === 'team1' ? 'semibold' : 'regular'}
            size="sm"
            style={[styles.teamName, { color: colors.text }]}
            numberOfLines={2}
          >
            {getTeam1Name()}
          </Text>
        </TouchableOpacity>

        {/* Team 2 - Opponent(s) */}
        <TouchableOpacity
          style={[
            styles.teamCard,
            {
              backgroundColor:
                winner === 'team2' ? (isDark ? primary[900] : primary[50]) : colors.cardBackground,
              borderColor: winner === 'team2' ? colors.primary : colors.border,
            },
          ]}
          onPress={() => setWinner('team2')}
          activeOpacity={0.7}
        >
          {winner === 'team2' && (
            <View style={styles.winnerBadge}>
              <Ionicons name="trophy-outline" size={16} color="#FFD700" />
            </View>
          )}

          {/* Team 2 avatars */}
          <View style={styles.teamAvatarsRow}>
            {team2Players[0] &&
              renderAvatar(team2Players[0].profilePictureUrl, team2Players[0].firstName, false)}
            {isDoubles &&
              team2Players[1] &&
              renderAvatar(
                team2Players[1].profilePictureUrl,
                team2Players[1].firstName,
                false,
                true
              )}
          </View>

          <Text
            weight={winner === 'team2' ? 'semibold' : 'regular'}
            size="sm"
            style={[styles.teamName, { color: colors.text }]}
            numberOfLines={2}
          >
            {getTeam2Name()}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Scores section - only for competitive and after winner is selected */}
      {!isFriendly && winner !== null && (
        <View style={styles.scoresSection}>
          <Text weight="semibold" style={[styles.scoresTitle, { color: colors.text }]}>
            {t('addScore.winnerScores.scores')}
          </Text>

          {sets.map((set, index) => (
            <View key={index} style={styles.setRow}>
              {/* Team 1 score */}
              <TextInput
                style={[
                  styles.scoreInput,
                  {
                    backgroundColor: winner === 'team1' ? primary[50] : colors.cardBackground,
                    borderColor: winner === 'team1' ? primary[200] : colors.border,
                    color: colors.text,
                  },
                ]}
                value={set.team1Score?.toString() || ''}
                onChangeText={value => handleScoreChange(index, 'team1', value)}
                keyboardType="number-pad"
                maxLength={1}
                placeholder="-"
                placeholderTextColor={colors.textMuted}
              />

              {/* Delete button */}
              <TouchableOpacity
                style={styles.deleteSetButton}
                onPress={() => handleRemoveSet(index)}
                disabled={sets.length === 1}
              >
                <Ionicons
                  name="trash-outline"
                  size={20}
                  color={sets.length === 1 ? colors.textMuted : colors.textSecondary}
                />
              </TouchableOpacity>

              {/* Team 2 score */}
              <TextInput
                style={[
                  styles.scoreInput,
                  {
                    backgroundColor: winner === 'team2' ? primary[50] : colors.cardBackground,
                    borderColor: winner === 'team2' ? primary[200] : colors.border,
                    color: colors.text,
                  },
                ]}
                value={set.team2Score?.toString() || ''}
                onChangeText={value => handleScoreChange(index, 'team2', value)}
                keyboardType="number-pad"
                maxLength={1}
                placeholder="-"
                placeholderTextColor={colors.textMuted}
              />
            </View>
          ))}

          {/* Add set button */}
          {sets.length < 5 && (
            <TouchableOpacity style={styles.addSetRow} onPress={handleAddSet}>
              <View style={styles.emptyScoreInput} />
              <Text style={{ color: colors.primary }}>{t('addScore.winnerScores.newSet')}</Text>
              <View style={styles.emptyScoreInput} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Submit button */}
      <View style={styles.bottomButton}>
        <Button
          variant="primary"
          onPress={handleSubmit}
          disabled={!canSubmit || isSubmitting}
          loading={isSubmitting}
        >
          {isSubmitting ? t('addScore.winnerScores.saving') : t('addScore.winnerScores.continue')}
        </Button>
      </View>

      {/* Match Result Confirmation Modal */}
      {pendingSubmit && (
        <MatchResultConfirmModal
          visible={showConfirmModal}
          onClose={handleCloseConfirmModal}
          onConfirm={handleConfirmSubmit}
          winnerName={pendingSubmit.winner === 'team1' ? getTeam1Name() : getTeam2Name()}
          loserName={pendingSubmit.winner === 'team1' ? getTeam2Name() : getTeam1Name()}
          matchDate={matchDateFormatted}
          sets={pendingSubmit.sets}
          isFriendly={isFriendly}
          winnerId={pendingSubmit.winner}
          isLoading={isSubmitting}
          labels={{
            title: t('addScore.winnerScores.confirmMatchResult'),
            editButton: t('addScore.winnerScores.edit'),
            submitButton: t('addScore.winnerScores.submit'),
            setLabel: t('addScore.winnerScores.set', { number: '{number}' }),
            friendlyMatch: t('addScore.winnerScores.friendlyMatch'),
            savingLabel: t('addScore.winnerScores.saving'),
          }}
        />
      )}
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
    marginBottom: 32,
  },
  teamsContainer: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 32,
  },
  teamCard: {
    flex: 1,
    alignItems: 'center',
    padding: 20,
    borderRadius: 16,
    borderWidth: 2,
    position: 'relative',
    minHeight: 140,
  },
  winnerBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: '#FFF8E1',
    padding: 4,
    borderRadius: 8,
  },
  teamAvatarsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  teamAvatarCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#fff',
  },
  avatarOverlap: {
    marginLeft: -12,
  },
  avatarImage: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  teamName: {
    textAlign: 'center',
    marginTop: 4,
  },
  scoresSection: {
    marginBottom: 24,
  },
  scoresTitle: {
    textAlign: 'center',
    marginBottom: 16,
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    gap: 16,
  },
  scoreInput: {
    width: 56,
    height: 56,
    borderRadius: 12,
    borderWidth: 2,
    fontSize: 24,
    fontWeight: '600',
    textAlign: 'center',
  },
  deleteSetButton: {
    padding: 8,
  },
  addSetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    marginTop: 8,
  },
  emptyScoreInput: {
    width: 56,
    height: 40,
  },
  bottomButton: {
    marginTop: 24,
  },
});
