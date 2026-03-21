import React, { useState, useEffect, useLayoutEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  Image,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useVideoThumbnail } from '../hooks/useVideoThumbnail';
import { Text, Button, Skeleton, useToast } from '@rallia/shared-components';
import { lightHaptic, warningHaptic } from '@rallia/shared-utils';
import { supabase, Logger } from '@rallia/shared-services';
import { RatingProofWithFile, RatingProofsScreenParams } from '@rallia/shared-types';
import { SheetManager } from 'react-native-actions-sheet';
import { withTimeout, getNetworkErrorMessage } from '../utils/networkTimeout';
import { useThemeStyles, useTranslation } from '../hooks';
import { resolveStorageUrl, isPrivateBucketUrl } from '../services/imageUpload';
import RatingBadge from '../components/RatingBadge';
import ProofViewer from '../features/ratings/components/ProofViewer';
import { formatDateShort } from '../utils/dateFormatting';
import { spacingPixels, radiusPixels, fontSizePixels, status } from '@rallia/design-system';

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

/** Resolve a storage URL to a signed URL if it's in a private bucket. */
function useSignedUrl(url: string | null | undefined): string | null {
  const [signed, setSigned] = useState<string | null>(null);
  useEffect(() => {
    if (!url) {
      setSigned(null);
      return;
    }
    if (!isPrivateBucketUrl(url)) {
      setSigned(url);
      return;
    }
    let cancelled = false;
    resolveStorageUrl(url).then(resolved => {
      if (!cancelled) setSigned(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);
  return signed;
}

/** Image preview with signed URL resolution for private buckets. */
const ImagePreview: React.FC<{
  imageUrl: string;
  onPress: () => void;
}> = ({ imageUrl, onPress }) => {
  const resolvedUrl = useSignedUrl(imageUrl);

  return (
    <TouchableOpacity style={styles.previewContainer} onPress={onPress} activeOpacity={0.8}>
      {resolvedUrl ? (
        <Image source={{ uri: resolvedUrl }} style={styles.previewImage} resizeMode="cover" />
      ) : (
        <View style={[styles.previewImage, { justifyContent: 'center', alignItems: 'center' }]}>
          <ActivityIndicator size="small" />
        </View>
      )}
      <LinearGradient colors={['transparent', 'rgba(0,0,0,0.5)']} style={styles.imageGradient}>
        <View style={styles.imageExpandHint}>
          <Ionicons name="expand-outline" size={16} color="white" />
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );
};

/** Small wrapper so the useVideoThumbnail hook can be called per video card. */
const VideoThumbnailPreview: React.FC<{
  videoUrl: string;
  existingThumbnail: string | null;
  primaryColor: string;
  onPress: () => void;
}> = ({ videoUrl, existingThumbnail, primaryColor, onPress }) => {
  const resolvedVideoUrl = useSignedUrl(videoUrl);
  const resolvedThumbnail = useSignedUrl(existingThumbnail);
  const generatedThumbnail = useVideoThumbnail(resolvedThumbnail ? null : resolvedVideoUrl);
  const thumbnailUri = resolvedThumbnail || generatedThumbnail;

  return (
    <TouchableOpacity style={styles.previewContainer} onPress={onPress} activeOpacity={0.8}>
      {thumbnailUri ? (
        <Image source={{ uri: thumbnailUri }} style={styles.previewImage} resizeMode="cover" />
      ) : (
        <View style={[styles.videoPosterPlaceholder, { backgroundColor: primaryColor + '10' }]}>
          <Ionicons name="videocam" size={32} color={primaryColor + '40'} />
        </View>
      )}
      <View style={styles.playOverlay}>
        <View style={[styles.playButton, { backgroundColor: primaryColor }]}>
          <Ionicons name="play" size={22} color="white" style={{ marginLeft: 2 }} />
        </View>
      </View>
    </TouchableOpacity>
  );
};

const RatingProofs: React.FC = () => {
  const navigation = useNavigation();
  const route = useRoute<RatingProofsRouteProp>();
  const { playerRatingScoreId, ratingValue, isOwnProfile } = route.params;
  const { colors, isDark } = useThemeStyles();
  const { t, locale } = useTranslation();
  const toast = useToast();

  const [proofs, setProofs] = useState<RatingProofWithRatingScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter] = useState<'all' | 'approved' | 'pending' | 'rejected'>('all');
  const [selectedProof, setSelectedProof] = useState<RatingProofWithRatingScore | null>(null);
  const [showViewer, setShowViewer] = useState(false);

  // Define handleAddProof before useLayoutEffect that uses it
  const handleAddProof = useCallback(() => {
    lightHaptic();
    SheetManager.show('add-rating-proof', {
      payload: {
        playerRatingScoreId,
        onSuccess: () => fetchProofs(),
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerRatingScoreId]);

  // Configure header title and right button
  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: t('profile.ratingProofs.myProofs'),
      headerRight: isOwnProfile
        ? () => (
            <TouchableOpacity onPress={handleAddProof} style={{ marginRight: spacingPixels[2] }}>
              <Ionicons name="add-outline" size={28} color={colors.headerForeground} />
            </TouchableOpacity>
          )
        : undefined,
    });
  }, [isOwnProfile, navigation, colors.headerForeground, handleAddProof, t]);

  useEffect(() => {
    fetchProofs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerRatingScoreId, filter]);

  const fetchProofs = async () => {
    setLoading(true);
    try {
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

  const handleEditProof = (proof: RatingProofWithFile) => {
    lightHaptic();
    Logger.logUserAction('edit_proof_pressed', { proofId: proof.id, playerRatingScoreId });
    SheetManager.show('edit-proof', {
      payload: {
        proof,
        onSuccess: () => fetchProofs(),
      },
    });
  };

  const handleDeleteProof = async (proofId: string) => {
    warningHaptic();
    Alert.alert(t('profile.ratingProofs.delete.title'), t('profile.ratingProofs.delete.confirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
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

            toast.success(t('profile.ratingProofs.delete.success'));
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
    ]);
  };

  const getProofTypeBadge = (proof: RatingProofWithFile) => {
    if (proof.proof_type === 'external_link') {
      return t('profile.ratingProofs.proofTypes.externalLink.title');
    }
    if (proof.file) {
      switch (proof.file.file_type) {
        case 'video':
          return t('profile.ratingProofs.proofTypes.video.title');
        case 'image':
          return t('profile.ratingProofs.proofTypes.image.title');
        case 'document':
          return t('profile.ratingProofs.proofTypes.document.title');
        default:
          return t('profile.ratingProofs.title');
      }
    }
    return t('profile.ratingProofs.title');
  };

  const getVerificationBadge = (proofStatus: string) => {
    switch (proofStatus) {
      case 'approved':
        return { text: t('profile.ratingProofs.status.approved'), color: status.success.DEFAULT };
      case 'rejected':
        return { text: t('profile.ratingProofs.status.rejected'), color: status.error.DEFAULT };
      case 'pending':
        return { text: t('profile.ratingProofs.status.unverified'), color: status.warning.DEFAULT };
      default:
        return { text: t('profile.ratingProofs.status.pending'), color: colors.textMuted };
    }
  };

  // Handle tapping on proof preview to view full content
  const handleViewProof = (proof: RatingProofWithRatingScore) => {
    lightHaptic();
    setSelectedProof(proof);
    setShowViewer(true);
  };

  // Render preview thumbnail based on proof type
  const renderProofPreview = (proof: RatingProofWithRatingScore) => {
    // External link — compact link preview row
    if (proof.proof_type === 'external_link' && proof.external_url) {
      const displayUrl = proof.external_url.replace(/^https?:\/\//, '').replace(/\/$/, '');

      return (
        <TouchableOpacity
          style={[styles.linkPreview, { backgroundColor: colors.background }]}
          onPress={() => Linking.openURL(proof.external_url!)}
          activeOpacity={0.7}
        >
          <View style={[styles.linkIconContainer, { backgroundColor: colors.primary + '15' }]}>
            <Ionicons name="link" size={18} color={colors.primary} />
          </View>
          <Text size="sm" color={colors.text} numberOfLines={1} style={styles.linkUrl}>
            {displayUrl}
          </Text>
          <Ionicons name="open-outline" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      );
    }

    if (proof.file) {
      switch (proof.file.file_type) {
        case 'image':
          return <ImagePreview imageUrl={proof.file.url} onPress={() => handleViewProof(proof)} />;
        case 'video':
          return (
            <VideoThumbnailPreview
              videoUrl={proof.file.url}
              existingThumbnail={proof.file.thumbnail_url}
              primaryColor={colors.primary}
              onPress={() => handleViewProof(proof)}
            />
          );
        case 'document':
          return (
            <TouchableOpacity
              style={[styles.documentRow, { backgroundColor: colors.background }]}
              onPress={() => handleViewProof(proof)}
              activeOpacity={0.7}
            >
              <View
                style={[styles.documentIconContainer, { backgroundColor: colors.primary + '15' }]}
              >
                <Ionicons name="document-text" size={20} color={colors.primary} />
              </View>
              <View style={styles.documentInfo}>
                <Text size="sm" weight="medium" color={colors.text} numberOfLines={1}>
                  {proof.file.original_name || t('profile.ratingProofs.proofTypes.document.title')}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          );
        default:
          return null;
      }
    }

    return null;
  };

  const getProofTypeIcon = (proof: RatingProofWithFile): string => {
    if (proof.proof_type === 'external_link') return 'link-outline';
    if (proof.file) {
      switch (proof.file.file_type) {
        case 'video':
          return 'videocam-outline';
        case 'image':
          return 'image-outline';
        case 'document':
          return 'document-text-outline';
        default:
          return 'attach-outline';
      }
    }
    return 'attach-outline';
  };

  const getVerificationIcon = (proofStatus: string): string => {
    switch (proofStatus) {
      case 'approved':
        return 'checkmark-circle';
      case 'rejected':
        return 'close-circle';
      default:
        return 'time-outline';
    }
  };

  const renderProofCard = ({ item }: { item: RatingProofWithRatingScore }) => {
    const verificationBadge = getVerificationBadge(item.status);

    // Get the proof's original rating label (when it was uploaded)
    const proofRatingScore = item.rating_score;
    const proofRatingLabel = proofRatingScore?.label ?? ratingValue.toFixed(1);

    return (
      <TouchableOpacity
        style={[
          styles.proofCard,
          {
            backgroundColor: colors.cardBackground,
            borderColor: colors.border,
            shadowColor: isDark ? 'transparent' : '#000',
          },
        ]}
        onPress={() => handleViewProof(item)}
        activeOpacity={0.7}
      >
        {/* Top row: title + verification status badge */}
        <View style={styles.topRow}>
          <Text
            size="base"
            weight="semibold"
            color={colors.text}
            style={styles.cardTitle}
            numberOfLines={1}
          >
            {item.title}
          </Text>
          <RatingBadge
            ratingValue={proofRatingScore?.value}
            ratingLabel={proofRatingLabel}
            isDark={isDark}
            size="sm"
          />
          <View style={[styles.statusBadge, { backgroundColor: verificationBadge.color + '18' }]}>
            <Ionicons
              name={getVerificationIcon(item.status) as any}
              size={14}
              color={verificationBadge.color}
            />
            <Text size="xs" weight="medium" color={verificationBadge.color}>
              {verificationBadge.text}
            </Text>
          </View>
        </View>

        {/* Info rows */}
        <View style={styles.infoRow}>
          <Ionicons name={getProofTypeIcon(item) as any} size={14} color={colors.textMuted} />
          <Text size="sm" color={colors.textMuted} style={styles.infoText}>
            {getProofTypeBadge(item)}
          </Text>
        </View>

        <View style={styles.infoRow}>
          <Ionicons name="calendar-outline" size={14} color={colors.textMuted} />
          <Text size="sm" color={colors.textMuted} style={styles.infoText}>
            {formatDateShort(item.created_at, locale)}
          </Text>
        </View>

        {/* Proof Preview */}
        {renderProofPreview(item)}

        {/* Action buttons row */}
        {isOwnProfile && (
          <View style={[styles.actionRow, { borderTopColor: colors.border }]}>
            <Button
              variant="ghost"
              size="xs"
              style={styles.actionButton}
              onPress={() => handleEditProof(item)}
              leftIcon={<Ionicons name="create-outline" size={14} color={colors.textMuted} />}
              isDark={isDark}
              textStyle={{ color: colors.textMuted }}
            >
              {t('common.edit')}
            </Button>
            <Button
              variant="ghost"
              size="xs"
              style={styles.actionButton}
              destructive
              onPress={() => handleDeleteProof(item.id)}
              leftIcon={<Ionicons name="trash-outline" size={14} color={status.error.DEFAULT} />}
              isDark={isDark}
            >
              {t('common.delete')}
            </Button>
          </View>
        )}
      </TouchableOpacity>
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
      edges={['bottom']}
    >
      {/* Content */}
      {loading ? (
        <View style={styles.loadingContent}>
          {/* Proof card skeletons */}
          {[...Array(3)].map((_, index) => (
            <View
              key={index}
              style={[
                styles.proofCard,
                {
                  backgroundColor: colors.cardBackground,
                  borderColor: colors.border,
                  shadowColor: isDark ? 'transparent' : '#000',
                },
              ]}
            >
              {/* Top row: title + badge */}
              <View style={styles.topRow}>
                <Skeleton
                  width="60%"
                  height={16}
                  borderRadius={4}
                  backgroundColor={colors.background}
                  highlightColor={colors.border}
                />
                <Skeleton
                  width={60}
                  height={22}
                  borderRadius={radiusPixels.full}
                  backgroundColor={colors.background}
                  highlightColor={colors.border}
                />
              </View>

              {/* Info rows */}
              <View style={styles.infoRow}>
                <Skeleton
                  width={120}
                  height={14}
                  borderRadius={4}
                  backgroundColor={colors.background}
                  highlightColor={colors.border}
                />
              </View>
              <View style={styles.infoRow}>
                <Skeleton
                  width={90}
                  height={14}
                  borderRadius={4}
                  backgroundColor={colors.background}
                  highlightColor={colors.border}
                />
              </View>

              {/* Preview placeholder (only on first card) */}
              {index === 0 && (
                <Skeleton
                  width="100%"
                  height={140}
                  borderRadius={radiusPixels.lg}
                  backgroundColor={colors.background}
                  highlightColor={colors.border}
                  style={{ marginTop: spacingPixels[2] }}
                />
              )}
            </View>
          ))}
        </View>
      ) : (
        <FlatList
          data={proofs}
          renderItem={renderProofCard}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            isOwnProfile ? (
              <View
                style={[
                  styles.infoBox,
                  {
                    backgroundColor: status.warning.DEFAULT + '15',
                    borderColor: status.warning.DEFAULT,
                  },
                ]}
              >
                <Ionicons name="warning-outline" size={18} color={status.warning.DEFAULT} />
                <Text
                  size="sm"
                  weight="medium"
                  color={status.warning.DEFAULT}
                  style={styles.infoBoxText}
                >
                  {t('profile.ratingProofs.infoMessage')}
                </Text>
              </View>
            ) : null
          }
          ListEmptyComponent={renderEmptyState}
          showsVerticalScrollIndicator={false}
        />
      )}
      <ProofViewer
        visible={showViewer}
        onClose={() => {
          setShowViewer(false);
          setSelectedProof(null);
        }}
        proof={selectedProof as any}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContent: {
    flex: 1,
    paddingHorizontal: spacingPixels[5],
    paddingTop: spacingPixels[3],
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    marginBottom: spacingPixels[3],
    borderRadius: radiusPixels.md,
    borderWidth: 1,
  },
  infoBoxText: {
    marginLeft: spacingPixels[2],
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    paddingHorizontal: spacingPixels[5],
    paddingTop: spacingPixels[3],
    paddingBottom: spacingPixels[5],
    flexGrow: 1,
  },
  proofCard: {
    borderRadius: radiusPixels.lg,
    padding: spacingPixels[4],
    marginBottom: spacingPixels[3],
    borderWidth: 1,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    marginBottom: spacingPixels[2],
  },
  cardTitle: {
    flex: 1,
    flexShrink: 1,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[0.5],
    borderRadius: radiusPixels.full,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacingPixels[1],
  },
  infoText: {
    marginLeft: spacingPixels[2],
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacingPixels[2],
    paddingTop: spacingPixels[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'transparent', // overridden dynamically
  },
  actionButton: {
    flex: 1,
  },
  // Preview styles
  previewContainer: {
    width: '100%',
    height: 160,
    borderRadius: radiusPixels.xl,
    overflow: 'hidden',
    marginTop: spacingPixels[2],
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  imageGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 48,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    paddingHorizontal: spacingPixels[3],
    paddingBottom: spacingPixels[2],
  },
  imageExpandHint: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  playButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  videoPosterPlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Document row style
  documentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radiusPixels.xl,
    padding: spacingPixels[3],
    marginTop: spacingPixels[2],
    gap: spacingPixels[3],
  },
  documentIconContainer: {
    width: 40,
    height: 40,
    borderRadius: radiusPixels.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  documentInfo: {
    flex: 1,
  },
  // External link preview style
  linkPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radiusPixels.xl,
    padding: spacingPixels[3],
    marginTop: spacingPixels[2],
    gap: spacingPixels[3],
  },
  linkIconContainer: {
    width: 40,
    height: 40,
    borderRadius: radiusPixels.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkUrl: {
    flex: 1,
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
