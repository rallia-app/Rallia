/**
 * CertificationSection Component
 *
 * Displays the full certification status of a player's rating including:
 * - Color-coded badge (yellow/green/red)
 * - References count
 * - Approved proofs count
 * - Requirements progress (if not certified)
 * - Request reference button (if viewing own profile)
 */

import React, { useState } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text, Card } from '@rallia/shared-components';
import { useThemeStyles, useTranslation } from '../../../hooks';
import { spacingPixels, radiusPixels, fontSizePixels } from '@rallia/design-system';
import { CertificationBadge, type BadgeStatus } from './CertificationBadge';
import { InfoModal } from '../../../components/InfoModal';

export interface CertificationSectionProps {
  /**
   * The certification status
   */
  badgeStatus: BadgeStatus;

  /**
   * Number of references received
   */
  referencesCount: number;

  /**
   * Number of approved proofs
   */
  approvedProofsCount: number;

  /**
   * Required number of references for certification
   * @default 3
   */
  requiredReferences?: number;

  /**
   * Required number of proofs for certification
   * @default 2
   */
  requiredProofs?: number;

  /**
   * Peer evaluation average (if any evaluations exist)
   */
  peerEvaluationAverage?: number;

  /**
   * Number of peer evaluations
   */
  peerEvaluationCount?: number;

  /**
   * The rating system name (e.g., "NTRP", "DUPR")
   */
  ratingSystemName?: string;

  /**
   * Whether this is the current user's profile (show action buttons)
   */
  isOwnProfile?: boolean;

  /**
   * Callback when "Request Reference" is pressed
   */
  onRequestReference?: () => void;

  /**
   * Callback when "Manage Proofs" is pressed
   */
  onManageProofs?: () => void;

  /**
   * Whether the player can request references (meets minimum level)
   */
  canRequestReferences?: boolean;

  /**
   * Minimum level required for references
   */
  minimumLevel?: number;

  /**
   * Player's current level
   */
  currentLevel?: number;
}

/**
 * CertificationSection component for displaying full certification information
 */
export const CertificationSection: React.FC<CertificationSectionProps> = ({
  badgeStatus,
  referencesCount,
  approvedProofsCount,
  requiredReferences = 3,
  requiredProofs = 2,
  peerEvaluationAverage,
  peerEvaluationCount,
  ratingSystemName: _ratingSystemName,
  isOwnProfile = false,
  onRequestReference,
  onManageProofs,
  canRequestReferences = true,
  minimumLevel,
  currentLevel,
}) => {
  const { colors } = useThemeStyles();
  const { t } = useTranslation();
  const [showProofInfoModal, setShowProofInfoModal] = useState(false);

  const isCertified = badgeStatus === 'certified';
  const referencesProgress = Math.min(referencesCount / requiredReferences, 1);
  const proofsProgress = Math.min(approvedProofsCount / requiredProofs, 1);

  // Get status description
  const getStatusDescription = (): string => {
    switch (badgeStatus) {
      case 'certified':
        return t('profile.certification.status.certifiedDescription');
      case 'disputed':
        return t('profile.certification.status.disputedDescription');
      case 'self_declared':
      default:
        return t('profile.certification.status.selfDeclaredDescription');
    }
  };

  return (
    <Card style={styles.container} backgroundColor={colors.cardBackground}>
      {/* Header with Badge */}
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>
          {t('profile.certification.title')}
        </Text>
        <CertificationBadge status={badgeStatus} size="md" />
      </View>

      {/* Status Description */}
      <Text style={[styles.description, { color: colors.textSecondary }]}>
        {getStatusDescription()}
      </Text>

      {/* Progress Section (only show if not certified) */}
      {!isCertified && (
        <View style={styles.progressSection}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            {t('profile.certification.requirements.title')}
          </Text>

          {/* References Progress */}
          <View style={styles.progressItem}>
            <View style={styles.progressLabelRow}>
              <Ionicons
                name="people-outline"
                size={16}
                color={referencesProgress >= 1 ? colors.success : colors.textSecondary}
              />
              <Text
                style={[
                  styles.progressLabel,
                  { color: referencesProgress >= 1 ? colors.success : colors.textSecondary },
                ]}
              >
                {t('profile.certification.requirements.currentReferences', {
                  current: referencesCount,
                  required: requiredReferences,
                })}
              </Text>
              {referencesProgress >= 1 && (
                <Ionicons name="checkmark-circle" size={16} color={colors.success} />
              )}
            </View>
            <View style={[styles.progressBar, { backgroundColor: colors.border }]}>
              <View
                style={[
                  styles.progressFill,
                  {
                    backgroundColor: referencesProgress >= 1 ? colors.success : colors.primary,
                    width: `${referencesProgress * 100}%`,
                  },
                ]}
              />
            </View>
          </View>

          {/* Proofs Progress */}
          <View style={styles.progressItem}>
            <View style={styles.progressLabelRow}>
              <Ionicons
                name="document-text-outline"
                size={16}
                color={proofsProgress >= 1 ? colors.success : colors.textSecondary}
              />
              <Text
                style={[
                  styles.progressLabel,
                  { color: proofsProgress >= 1 ? colors.success : colors.textSecondary },
                ]}
              >
                {t('profile.certification.requirements.currentProofs', {
                  current: approvedProofsCount,
                  required: requiredProofs,
                })}
              </Text>
              <TouchableOpacity
                onPress={() => setShowProofInfoModal(true)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="information-circle-outline" size={16} color={colors.primary} />
              </TouchableOpacity>
              {proofsProgress >= 1 && (
                <Ionicons name="checkmark-circle" size={16} color={colors.success} />
              )}
            </View>
            <View style={[styles.progressBar, { backgroundColor: colors.border }]}>
              <View
                style={[
                  styles.progressFill,
                  {
                    backgroundColor: proofsProgress >= 1 ? colors.success : colors.primary,
                    width: `${proofsProgress * 100}%`,
                  },
                ]}
              />
            </View>
          </View>

          {/* Minimum Level Warning (if applicable) */}
          {!canRequestReferences && minimumLevel != null && currentLevel != null && (
            <View style={[styles.warningBox, { backgroundColor: '#FFF8E1' }]}>
              <Ionicons name="information-circle" size={16} color={colors.warning} />
              <Text style={[styles.warningText, { color: '#F57C00' }]}>
                {t('profile.certification.referenceRequest.minimumLevelRequired', {
                  level: minimumLevel,
                })}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Peer Evaluation Section (if disputed or has evaluations) */}
      {peerEvaluationCount != null && peerEvaluationCount > 0 && (
        <View style={styles.evaluationSection}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            {t('profile.certification.evaluation.title')}
          </Text>
          <View style={styles.evaluationRow}>
            <Text style={[styles.evaluationText, { color: colors.textSecondary }]}>
              {t('profile.certification.evaluation.average', {
                score: peerEvaluationAverage?.toFixed(1) || '—',
              })}
            </Text>
            <Text style={[styles.evaluationCount, { color: colors.textSecondary }]}>
              ({t('profile.certification.evaluation.count', { count: peerEvaluationCount })})
            </Text>
          </View>
          {badgeStatus === 'disputed' && (
            <Text style={[styles.evaluationWarning, { color: colors.error }]}>
              {t('profile.certification.evaluation.belowLevel')}
            </Text>
          )}
        </View>
      )}

      {/* Action Buttons (only for own profile) */}
      {isOwnProfile && (
        <View style={styles.actionsSection}>
          {canRequestReferences && onRequestReference && (
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: colors.primary }]}
              onPress={onRequestReference}
              activeOpacity={0.7}
            >
              <Ionicons name="person-add-outline" size={18} color="#FFFFFF" />
              <Text style={[styles.actionButtonText, { color: '#FFFFFF' }]}>
                {t('profile.rating.requestReference')}
              </Text>
            </TouchableOpacity>
          )}

          {onManageProofs && (
            <TouchableOpacity
              style={[styles.actionButton, styles.secondaryButton, { borderColor: colors.primary }]}
              onPress={onManageProofs}
              activeOpacity={0.7}
            >
              <Ionicons name="document-text-outline" size={18} color={colors.primary} />
              <Text style={[styles.actionButtonText, { color: colors.primary }]}>
                {t('profile.rating.manageRatingProofs')}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Stats Summary */}
      <View style={[styles.statsRow, { borderTopColor: colors.border }]}>
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: colors.text }]}>{referencesCount}</Text>
          <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
            {t('profile.rating.references', { count: referencesCount }).replace(
              `${referencesCount} `,
              ''
            )}
          </Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: colors.text }]}>{approvedProofsCount}</Text>
          <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
            {t('profile.rating.ratingProof', { count: approvedProofsCount }).replace(
              `${approvedProofsCount} `,
              ''
            )}
          </Text>
        </View>
        {peerEvaluationCount != null && peerEvaluationCount > 0 && (
          <>
            <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: colors.text }]}>{peerEvaluationCount}</Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
                {t('profile.rating.peerRating', { count: peerEvaluationCount }).replace(
                  `${peerEvaluationCount} `,
                  ''
                )}
              </Text>
            </View>
          </>
        )}
      </View>

      {/* Info Modal for Level Proofs */}
      <InfoModal
        visible={showProofInfoModal}
        onClose={() => setShowProofInfoModal(false)}
        title={t('profile.certification.requirements.levelProofInfoTitle')}
        message={t('profile.certification.requirements.levelProofInfoMessage')}
        closeLabel={t('common.gotIt')}
        iconName="document-text"
      />
    </Card>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: spacingPixels[3], // 12px
    marginVertical: spacingPixels[2], // 8px
    borderRadius: radiusPixels.lg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacingPixels[2], // 8px
  },
  title: {
    fontSize: fontSizePixels.lg,
    fontWeight: '600',
  },
  description: {
    fontSize: fontSizePixels.sm,
    marginBottom: spacingPixels[3], // 12px
  },
  progressSection: {
    marginBottom: spacingPixels[3], // 12px
  },
  sectionTitle: {
    fontSize: fontSizePixels.base,
    fontWeight: '500',
    marginBottom: spacingPixels[2], // 8px
  },
  progressItem: {
    marginBottom: spacingPixels[2], // 8px
  },
  progressLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacingPixels[1], // 4px
    gap: spacingPixels[1], // 4px
  },
  progressLabel: {
    fontSize: fontSizePixels.sm,
    flex: 1,
  },
  progressBar: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacingPixels[2], // 8px
    borderRadius: radiusPixels.md,
    marginTop: spacingPixels[2], // 8px
    gap: spacingPixels[1], // 4px
  },
  warningText: {
    fontSize: fontSizePixels.sm,
    flex: 1,
  },
  evaluationSection: {
    marginBottom: spacingPixels[3], // 12px
  },
  evaluationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1], // 4px
  },
  evaluationText: {
    fontSize: fontSizePixels.sm,
  },
  evaluationCount: {
    fontSize: fontSizePixels.xs,
  },
  evaluationWarning: {
    fontSize: fontSizePixels.sm,
    marginTop: spacingPixels[1], // 4px
  },
  actionsSection: {
    gap: spacingPixels[2], // 8px
    marginBottom: spacingPixels[3], // 12px
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[2], // 8px
    paddingHorizontal: spacingPixels[3], // 12px
    borderRadius: radiusPixels.md,
    gap: spacingPixels[1], // 4px
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
  },
  actionButtonText: {
    fontSize: fontSizePixels.base,
    fontWeight: '500',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: spacingPixels[3], // 12px
    borderTopWidth: 1,
  },
  statItem: {
    alignItems: 'center',
    flex: 1,
  },
  statValue: {
    fontSize: fontSizePixels.xl,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: fontSizePixels.xs,
    marginTop: spacingPixels[0.5], // 2px
  },
  statDivider: {
    width: 1,
    height: '80%',
    alignSelf: 'center',
  },
});

export default CertificationSection;
