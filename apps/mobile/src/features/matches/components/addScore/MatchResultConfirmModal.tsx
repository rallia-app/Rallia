/**
 * MatchResultConfirmModal Component
 *
 * A custom confirmation modal for the Add Score flow that displays
 * the match result summary in a visually appealing format.
 */

import React, { useCallback } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TouchableWithoutFeedback,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import {
  lightTheme,
  darkTheme,
  spacingPixels,
  radiusPixels,
  neutral,
  primary,
} from '@rallia/design-system';
import { lightHaptic, mediumHaptic } from '@rallia/shared-utils';
import { useTheme } from '@rallia/shared-hooks';

const BASE_WHITE = '#ffffff';

// =============================================================================
// TYPES
// =============================================================================

export interface SetScoreDisplay {
  team1Score: number | null;
  team2Score: number | null;
}

export interface MatchResultConfirmModalProps {
  /** Whether the modal is visible */
  visible: boolean;
  /** Callback when the modal is dismissed */
  onClose: () => void;
  /** Callback when confirm button is pressed */
  onConfirm: () => void;
  /** Winner team name */
  winnerName: string;
  /** Loser team name */
  loserName: string;
  /** Match date display string */
  matchDate: string;
  /** Set scores to display */
  sets: SetScoreDisplay[];
  /** Whether this is a friendly match (no scores) */
  isFriendly?: boolean;
  /** Winner team identifier to properly order scores */
  winnerId: 'team1' | 'team2';
  /** Whether the confirm action is loading */
  isLoading?: boolean;
  /** Localized strings */
  labels: {
    title: string;
    editButton: string;
    submitButton: string;
    setLabel: string;
    friendlyMatch: string;
    savingLabel: string;
  };
}

// =============================================================================
// COMPONENT
// =============================================================================

export function MatchResultConfirmModal({
  visible,
  onClose,
  onConfirm,
  winnerName,
  loserName,
  matchDate,
  sets,
  isFriendly = false,
  winnerId,
  isLoading = false,
  labels,
}: MatchResultConfirmModalProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const themeColors = isDark ? darkTheme : lightTheme;

  // Theme-aware colors
  const colors = {
    backdrop: 'rgba(0, 0, 0, 0.5)',
    background: themeColors.card,
    text: themeColors.foreground,
    textMuted: themeColors.mutedForeground,
    textSecondary: isDark ? neutral[400] : neutral[500],
    border: themeColors.border,
    primary: themeColors.primary,
    primaryLight: isDark ? primary[900] : primary[50],
    winnerBg: isDark ? 'rgba(34, 197, 94, 0.15)' : 'rgba(34, 197, 94, 0.1)',
    winnerBorder: isDark ? '#22c55e' : '#16a34a',
    friendlyBg: isDark ? 'rgba(59, 130, 246, 0.15)' : 'rgba(59, 130, 246, 0.1)',
    friendlyBorder: isDark ? '#3b82f6' : '#2563eb',
    scoreBg: isDark ? neutral[800] : neutral[100],
  };

  // Handle confirm with haptic
  const handleConfirm = useCallback(() => {
    if (isLoading) return;
    mediumHaptic();
    onConfirm();
  }, [isLoading, onConfirm]);

  // Handle cancel with haptic
  const handleCancel = useCallback(() => {
    if (isLoading) return;
    lightHaptic();
    onClose();
  }, [isLoading, onClose]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleCancel}
      statusBarTranslucent
    >
      <TouchableWithoutFeedback onPress={handleCancel}>
        <View style={styles.backdrop}>
          <TouchableWithoutFeedback>
            <View style={[styles.modal, { backgroundColor: colors.background }]}>
              {/* Header with trophy icon */}
              <View style={styles.header}>
                <View style={[styles.iconContainer, { backgroundColor: colors.primaryLight }]}>
                  <Ionicons name="trophy" size={32} color="#FFD700" />
                </View>
                <Text size="lg" weight="bold" style={[styles.title, { color: colors.text }]}>
                  {labels.title}
                </Text>
              </View>

              {/* Result Card - Horizontal VS Layout */}
              <View
                style={[
                  styles.resultCard,
                  {
                    backgroundColor: isFriendly ? colors.friendlyBg : colors.winnerBg,
                    borderColor: isFriendly ? colors.friendlyBorder : colors.winnerBorder,
                  },
                ]}
              >
                {/* Teams displayed side by side */}
                <View style={styles.teamsContainer}>
                  {/* Winner/Left Team */}
                  <View style={styles.teamColumn}>
                    <Ionicons
                      name={isFriendly ? 'heart' : 'checkmark-circle'}
                      size={24}
                      color={isFriendly ? colors.friendlyBorder : colors.winnerBorder}
                      style={styles.teamIcon}
                    />
                    <Text 
                      weight="semibold" 
                      style={[styles.teamNameCentered, { color: colors.text }]}
                      numberOfLines={2}
                    >
                      {winnerName}
                    </Text>
                    {!isFriendly && (
                      <View style={[styles.winnerLabel, { backgroundColor: colors.winnerBorder }]}>
                        <Ionicons name="trophy" size={10} color={BASE_WHITE} />
                        <Text size="xs" weight="medium" style={{ color: BASE_WHITE, marginLeft: 2 }}>
                          Winner
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* VS divider */}
                  <View style={styles.vsCenterDivider}>
                    <Text size="lg" weight="bold" style={{ color: colors.textMuted }}>
                      VS
                    </Text>
                  </View>

                  {/* Loser/Right Team */}
                  <View style={styles.teamColumn}>
                    <View style={styles.teamIconPlaceholder} />
                    <Text 
                      weight="regular" 
                      style={[styles.teamNameCentered, { color: colors.textSecondary }]}
                      numberOfLines={2}
                    >
                      {loserName}
                    </Text>
                  </View>
                </View>
              </View>

              {/* Scores Section */}
              {!isFriendly && sets.length > 0 && (
                <View style={styles.scoresSection}>
                  {sets.map((set, index) => {
                    const winnerScore = winnerId === 'team1' ? set.team1Score : set.team2Score;
                    const loserScore = winnerId === 'team1' ? set.team2Score : set.team1Score;
                    return (
                      <View
                        key={index}
                        style={[styles.scoreRow, { backgroundColor: colors.scoreBg }]}
                      >
                        <Text size="sm" weight="medium" style={{ color: colors.textMuted }}>
                          {labels.setLabel.replace('{number}', String(index + 1))}
                        </Text>
                        <Text weight="bold" style={{ color: colors.text }}>
                          {winnerScore} - {loserScore}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              )}

              {/* Friendly match indicator */}
              {isFriendly && (
                <View style={[styles.friendlyBadge, { backgroundColor: colors.friendlyBg }]}>
                  <Ionicons name="heart-outline" size={16} color={colors.friendlyBorder} />
                  <Text size="sm" weight="medium" style={{ color: colors.friendlyBorder, marginLeft: 6 }}>
                    {labels.friendlyMatch}
                  </Text>
                </View>
              )}

              {/* Date */}
              <View style={styles.dateRow}>
                <Ionicons name="calendar-outline" size={16} color={colors.textMuted} />
                <Text size="sm" style={{ color: colors.textMuted, marginLeft: 6 }}>
                  {matchDate}
                </Text>
              </View>

              {/* Buttons */}
              <View style={styles.buttonContainer}>
                {/* Edit Button */}
                <TouchableOpacity
                  style={[
                    styles.button,
                    styles.editButton,
                    { borderColor: colors.border },
                    isLoading && styles.buttonDisabled,
                  ]}
                  onPress={handleCancel}
                  disabled={isLoading}
                  activeOpacity={0.7}
                >
                  <Text size="base" weight="medium" style={{ color: colors.text }}>
                    {labels.editButton}
                  </Text>
                </TouchableOpacity>

                {/* Submit Button */}
                <TouchableOpacity
                  style={[
                    styles.button,
                    styles.submitButton,
                    { backgroundColor: colors.primary },
                    isLoading && styles.buttonDisabled,
                  ]}
                  onPress={handleConfirm}
                  disabled={isLoading}
                  activeOpacity={0.7}
                >
                  {isLoading ? (
                    <ActivityIndicator size="small" color={BASE_WHITE} />
                  ) : (
                    <Text size="base" weight="medium" style={{ color: BASE_WHITE }}>
                      {labels.submitButton}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[5],
  },
  modal: {
    width: '100%',
    maxWidth: 360,
    borderRadius: radiusPixels.xl,
    paddingTop: spacingPixels[5],
    paddingHorizontal: spacingPixels[5],
    paddingBottom: spacingPixels[5],
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  header: {
    alignItems: 'center',
    marginBottom: spacingPixels[4],
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacingPixels[3],
  },
  title: {
    textAlign: 'center',
  },
  resultCard: {
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    padding: spacingPixels[4],
    marginBottom: spacingPixels[4],
  },
  teamsContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  teamColumn: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: spacingPixels[2],
  },
  teamIcon: {
    marginBottom: spacingPixels[2],
  },
  teamIconPlaceholder: {
    width: 24,
    height: 24,
    marginBottom: spacingPixels[2],
  },
  teamNameCentered: {
    textAlign: 'center',
  },
  winnerLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.sm,
    marginTop: spacingPixels[2],
  },
  vsCenterDivider: {
    paddingHorizontal: spacingPixels[2],
    justifyContent: 'center',
    alignItems: 'center',
  },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacingPixels[1],
  },
  teamName: {
    marginLeft: spacingPixels[2],
    flex: 1,
  },
  vsDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacingPixels[2],
  },
  vsLine: {
    flex: 1,
    height: 1,
    marginHorizontal: spacingPixels[3],
  },
  scoresSection: {
    marginBottom: spacingPixels[3],
    gap: spacingPixels[2],
  },
  scoreRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacingPixels[2],
    paddingHorizontal: spacingPixels[3],
    borderRadius: radiusPixels.md,
  },
  friendlyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[2],
    paddingHorizontal: spacingPixels[3],
    borderRadius: radiusPixels.md,
    marginBottom: spacingPixels[3],
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacingPixels[4],
  },
  buttonContainer: {
    flexDirection: 'row',
    gap: spacingPixels[3],
  },
  button: {
    flex: 1,
    paddingVertical: spacingPixels[3],
    borderRadius: radiusPixels.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  editButton: {
    borderWidth: 1,
  },
  submitButton: {
    // Background color is set dynamically
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});

export default MatchResultConfirmModal;
