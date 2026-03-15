import React, { useState, useEffect, useLayoutEffect, useCallback } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, Alert, Image, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { Text, Button, Skeleton, useToast } from '@rallia/shared-components';
import { lightHaptic, warningHaptic } from '@rallia/shared-utils';
import { supabase, Logger } from '@rallia/shared-services';
import { RatingProofWithFile, RatingProofsScreenParams } from '@rallia/shared-types';
import { SheetManager } from 'react-native-actions-sheet';
import { withTimeout, getNetworkErrorMessage } from '../utils/networkTimeout';
import { getSafeAreaEdges } from '../utils';
import { useThemeStyles, useTranslation } from '../hooks';
import { formatDateShort } from '../utils/dateFormatting';
import {
  spacingPixels,
  radiusPixels,
  fontSizePixels,
  shadowsNative,
  status,
} from '@rallia/design-system';

type RatingProofsRouteProp = RouteProp<{ RatingProofs: RatingProofsScreenParams }, 'RatingProofs'>;

// Extended type to include the rating_score relation and ensure rating_score_id is typed
interface RatingProofWithRatingScore extends RatingProofWithFile {
  rating_score_id: string | null; // Ensure this is typed (from base RatingProof)
  rating_score?: {
    id: string;
    label: string;
    value: number;
  } | null;
}

const RatingProofs: React.FC = () => {
  const navigation = useNavigation();
  const route = useRoute<RatingProofsRouteProp>();
  const { playerRatingScoreId, ratingValue, isOwnProfile } = route.params;
  const { colors, isDark } = useThemeStyles();
  const { t, locale } = useTranslation();
  const toast = useToast();

  // Track current rating_score_id to identify current-level proofs
  const [currentRatingScoreId, setCurrentRatingScoreId] = useState<string | null>(null);

  const [proofs, setProofs] = useState<RatingProofWithRatingScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter] = useState<'all' | 'approved' | 'pending' | 'rejected'>('all');

  // Define handleAddProof before useLayoutEffect that uses it
  const handleAddProof = useCallback(() => {
    lightHaptic();
    SheetManager.show('add-rating-proof', {
      payload: {
        onSelectProofType: handleSelectProofType,
      },
    });
  }, []);

  // Configure header right button for add action
  useLayoutEffect(() => {
    if (isOwnProfile) {
      navigation.setOptions({
        headerRight: () => (
          <TouchableOpacity onPress={handleAddProof} style={{ marginRight: spacingPixels[2] }}>
            <Ionicons name="add-outline" size={28} color={colors.headerForeground} />
          </TouchableOpacity>
        ),
      });
    } else {
      navigation.setOptions({
        headerRight: undefined,
      });
    }
  }, [isOwnProfile, navigation, colors.headerForeground, handleAddProof]);

  useEffect(() => {
    fetchProofs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerRatingScoreId, filter]);

  const fetchProofs = async () => {
    setLoading(true);
    try {
      // First, get the current rating_score_id from player_rating_score
      const { data: playerRatingScore } = await supabase
        .from('player_rating_score')
        .select('rating_score_id')
        .eq('id', playerRatingScoreId)
        .single();

      if (playerRatingScore) {
        setCurrentRatingScoreId(playerRatingScore.rating_score_id);
      }

      // Build query based on filters - include rating_score to show original rating level
      let query = supabase
        .from('rating_proof')
        .select(
          `
          *,
          file:file(*),
          reviewed_by_profile:profile!reviewed_by(display_name, profile_picture_url),
          rating_score:rating_score_id(id, label, value)
        `
        )
        .eq('player_rating_score_id', playerRatingScoreId)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      // Apply status filter
      if (filter !== 'all') {
        query = query.eq('status', filter);
      }

      // If not own profile, only show approved proofs
      if (!isOwnProfile) {
        query = query.eq('status', 'approved');
      }

      // Execute query with timeout
      const result = await withTimeout(
        (async () => query)(),
        15000,
        'Failed to load rating proofs - connection timeout'
      );

      if (result.error) throw result.error;
      setProofs(result.data || []);
    } catch (error) {
      Logger.error('Failed to fetch rating proofs', error as Error, { playerRatingScoreId });
      toast.error(getNetworkErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const handleSelectProofType = (type: 'external_link' | 'video' | 'image' | 'document') => {
    Logger.logUserAction('select_proof_type', { type, playerRatingScoreId });
    SheetManager.hide('add-rating-proof');

    // Wait for the sheet to close before opening the next one
    setTimeout(() => {
      // Open the corresponding overlay based on type
      switch (type) {
        case 'external_link':
          SheetManager.show('external-link-proof', {
            payload: {
              onSuccess: handleProofSuccess,
              playerRatingScoreId,
            },
          });
          break;
        case 'video':
          SheetManager.show('video-proof', {
            payload: {
              onSuccess: handleProofSuccess,
              playerRatingScoreId,
            },
          });
          break;
        case 'image':
          SheetManager.show('image-proof', {
            payload: {
              onSuccess: handleProofSuccess,
              playerRatingScoreId,
            },
          });
          break;
        case 'document':
          SheetManager.show('document-proof', {
            payload: {
              onSuccess: handleProofSuccess,
              playerRatingScoreId,
            },
          });
          break;
      }
    }, 300); // Wait for sheet close animation to complete
  };

  const handleProofSuccess = () => {
    // Refresh the list after successfully adding a proof
    fetchProofs();
  };

  const handleEditProof = (proof: RatingProofWithFile) => {
    lightHaptic();
    Logger.logUserAction('edit_proof_pressed', { proofId: proof.id, playerRatingScoreId });
    SheetManager.show('edit-proof', {
      payload: {
        proof,
        onSuccess: handleProofSuccess,
      },
    });
  };

  const handleDeleteProof = async (proofId: string) => {
    warningHaptic();
    Alert.alert(
      'Delete Proof',
      'Are you sure you want to delete this proof? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const result = await withTimeout(
                (async () =>
                  supabase.from('rating_proof').update({ is_active: false }).eq('id', proofId))(),
                10000,
                'Failed to delete proof - connection timeout'
              );

              if (result.error) throw result.error;

              toast.success('Proof deleted successfully');
              fetchProofs();
            } catch (error) {
              Logger.error('Failed to delete proof', error as Error, {
                proofId,
                playerRatingScoreId,
              });
              toast.error(getNetworkErrorMessage(error));
            }
          },
        },
      ]
    );
  };

  const getProofTypeBadge = (proof: RatingProofWithFile) => {
    if (proof.proof_type === 'external_link') {
      return 'External Link';
    }
    if (proof.file) {
      switch (proof.file.file_type) {
        case 'video':
          return 'Video Recording';
        case 'image':
          return 'Image';
        case 'document':
          return 'Official Rating';
        default:
          return 'File';
      }
    }
    return 'Proof';
  };

  const getVerificationBadge = (proofStatus: string) => {
    switch (proofStatus) {
      case 'approved':
        return { text: 'Verified', color: status.success.DEFAULT };
      case 'rejected':
        return { text: 'Rejected', color: status.error.DEFAULT };
      case 'pending':
        return { text: 'Unverified', color: status.warning.DEFAULT };
      default:
        return { text: 'Pending', color: colors.textMuted };
    }
  };

  // Handle tapping on proof preview to view full content
  const handleViewProof = async (proof: RatingProofWithRatingScore) => {
    lightHaptic();
    if (proof.proof_type === 'external_link' && proof.external_url) {
      try {
        await Linking.openURL(proof.external_url);
      } catch (error) {
        Logger.error('Failed to open external URL', error as Error, { url: proof.external_url });
        toast.error(t('common.error'));
      }
    } else if (proof.file?.url) {
      // For files, navigate to a viewer or open the URL
      try {
        await Linking.openURL(proof.file.url);
      } catch (error) {
        Logger.error('Failed to open file URL', error as Error, { url: proof.file.url });
        toast.error(t('common.error'));
      }
    }
  };

  // Render preview thumbnail based on proof type
  const renderProofPreview = (proof: RatingProofWithRatingScore) => {
    if (proof.proof_type === 'external_link') {
      // External link preview
      return (
        <TouchableOpacity
          style={[styles.previewContainer, { backgroundColor: colors.background }]}
          onPress={() => handleViewProof(proof)}
          activeOpacity={0.8}
        >
          <View style={[styles.linkPreview, { borderColor: colors.border }]}>
            <Ionicons name="link" size={28} color={colors.primary} />
            <Text size="sm" color={colors.textMuted} numberOfLines={1} style={styles.linkText}>
              {proof.external_url}
            </Text>
            <Ionicons name="open-outline" size={18} color={colors.textMuted} />
          </View>
        </TouchableOpacity>
      );
    }

    if (proof.file) {
      switch (proof.file.file_type) {
        case 'image':
          return (
            <TouchableOpacity
              style={styles.previewContainer}
              onPress={() => handleViewProof(proof)}
              activeOpacity={0.8}
            >
              <Image
                source={{ uri: proof.file.url }}
                style={styles.previewImage}
                resizeMode="cover"
              />
              <View style={[styles.viewOverlay, { backgroundColor: 'rgba(0,0,0,0.3)' }]}>
                <Ionicons name="expand-outline" size={24} color="white" />
              </View>
            </TouchableOpacity>
          );
        case 'video':
          return (
            <TouchableOpacity
              style={styles.previewContainer}
              onPress={() => handleViewProof(proof)}
              activeOpacity={0.8}
            >
              {proof.file.thumbnail_url ? (
                <Image
                  source={{ uri: proof.file.thumbnail_url }}
                  style={styles.previewImage}
                  resizeMode="cover"
                />
              ) : (
                <View
                  style={[styles.videoPosterPlaceholder, { backgroundColor: colors.background }]}
                >
                  <Ionicons name="videocam" size={40} color={colors.textMuted} />
                </View>
              )}
              <View style={[styles.playOverlay, { backgroundColor: 'rgba(0,0,0,0.4)' }]}>
                <View style={[styles.playButton, { backgroundColor: colors.primary }]}>
                  <Ionicons name="play" size={24} color="white" />
                </View>
              </View>
            </TouchableOpacity>
          );
        case 'document':
          return (
            <TouchableOpacity
              style={[styles.previewContainer, { backgroundColor: colors.background }]}
              onPress={() => handleViewProof(proof)}
              activeOpacity={0.8}
            >
              <View style={[styles.documentPreview, { borderColor: colors.border }]}>
                <Ionicons name="document-text" size={36} color={colors.primary} />
                <Text size="sm" color={colors.text} numberOfLines={1} style={styles.documentName}>
                  {proof.file.original_name || t('profile.ratingProofs.proofTypes.document.title')}
                </Text>
                <Ionicons name="open-outline" size={16} color={colors.textMuted} />
              </View>
            </TouchableOpacity>
          );
        default:
          return null;
      }
    }

    return null;
  };

  const renderProofCard = ({ item }: { item: RatingProofWithRatingScore }) => {
    const verificationBadge = getVerificationBadge(item.status);

    // Get the proof's original rating label (when it was uploaded)
    const proofRatingScore = item.rating_score;
    const proofRatingLabel = proofRatingScore?.label ?? ratingValue.toFixed(1);

    // Check if this proof is for the current rating level
    const isCurrentLevelProof = item.rating_score_id === currentRatingScoreId;

    return (
      <View
        style={[
          styles.proofCard,
          { backgroundColor: colors.card, borderColor: colors.border },
          // Subtle visual distinction for old-level proofs
          !isCurrentLevelProof && { opacity: 0.85 },
        ]}
      >
        {/* Card Header */}
        <View style={styles.cardHeader}>
          <View style={styles.cardLeft}>
            <Text size="base" weight="semibold" color={colors.text}>
              {item.title}
            </Text>
            <View style={styles.dateRow}>
              <Ionicons name="calendar-outline" size={14} color={colors.textMuted} />
              <Text size="sm" color={colors.textMuted} style={styles.dateText}>
                {formatDateShort(item.created_at, locale)}
              </Text>
            </View>
          </View>

          {/* Rating Badge - shows the rating level when proof was uploaded */}
          <View style={styles.ratingBadgeContainer}>
            <View
              style={[
                styles.ratingBadge,
                { backgroundColor: isCurrentLevelProof ? colors.primary : colors.textMuted },
              ]}
            >
              <Text size="sm" weight="bold" color={colors.primaryForeground}>
                {proofRatingLabel}
              </Text>
            </View>
            {/* Show indicator if this is an old-level proof */}
            {!isCurrentLevelProof && (
              <Text size="xs" color={colors.textMuted} style={styles.oldLevelText}>
                {t('profile.rating.previousLevel')}
              </Text>
            )}
          </View>
        </View>

        {/* Badges Row */}
        <View style={styles.badgesRow}>
          <View style={[styles.typeBadge, { backgroundColor: colors.primary }]}>
            <Text size="xs" weight="medium" color={colors.primaryForeground}>
              {getProofTypeBadge(item)}
            </Text>
          </View>
          <View style={[styles.verificationBadge, { backgroundColor: verificationBadge.color }]}>
            <Text size="xs" weight="medium" color={colors.primaryForeground}>
              {verificationBadge.text}
            </Text>
          </View>
          {/* Current level indicator badge */}
          {isCurrentLevelProof && (
            <View style={[styles.currentLevelBadge, { backgroundColor: status.success.DEFAULT }]}>
              <Text size="xs" weight="medium" color={colors.primaryForeground}>
                {t('profile.rating.currentLevel')}
              </Text>
            </View>
          )}
        </View>

        {/* Proof Preview */}
        {renderProofPreview(item)}

        {/* Action Icons */}
        {isOwnProfile && (
          <View style={styles.actionIcons}>
            <TouchableOpacity style={styles.iconButton} onPress={() => handleEditProof(item)}>
              <Ionicons name="pencil" size={20} color={colors.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconButton} onPress={() => handleDeleteProof(item.id)}>
              <Ionicons name="trash-outline" size={20} color={colors.error} />
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  const renderEmptyState = () => (
    <View style={styles.emptyContainer}>
      <Ionicons name="folder-open-outline" size={64} color={colors.textMuted} />
      <Text size="lg" weight="semibold" color={colors.textMuted} style={styles.emptyTitle}>
        {t('profile.ratingProofs.noProofsYet')}
      </Text>
      <Text size="sm" color={colors.textMuted} style={styles.emptyText}>
        {isOwnProfile
          ? t('profile.ratingProofs.noProofsDescription')
          : t('profile.ratingProofs.noProofsOtherUser')}
      </Text>
      {isOwnProfile && (
        <Button variant="primary" onPress={handleAddProof} style={styles.emptyButton}>
          {t('profile.ratingProofs.addFirstProof')}
        </Button>
      )}
    </View>
  );

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={getSafeAreaEdges(['bottom'])}
    >
      {/* Content */}
      {loading ? (
        <View style={[styles.loadingContainer, { backgroundColor: colors.card }]}>
          {/* Rating Proofs Skeleton */}
          <View style={[styles.titleSection, { backgroundColor: colors.card }]}>
            <Skeleton
              width={140}
              height={20}
              borderRadius={4}
              backgroundColor={colors.cardBackground}
              highlightColor={colors.border}
            />
          </View>
          <View style={{ padding: 16, gap: 12 }}>
            {[...Array(3)].map((_, index) => (
              <View key={index} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Skeleton
                  width={60}
                  height={60}
                  borderRadius={8}
                  backgroundColor={colors.cardBackground}
                  highlightColor={colors.border}
                />
                <View style={{ flex: 1 }}>
                  <Skeleton
                    width={150}
                    height={16}
                    borderRadius={4}
                    backgroundColor={colors.cardBackground}
                    highlightColor={colors.border}
                  />
                  <Skeleton
                    width={100}
                    height={14}
                    borderRadius={4}
                    backgroundColor={colors.cardBackground}
                    highlightColor={colors.border}
                    style={{ marginTop: 4 }}
                  />
                </View>
              </View>
            ))}
          </View>
        </View>
      ) : (
        <View style={[styles.content, { backgroundColor: colors.card }]}>
          {/* Title Section */}
          <View style={[styles.titleSection, { backgroundColor: colors.card }]}>
            <Text size="lg" weight="bold" color={colors.text}>
              {t('profile.ratingProofs.myProofs')}
            </Text>
          </View>

          {/* Info Box - Only show for own profile */}
          {isOwnProfile && (
            <View style={[styles.infoBox, { backgroundColor: isDark ? '#1C1C1E' : '#F2F2F7' }]}>
              <Ionicons name="information-circle-outline" size={20} color={colors.primary} />
              <Text size="sm" style={{ color: colors.textMuted, flex: 1, marginLeft: 8 }}>
                {t('profile.ratingProofs.infoMessage')}
              </Text>
            </View>
          )}

          {/* Proofs List */}
          <FlatList
            data={proofs}
            renderItem={renderProofCard}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={renderEmptyState}
            showsVerticalScrollIndicator={false}
          />
        </View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  titleSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacingPixels[5],
    paddingVertical: spacingPixels[4],
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: spacingPixels[3],
    marginHorizontal: spacingPixels[5],
    marginBottom: spacingPixels[3],
    borderRadius: radiusPixels.lg,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    paddingHorizontal: spacingPixels[5],
    paddingBottom: spacingPixels[5],
  },
  proofCard: {
    borderRadius: radiusPixels.xl,
    padding: spacingPixels[4],
    marginBottom: spacingPixels[3],
    ...shadowsNative.sm,
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
    borderWidth: 1,
    // borderColor will be set dynamically using colors.border
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: spacingPixels[3],
  },
  cardLeft: {
    flex: 1,
    marginRight: spacingPixels[3],
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacingPixels[1],
  },
  dateText: {
    marginLeft: spacingPixels[1],
  },
  ratingBadgeContainer: {
    alignItems: 'center',
  },
  ratingBadge: {
    minWidth: spacingPixels[9],
    height: spacingPixels[9],
    paddingHorizontal: spacingPixels[2],
    borderRadius: radiusPixels.full,
    justifyContent: 'center',
    alignItems: 'center',
  },
  oldLevelText: {
    marginTop: spacingPixels[1],
    textAlign: 'center',
  },
  currentLevelBadge: {
    paddingHorizontal: spacingPixels[2.5],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.xl,
  },
  badgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    marginBottom: spacingPixels[3],
  },
  typeBadge: {
    paddingHorizontal: spacingPixels[2.5],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.xl,
  },
  verificationBadge: {
    paddingHorizontal: spacingPixels[2.5],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.xl,
  },
  actionIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacingPixels[4],
    marginTop: spacingPixels[3],
  },
  iconButton: {
    width: spacingPixels[8],
    height: spacingPixels[8],
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Preview styles
  previewContainer: {
    width: '100%',
    height: 140,
    borderRadius: radiusPixels.md,
    overflow: 'hidden',
    marginBottom: spacingPixels[2],
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  viewOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    padding: spacingPixels[2],
    borderBottomLeftRadius: radiusPixels.md,
  },
  playOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoPosterPlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkPreview: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[4],
    gap: spacingPixels[3],
    borderWidth: 1,
    borderRadius: radiusPixels.md,
    borderStyle: 'dashed',
  },
  linkText: {
    flex: 1,
  },
  documentPreview: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacingPixels[4],
    gap: spacingPixels[2],
    borderWidth: 1,
    borderRadius: radiusPixels.md,
    borderStyle: 'dashed',
  },
  documentName: {
    maxWidth: '80%',
    textAlign: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[8],
    paddingVertical: 60, // 15 * 4px base unit
  },
  emptyTitle: {
    marginTop: spacingPixels[4],
    marginBottom: spacingPixels[2],
  },
  emptyText: {
    textAlign: 'center',
    lineHeight: fontSizePixels.sm * 1.43,
    marginBottom: spacingPixels[6],
  },
  emptyButton: {
    minWidth: 200, // 50 * 4px base unit
  },
});

export default RatingProofs;
