/**
 * PlayerPortfolioSection Component
 *
 * A gallery section for displaying another player's rating proofs.
 * Organizes proofs by type: videos, photos, links, and documents.
 * Allows the viewing user to endorse (approve) or decline proofs.
 * Multiple users can endorse the same proof - proofs auto-approve at threshold.
 * Used in PlayerProfile view (viewing someone else's profile).
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Image,
  FlatList,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Text, Skeleton, useToast } from '@rallia/shared-components';
import { supabase, Logger } from '@rallia/shared-services';
import { lightHaptic, mediumHaptic } from '@rallia/shared-utils';
import { useThemeStyles, useTranslation } from '../../hooks';
import { withTimeout, getNetworkErrorMessage } from '../../utils/networkTimeout';
import ProofViewer from '../ratings/components/ProofViewer';
import {
  spacingPixels,
  radiusPixels,
  fontSizePixels,
  fontWeightNumeric,
} from '@rallia/design-system';

// Horizontal scroll card dimensions
const CARD_WIDTH = 120;
const CARD_HEIGHT = 150;

// Endorsement threshold for auto-approval
const ENDORSEMENT_THRESHOLD = 3;

export interface PlayerPortfolioProof {
  id: string;
  proof_type: 'external_link' | 'video' | 'image' | 'document';
  title: string;
  description: string | null;
  external_url: string | null;
  status: string;
  created_at: string;
  sport_id?: string;
  sport_name?: string;
  player_rating_score_id: string;
  file?: {
    id: string;
    url: string;
    thumbnail_url: string | null;
    file_type: string;
    original_name: string;
    mime_type: string;
  } | null;
}

export interface ProofEndorsement {
  proof_id: string;
  reviewer_id: string;
  is_approved: boolean;
}

export interface ProofEndorsementCounts {
  approvals: number;
  declines: number;
  userEndorsement: boolean | null; // null = not endorsed, true = approved, false = declined
}

export interface PlayerPortfolioSport {
  id: string;
  display_name: string;
}

interface PlayerPortfolioSectionProps {
  playerId: string;
  sports: PlayerPortfolioSport[];
  skeletonBg: string;
  skeletonHighlight: string;
}

const PlayerPortfolioSection: React.FC<PlayerPortfolioSectionProps> = ({
  playerId,
  sports,
  skeletonBg,
  skeletonHighlight,
}) => {
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const toast = useToast();

  const [proofs, setProofs] = useState<PlayerPortfolioProof[]>([]);
  const [endorsements, setEndorsements] = useState<Map<string, ProofEndorsementCounts>>(new Map());
  const [loading, setLoading] = useState(true);
  const [selectedProof, setSelectedProof] = useState<PlayerPortfolioProof | null>(null);
  const [showViewer, setShowViewer] = useState(false);
  const [selectedSportId, setSelectedSportId] = useState<string | null>(null);
  const [processingProofId, setProcessingProofId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Fetch current user
  useEffect(() => {
    const fetchCurrentUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setCurrentUserId(user?.id || null);
    };
    fetchCurrentUser();
  }, []);

  // Fetch endorsements for a list of proof IDs
  const fetchEndorsements = useCallback(async (proofIds: string[], userId: string | null) => {
    if (proofIds.length === 0) {
      setEndorsements(new Map());
      return;
    }

    try {
      const { data, error } = await supabase
        .from('proof_endorsement')
        .select('proof_id, reviewer_id, is_approved')
        .in('proof_id', proofIds);

      if (error) throw error;

      // Build endorsement counts map
      const countsMap = new Map<string, ProofEndorsementCounts>();

      // Initialize all proofs with zero counts
      proofIds.forEach(id => {
        countsMap.set(id, { approvals: 0, declines: 0, userEndorsement: null });
      });

      // Count endorsements
      (data || []).forEach((endorsement: ProofEndorsement) => {
        const counts = countsMap.get(endorsement.proof_id);
        if (counts) {
          if (endorsement.is_approved) {
            counts.approvals++;
          } else {
            counts.declines++;
          }
          // Track current user's endorsement
          if (userId && endorsement.reviewer_id === userId) {
            counts.userEndorsement = endorsement.is_approved;
          }
        }
      });

      setEndorsements(countsMap);
    } catch (error) {
      Logger.error('Failed to fetch endorsements', error as Error);
    }
  }, []);

  // Fetch proofs for this player
  const fetchProofs = useCallback(async () => {
    if (!playerId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      // First get all player_rating_scores for this player
      const ratingsResult = await withTimeout(
        (async () =>
          supabase
            .from('player_rating_score')
            .select(
              `
              id,
              rating_score!player_rating_scores_rating_score_id_fkey (
                rating_system (
                  sport:sport_id (
                    id,
                    display_name
                  )
                )
              )
            `
            )
            .eq('player_id', playerId))(),
        15000,
        'Failed to load ratings'
      );

      if (ratingsResult.error) throw ratingsResult.error;

      const ratingIds = (ratingsResult.data || []).map(r => r.id);

      if (ratingIds.length === 0) {
        setProofs([]);
        setLoading(false);
        return;
      }

      // Create maps of rating_score_id to sport info
      const sportNameMap = new Map<string, string>();
      const sportIdMap = new Map<string, string>();
      (ratingsResult.data || []).forEach(rating => {
        const ratingScore = rating.rating_score as {
          rating_system?: {
            sport?: { id?: string; display_name?: string };
          };
        } | null;
        const sport = ratingScore?.rating_system?.sport;
        if (sport?.display_name) {
          sportNameMap.set(rating.id, sport.display_name);
        }
        if (sport?.id) {
          sportIdMap.set(rating.id, sport.id);
        }
      });

      // Fetch all proofs for these ratings (show all statuses for review)
      const proofsResult = await withTimeout(
        (async () =>
          supabase
            .from('rating_proof')
            .select(
              `
              *,
              file:file(*)
            `
            )
            .in('player_rating_score_id', ratingIds)
            .eq('is_active', true)
            .neq('status', 'rejected')
            .order('created_at', { ascending: false }))(),
        15000,
        'Failed to load portfolio proofs'
      );

      if (proofsResult.error) throw proofsResult.error;

      // Map proofs with sport names and IDs
      const portfolioData = (proofsResult.data || []).map((item: Record<string, unknown>) => ({
        ...item,
        file: Array.isArray(item.file) && item.file.length > 0 ? item.file[0] : item.file,
        sport_name: sportNameMap.get(item.player_rating_score_id as string),
        sport_id: sportIdMap.get(item.player_rating_score_id as string),
      })) as PlayerPortfolioProof[];

      setProofs(portfolioData);

      // Fetch endorsements for all proofs
      const proofIds = portfolioData.map(p => p.id);
      await fetchEndorsements(proofIds, currentUserId);
    } catch (error) {
      Logger.error('Failed to fetch player portfolio', error as Error);
      toast.error(getNetworkErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [playerId, toast, currentUserId, fetchEndorsements]);

  useEffect(() => {
    fetchProofs();
  }, [fetchProofs]);

  // Refetch endorsements when currentUserId changes
  useEffect(() => {
    if (proofs.length > 0 && currentUserId) {
      fetchEndorsements(
        proofs.map(p => p.id),
        currentUserId
      );
    }
  }, [currentUserId, proofs.length, fetchEndorsements, proofs]);

  // Get sports that have proofs
  const sportsWithProofs = useMemo(() => {
    const sportIds = new Set(proofs.map(p => p.sport_id).filter(Boolean));
    return sports.filter(s => sportIds.has(s.id));
  }, [proofs, sports]);

  // Filter proofs by selected sport
  const filteredProofs = useMemo(() => {
    if (selectedSportId === null) {
      return proofs;
    }
    return proofs.filter(p => p.sport_id === selectedSportId);
  }, [proofs, selectedSportId]);

  // Helper to get effective type - use file.file_type for file-based proofs
  const getEffectiveType = (proof: PlayerPortfolioProof): string => {
    if (proof.proof_type === 'external_link') return 'external_link';
    if (proof.file?.file_type) return proof.file.file_type;
    return proof.proof_type || 'unknown';
  };

  // Group proofs by effective type
  const videoProofs = filteredProofs.filter(p => getEffectiveType(p) === 'video');
  const imageProofs = filteredProofs.filter(p => getEffectiveType(p) === 'image');
  const linkProofs = filteredProofs.filter(p => getEffectiveType(p) === 'external_link');
  const documentProofs = filteredProofs.filter(p => getEffectiveType(p) === 'document');
  const otherProofs = filteredProofs.filter(
    p => !['video', 'image', 'document', 'external_link'].includes(getEffectiveType(p))
  );

  const totalCount = filteredProofs.length;
  const showSportToggle = sportsWithProofs.length > 1;

  const handleProofPress = (proof: PlayerPortfolioProof) => {
    lightHaptic();
    setSelectedProof(proof);
    setShowViewer(true);
  };

  // Submit endorsement (approve or decline)
  const submitEndorsement = async (proof: PlayerPortfolioProof, isApproved: boolean) => {
    if (!currentUserId) return;

    const endorsementCounts = endorsements.get(proof.id);
    const hasExistingEndorsement = endorsementCounts?.userEndorsement !== null;
    const isSameVote = endorsementCounts?.userEndorsement === isApproved;

    // If clicking the same button again, do nothing
    if (isSameVote) {
      toast.info(t('profile.portfolio.alreadyEndorsed'));
      return;
    }

    const actionKey = isApproved ? 'approve' : 'decline';
    const titleKey = isApproved ? 'approveTitle' : 'declineTitle';
    const messageKey = hasExistingEndorsement
      ? 'changeEndorsementMessage'
      : isApproved
        ? 'approveMessage'
        : 'declineMessage';

    Alert.alert(
      t(`profile.portfolio.${titleKey}`),
      t(`profile.portfolio.${messageKey}`, { title: proof.title }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t(`profile.portfolio.${actionKey}`),
          style: isApproved ? 'default' : 'destructive',
          onPress: async () => {
            mediumHaptic();
            setProcessingProofId(proof.id);
            try {
              // Upsert endorsement (insert or update if exists)
              const { error } = await supabase.from('proof_endorsement').upsert(
                {
                  proof_id: proof.id,
                  reviewer_id: currentUserId,
                  is_approved: isApproved,
                  updated_at: new Date().toISOString(),
                },
                {
                  onConflict: 'proof_id,reviewer_id',
                }
              );

              if (error) throw error;

              // Update local endorsement state
              setEndorsements(prev => {
                const newMap = new Map(prev);
                const counts = newMap.get(proof.id) || {
                  approvals: 0,
                  declines: 0,
                  userEndorsement: null,
                };

                // Adjust counts based on previous endorsement
                if (counts.userEndorsement === true) {
                  counts.approvals--;
                } else if (counts.userEndorsement === false) {
                  counts.declines--;
                }

                // Add new endorsement
                if (isApproved) {
                  counts.approvals++;
                } else {
                  counts.declines++;
                }
                counts.userEndorsement = isApproved;

                newMap.set(proof.id, counts);
                return newMap;
              });

              // Check if proof was auto-approved (threshold reached)
              const updatedCounts = endorsements.get(proof.id);
              const newApprovals = (updatedCounts?.approvals || 0) + (isApproved ? 1 : 0);

              if (
                isApproved &&
                newApprovals >= ENDORSEMENT_THRESHOLD &&
                proof.status === 'pending'
              ) {
                // Update local proof status to approved
                setProofs(prev =>
                  prev.map(p => (p.id === proof.id ? { ...p, status: 'approved' } : p))
                );
                toast.success(t('profile.portfolio.proofCertified'));
              } else {
                toast.success(
                  isApproved
                    ? t('profile.portfolio.endorsedSuccess')
                    : t('profile.portfolio.declinedSuccess')
                );
              }
            } catch (error) {
              Logger.error('Failed to submit endorsement', error as Error);
              toast.error(getNetworkErrorMessage(error));
            } finally {
              setProcessingProofId(null);
            }
          },
        },
      ]
    );
  };

  const handleApproveProof = (proof: PlayerPortfolioProof) => submitEndorsement(proof, true);
  const handleDeclineProof = (proof: PlayerPortfolioProof) => submitEndorsement(proof, false);

  const getProofIcon = (proof: PlayerPortfolioProof): keyof typeof Ionicons.glyphMap => {
    const type = getEffectiveType(proof);
    switch (type) {
      case 'video':
        return 'videocam';
      case 'image':
        return 'image';
      case 'document':
        return 'document-text';
      case 'external_link':
        return 'link';
      default:
        return 'help-circle';
    }
  };

  const getProofColor = (proof: PlayerPortfolioProof) => {
    const type = getEffectiveType(proof);
    switch (type) {
      case 'video':
        return '#FF6B6B';
      case 'image':
        return '#4ECDC4';
      case 'document':
        return '#45B7D1';
      case 'external_link':
        return '#96CEB4';
      default:
        return colors.primary;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'approved':
        return '#22C55E';
      case 'pending':
        return '#F59E0B';
      case 'rejected':
        return '#EF4444';
      default:
        return colors.textMuted;
    }
  };

  const getThumbnail = (proof: PlayerPortfolioProof) => {
    if (proof.file?.file_type === 'image' && proof.file?.url) {
      return proof.file.url;
    }
    if (proof.file?.file_type === 'video' && proof.file?.thumbnail_url) {
      return proof.file.thumbnail_url;
    }
    if (proof.file?.thumbnail_url) {
      return proof.file.thumbnail_url;
    }
    return null;
  };

  const renderProofCard = ({ item }: { item: PlayerPortfolioProof }) => {
    const thumbnail = getThumbnail(item);
    const typeColor = getProofColor(item);
    const statusColor = getStatusColor(item.status);
    const effectiveType = getEffectiveType(item);
    const isProcessing = processingProofId === item.id;

    // Get endorsement data
    const endorsementData = endorsements.get(item.id) || {
      approvals: 0,
      declines: 0,
      userEndorsement: null,
    };
    const { approvals, declines, userEndorsement } = endorsementData;
    const hasUserEndorsed = userEndorsement !== null;
    const userApproved = userEndorsement === true;
    const userDeclined = userEndorsement === false;

    // Show action buttons if proof is pending and user can still vote
    const canEndorse = item.status === 'pending';

    return (
      <View style={styles.proofCardWrapper}>
        <TouchableOpacity
          style={[styles.proofCard, { backgroundColor: colors.card }]}
          onPress={() => handleProofPress(item)}
          activeOpacity={0.8}
          disabled={isProcessing}
        >
          {thumbnail ? (
            <Image source={{ uri: thumbnail }} style={styles.thumbnail} resizeMode="cover" />
          ) : (
            <View style={[styles.placeholderThumbnail, { backgroundColor: `${typeColor}20` }]}>
              <Ionicons name={getProofIcon(item)} size={36} color={typeColor} />
            </View>
          )}

          {/* Gradient overlay */}
          <LinearGradient colors={['transparent', 'rgba(0,0,0,0.7)']} style={styles.gradient} />

          {/* Type badge */}
          <View style={[styles.typeBadge, { backgroundColor: typeColor }]}>
            <Ionicons name={getProofIcon(item)} size={10} color="#fff" />
          </View>

          {/* Status indicator */}
          <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
            <Text style={styles.statusText}>
              {item.status === 'pending'
                ? t('profile.ratingProofs.status.pending')
                : item.status === 'approved'
                  ? t('profile.ratingProofs.status.approved')
                  : item.status}
            </Text>
          </View>

          {/* Endorsement counts badge */}
          {(approvals > 0 || declines > 0) && (
            <View style={styles.endorsementBadge}>
              {approvals > 0 && (
                <View style={styles.endorsementCount}>
                  <Ionicons name="checkmark-circle" size={12} color="#22C55E" />
                  <Text style={styles.endorsementText}>{approvals}</Text>
                </View>
              )}
              {declines > 0 && (
                <View style={styles.endorsementCount}>
                  <Ionicons name="close-circle" size={12} color="#EF4444" />
                  <Text style={styles.endorsementText}>{declines}</Text>
                </View>
              )}
            </View>
          )}

          {/* Play button for videos */}
          {effectiveType === 'video' && (
            <View style={styles.playButtonContainer}>
              <View style={styles.playButton}>
                <Ionicons name="play" size={20} color="#fff" />
              </View>
            </View>
          )}

          {/* Title overlay */}
          <View style={styles.titleOverlay}>
            <Text style={styles.proofTitle} numberOfLines={2}>
              {item.title}
            </Text>
          </View>

          {/* Processing overlay */}
          {isProcessing && (
            <View style={styles.processingOverlay}>
              <ActivityIndicator color="#fff" size="small" />
            </View>
          )}
        </TouchableOpacity>

        {/* Approve/Decline buttons - always show for pending proofs */}
        {canEndorse && (
          <View style={styles.actionButtons}>
            <TouchableOpacity
              style={[
                styles.actionButton,
                styles.approveButton,
                userApproved && styles.actionButtonActive,
              ]}
              onPress={() => handleApproveProof(item)}
              disabled={isProcessing}
            >
              <Ionicons
                name={userApproved ? 'checkmark-circle' : 'checkmark'}
                size={16}
                color="#fff"
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.actionButton,
                styles.declineButton,
                userDeclined && styles.actionButtonActive,
              ]}
              onPress={() => handleDeclineProof(item)}
              disabled={isProcessing}
            >
              <Ionicons name={userDeclined ? 'close-circle' : 'close'} size={16} color="#fff" />
            </TouchableOpacity>
          </View>
        )}

        {/* Show user's endorsement indicator for approved proofs */}
        {item.status === 'approved' && hasUserEndorsed && (
          <View style={styles.userEndorsedIndicator}>
            <Ionicons
              name={userApproved ? 'checkmark-circle' : 'close-circle'}
              size={14}
              color={userApproved ? '#22C55E' : '#EF4444'}
            />
            <Text style={[styles.userEndorsedText, { color: colors.textMuted }]}>
              {userApproved
                ? t('profile.portfolio.youEndorsed')
                : t('profile.portfolio.youDeclined')}
            </Text>
          </View>
        )}
      </View>
    );
  };

  const renderCategorySection = (
    title: string,
    icon: keyof typeof Ionicons.glyphMap,
    categoryProofs: PlayerPortfolioProof[],
    color: string
  ) => {
    if (categoryProofs.length === 0) return null;

    return (
      <View style={styles.categorySection}>
        <View style={styles.categoryHeader}>
          <View style={[styles.categoryIconContainer, { backgroundColor: `${color}15` }]}>
            <Ionicons name={icon} size={14} color={color} />
          </View>
          <Text style={[styles.categoryTitle, { color: colors.text }]}>{title}</Text>
          <View style={[styles.countBadge, { backgroundColor: `${color}15` }]}>
            <Text style={[styles.countText, { color }]}>{categoryProofs.length}</Text>
          </View>
        </View>
        <FlatList
          data={categoryProofs}
          renderItem={renderProofCard}
          keyExtractor={item => item.id}
          horizontal
          nestedScrollEnabled={true}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.horizontalList}
          ItemSeparatorComponent={() => <View style={{ width: spacingPixels[2] }} />}
        />
      </View>
    );
  };

  const renderSportToggle = () => {
    if (!showSportToggle) return null;

    return (
      <View style={styles.sportToggleContainer}>
        <TouchableOpacity
          style={[
            styles.sportToggleButton,
            selectedSportId === null && styles.sportToggleButtonActive,
            {
              backgroundColor:
                selectedSportId === null
                  ? colors.primary
                  : isDark
                    ? colors.inputBackground
                    : colors.card,
              borderColor: selectedSportId === null ? colors.primary : colors.border,
            },
          ]}
          onPress={() => setSelectedSportId(null)}
        >
          <Text
            style={[
              styles.sportToggleText,
              { color: selectedSportId === null ? '#fff' : colors.text },
            ]}
          >
            {t('profile.portfolio.all')}
          </Text>
        </TouchableOpacity>
        {sportsWithProofs.map(sport => (
          <TouchableOpacity
            key={sport.id}
            style={[
              styles.sportToggleButton,
              selectedSportId === sport.id && styles.sportToggleButtonActive,
              {
                backgroundColor:
                  selectedSportId === sport.id
                    ? colors.primary
                    : isDark
                      ? colors.inputBackground
                      : colors.card,
                borderColor: selectedSportId === sport.id ? colors.primary : colors.border,
              },
            ]}
            onPress={() => setSelectedSportId(sport.id)}
          >
            <Text
              style={[
                styles.sportToggleText,
                { color: selectedSportId === sport.id ? '#fff' : colors.text },
              ]}
            >
              {sport.display_name}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  };

  const renderEmptyState = () => (
    <View style={[styles.emptyState, { backgroundColor: colors.card }]}>
      <View style={[styles.emptyIconContainer, { backgroundColor: `${colors.primary}10` }]}>
        <Ionicons name="folder-open-outline" size={28} color={colors.primary} />
      </View>
      <Text style={[styles.emptyTitle, { color: colors.text }]}>
        {t('profile.portfolio.emptyTitle')}
      </Text>
      <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>
        {t('profile.portfolio.emptyDescriptionOther')}
      </Text>
    </View>
  );

  const renderSkeletonSection = () => (
    <View style={[styles.card, { backgroundColor: colors.card }]}>
      <View style={styles.categorySection}>
        <View style={styles.categoryHeader}>
          <Skeleton
            width={24}
            height={24}
            borderRadius={12}
            backgroundColor={skeletonBg}
            highlightColor={skeletonHighlight}
          />
          <Skeleton
            width={70}
            height={14}
            backgroundColor={skeletonBg}
            highlightColor={skeletonHighlight}
            style={{ marginLeft: spacingPixels[2] }}
          />
        </View>
        <View style={[styles.horizontalList, { flexDirection: 'row' }]}>
          {[1, 2, 3].map(i => (
            <View key={i} style={{ marginRight: spacingPixels[2] }}>
              <Skeleton
                width={CARD_WIDTH}
                height={CARD_HEIGHT}
                borderRadius={radiusPixels.lg}
                backgroundColor={skeletonBg}
                highlightColor={skeletonHighlight}
              />
            </View>
          ))}
        </View>
      </View>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Ionicons name="folder-open-outline" size={18} color={colors.primary} />
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            {t('profile.sections.portfolio')}
          </Text>
        </View>
        {renderSkeletonSection()}
      </View>
    );
  }

  const hasAnyProofs = proofs.length > 0;
  const pendingCount = proofs.filter(p => p.status === 'pending').length;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Ionicons name="folder-open-outline" size={18} color={colors.primary} />
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          {t('profile.sections.portfolio')}
        </Text>
      </View>

      {!hasAnyProofs ? (
        renderEmptyState()
      ) : (
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          {/* Stats row */}
          {(hasAnyProofs || pendingCount > 0) && (
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: colors.text }]}>{proofs.length}</Text>
                <Text style={[styles.statLabel, { color: colors.textMuted }]}>Total</Text>
              </View>
              {pendingCount > 0 && (
                <View style={styles.statItem}>
                  <Text style={[styles.statValue, { color: '#F59E0B' }]}>{pendingCount}</Text>
                  <Text style={[styles.statLabel, { color: colors.textMuted }]}>
                    {t('profile.ratingProofs.status.pending')}
                  </Text>
                </View>
              )}
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: '#22C55E' }]}>
                  {proofs.filter(p => p.status === 'approved').length}
                </Text>
                <Text style={[styles.statLabel, { color: colors.textMuted }]}>
                  {t('profile.ratingProofs.status.approved')}
                </Text>
              </View>
            </View>
          )}

          {/* Endorsement threshold info */}
          {pendingCount > 0 && (
            <View style={[styles.endorsementInfo, { backgroundColor: `${colors.primary}10` }]}>
              <Ionicons name="information-circle-outline" size={16} color={colors.primary} />
              <Text style={[styles.endorsementInfoText, { color: colors.text }]}>
                {t('profile.portfolio.endorsementThresholdInfo', {
                  threshold: ENDORSEMENT_THRESHOLD,
                })}
              </Text>
            </View>
          )}

          {renderSportToggle()}

          {totalCount === 0 ? (
            <View style={styles.noProofsForSport}>
              <Text style={[styles.noProofsText, { color: colors.textMuted }]}>
                {t('profile.portfolio.noProofsForSport')}
              </Text>
            </View>
          ) : (
            <>
              {renderCategorySection(
                t('profile.portfolio.videos'),
                'videocam',
                videoProofs,
                '#FF6B6B'
              )}
              {renderCategorySection(
                t('profile.portfolio.photos'),
                'image',
                imageProofs,
                '#4ECDC4'
              )}
              {renderCategorySection(t('profile.portfolio.links'), 'link', linkProofs, '#96CEB4')}
              {renderCategorySection(
                t('profile.portfolio.documents'),
                'document-text',
                documentProofs,
                '#45B7D1'
              )}
              {otherProofs.length > 0 &&
                renderCategorySection('Other', 'help-circle', otherProofs, colors.textMuted)}
            </>
          )}
        </View>
      )}

      {/* Proof Viewer Modal */}
      <ProofViewer
        visible={showViewer}
        onClose={() => {
          setShowViewer(false);
          setSelectedProof(null);
        }}
        proof={selectedProof}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  // Match PlayerProfile section styling - no horizontal padding since parent provides it
  section: {
    marginTop: spacingPixels[4],
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    marginBottom: spacingPixels[3],
  },
  sectionTitle: {
    fontSize: fontSizePixels.base,
    fontWeight: fontWeightNumeric.semibold,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingBottom: spacingPixels[3],
    marginBottom: spacingPixels[3],
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: fontSizePixels.lg,
    fontWeight: fontWeightNumeric.bold,
  },
  statLabel: {
    fontSize: fontSizePixels.xs,
    marginTop: spacingPixels[0.5],
  },
  card: {
    borderRadius: radiusPixels.lg,
    padding: spacingPixels[4],
  },
  // Endorsement info banner
  endorsementInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    padding: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    marginBottom: spacingPixels[3],
  },
  endorsementInfoText: {
    fontSize: fontSizePixels.xs,
    flex: 1,
  },
  // Sport toggle
  sportToggleContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacingPixels[2],
    marginBottom: spacingPixels[4],
  },
  sportToggleButton: {
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[1.5],
    borderRadius: radiusPixels.full,
    borderWidth: 1,
  },
  sportToggleButtonActive: {
    borderWidth: 0,
  },
  sportToggleText: {
    fontSize: fontSizePixels.sm,
    fontWeight: fontWeightNumeric.medium,
  },
  // Category sections
  categorySection: {
    marginBottom: spacingPixels[3],
  },
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacingPixels[2],
  },
  categoryIconContainer: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  categoryTitle: {
    fontSize: fontSizePixels.sm,
    fontWeight: fontWeightNumeric.medium,
    marginLeft: spacingPixels[2],
    flex: 1,
  },
  countBadge: {
    paddingHorizontal: spacingPixels[1.5],
    paddingVertical: spacingPixels[0.5],
    borderRadius: radiusPixels.full,
    minWidth: 20,
    alignItems: 'center',
  },
  countText: {
    fontSize: fontSizePixels.xs,
    fontWeight: fontWeightNumeric.bold,
  },
  horizontalList: {},
  // Proof cards
  proofCardWrapper: {
    width: CARD_WIDTH,
  },
  proofCard: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: radiusPixels.lg,
    overflow: 'hidden',
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
  placeholderThumbnail: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  gradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '50%',
  },
  typeBadge: {
    position: 'absolute',
    top: spacingPixels[1.5],
    right: spacingPixels[1.5],
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusBadge: {
    position: 'absolute',
    top: spacingPixels[1.5],
    left: spacingPixels[1.5],
    paddingHorizontal: spacingPixels[1.5],
    paddingVertical: spacingPixels[0.5],
    borderRadius: radiusPixels.sm,
  },
  statusText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: fontWeightNumeric.bold,
    textTransform: 'uppercase',
  },
  // Endorsement badge on card
  endorsementBadge: {
    position: 'absolute',
    top: spacingPixels[1.5] + 20,
    left: spacingPixels[1.5],
    flexDirection: 'row',
    gap: spacingPixels[1],
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: spacingPixels[1],
    paddingVertical: spacingPixels[0.5],
    borderRadius: radiusPixels.sm,
  },
  endorsementCount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  endorsementText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: fontWeightNumeric.bold,
  },
  playButtonContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingLeft: 3,
  },
  titleOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: spacingPixels[1.5],
  },
  proofTitle: {
    color: '#fff',
    fontSize: fontSizePixels.xs - 1,
    fontWeight: fontWeightNumeric.medium,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  processingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Action buttons
  actionButtons: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacingPixels[2],
    marginTop: spacingPixels[1.5],
  },
  actionButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    opacity: 0.8,
  },
  actionButtonActive: {
    opacity: 1,
    transform: [{ scale: 1.1 }],
  },
  approveButton: {
    backgroundColor: '#22C55E',
  },
  declineButton: {
    backgroundColor: '#EF4444',
  },
  // User endorsed indicator
  userEndorsedIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[1],
    marginTop: spacingPixels[1],
  },
  userEndorsedText: {
    fontSize: fontSizePixels.xs - 1,
  },
  // Empty state
  emptyState: {
    borderRadius: radiusPixels.lg,
    padding: spacingPixels[5],
    alignItems: 'center',
  },
  emptyIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacingPixels[3],
  },
  emptyTitle: {
    fontSize: fontSizePixels.sm,
    fontWeight: fontWeightNumeric.semibold,
    marginBottom: spacingPixels[1],
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: fontSizePixels.xs,
    textAlign: 'center',
    lineHeight: fontSizePixels.xs * 1.4,
  },
  // No proofs for selected sport
  noProofsForSport: {
    paddingVertical: spacingPixels[4],
    alignItems: 'center',
  },
  noProofsText: {
    fontSize: fontSizePixels.sm,
    fontStyle: 'italic',
  },
});

export default PlayerPortfolioSection;
