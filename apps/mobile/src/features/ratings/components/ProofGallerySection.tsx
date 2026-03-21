/**
 * ProofGallerySection Component
 *
 * A modern, professional gallery section for displaying rating proofs.
 * Shows a grid of proof thumbnails with type indicators.
 * Tapping opens a full-screen viewer for videos, images, documents, or links.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Image,
  FlatList,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Text } from '@rallia/shared-components';
import { supabase, Logger } from '@rallia/shared-services';
import { useThemeStyles, useTranslation } from '../../../hooks';
import { withTimeout } from '../../../utils/networkTimeout';
import { resolveStorageUrl, isPrivateBucketUrl } from '../../../services/imageUpload';
import ProofViewer from './ProofViewer';
import {
  spacingPixels,
  radiusPixels,
  fontSizePixels,
  fontWeightNumeric,
} from '@rallia/design-system';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
// Account for parent's padding (spacingPixels[4] * 2) and gap between cards (spacingPixels[2])
const CARD_WIDTH = (SCREEN_WIDTH - spacingPixels[4] * 2 - spacingPixels[2]) / 2;
const CARD_HEIGHT = CARD_WIDTH * 0.75;

interface RatingProofData {
  id: string;
  proof_type: 'external_link' | 'video' | 'image' | 'document';
  title: string;
  description: string | null;
  external_url: string | null;
  status: string;
  created_at: string;
  file?: {
    id: string;
    url: string;
    thumbnail_url: string | null;
    file_type: string;
    original_name: string;
    mime_type: string;
  } | null;
}

interface ProofGallerySectionProps {
  playerRatingScoreId: string;
  sportName?: string;
  onProofsCountChange?: (count: number) => void;
}

const ProofGallerySection: React.FC<ProofGallerySectionProps> = ({
  playerRatingScoreId,
  sportName: _sportName,
  onProofsCountChange,
}) => {
  const { colors } = useThemeStyles();
  const { t } = useTranslation();
  const [proofs, setProofs] = useState<RatingProofData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProof, setSelectedProof] = useState<RatingProofData | null>(null);
  const [showViewer, setShowViewer] = useState(false);
  // Cache of resolved signed URLs keyed by original URL
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});

  const fetchProofs = useCallback(async () => {
    if (!playerRatingScoreId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const result = await withTimeout(
        (async () =>
          supabase
            .from('rating_proof')
            .select(
              `
              id,
              proof_type,
              title,
              description,
              external_url,
              status,
              created_at,
              file:file_id(id, url, thumbnail_url, file_type, original_name, mime_type)
            `
            )
            .eq('player_rating_score_id', playerRatingScoreId)
            .eq('is_active', true)
            .eq('status', 'approved')
            .order('created_at', { ascending: false })
            .limit(10))(),
        15000,
        'Failed to load proofs'
      );

      if (result.error) throw result.error;

      // Map the result to our expected structure (file is returned as array from Supabase)
      const proofsData = (result.data || []).map((item: Record<string, unknown>) => ({
        ...item,
        file: Array.isArray(item.file) && item.file.length > 0 ? item.file[0] : item.file,
      })) as RatingProofData[];
      setProofs(proofsData);
      onProofsCountChange?.(proofsData.length);
    } catch (error) {
      Logger.error('Failed to fetch proofs for gallery', error as Error, { playerRatingScoreId });
    } finally {
      setLoading(false);
    }
  }, [playerRatingScoreId, onProofsCountChange]);

  useEffect(() => {
    fetchProofs();
  }, [fetchProofs]);

  // Resolve signed URLs for private bucket thumbnails
  useEffect(() => {
    if (proofs.length === 0) return;

    const urlsToResolve: string[] = [];
    for (const proof of proofs) {
      const fileType = proof.file?.file_type || proof.proof_type;
      const url = proof.file?.thumbnail_url || (fileType === 'image' ? proof.file?.url : null);
      if (url && isPrivateBucketUrl(url) && !signedUrls[url]) {
        urlsToResolve.push(url);
      }
    }

    if (urlsToResolve.length === 0) return;

    let cancelled = false;
    Promise.all(
      urlsToResolve.map(url => resolveStorageUrl(url).then(signed => ({ original: url, signed })))
    ).then(results => {
      if (cancelled) return;
      const newUrls: Record<string, string> = {};
      for (const { original, signed } of results) {
        newUrls[original] = signed;
      }
      setSignedUrls(prev => ({ ...prev, ...newUrls }));
    });

    return () => {
      cancelled = true;
    };
  }, [proofs]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleProofPress = (proof: RatingProofData) => {
    setSelectedProof(proof);
    setShowViewer(true);
  };

  const getProofIcon = (type: string) => {
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

  const getProofColor = (type: string) => {
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

  const getThumbnail = (proof: RatingProofData) => {
    // Use thumbnail_url if available, otherwise use full url for images
    // Note: proof_type is 'file' for all file-based proofs; actual type is in file.file_type
    const fileType = proof.file?.file_type || proof.proof_type;
    const url = proof.file?.thumbnail_url || (fileType === 'image' ? proof.file?.url : null);
    if (!url) return null;
    // For private buckets, only return the signed URL (null while resolving)
    if (isPrivateBucketUrl(url)) {
      return signedUrls[url] || null;
    }
    return url;
  };

  const renderProofCard = ({ item }: { item: RatingProofData }) => {
    const thumbnail = getThumbnail(item);
    const typeColor = getProofColor(item.proof_type);

    return (
      <TouchableOpacity
        style={[styles.proofCard, { backgroundColor: colors.card }]}
        onPress={() => handleProofPress(item)}
        activeOpacity={0.8}
      >
        {thumbnail ? (
          <Image source={{ uri: thumbnail }} style={styles.thumbnail} resizeMode="cover" />
        ) : (
          <View style={[styles.placeholderThumbnail, { backgroundColor: `${typeColor}20` }]}>
            <Ionicons name={getProofIcon(item.proof_type)} size={40} color={typeColor} />
          </View>
        )}

        {/* Gradient overlay */}
        <LinearGradient colors={['transparent', 'rgba(0,0,0,0.7)']} style={styles.gradient} />

        {/* Type badge */}
        <View style={[styles.typeBadge, { backgroundColor: typeColor }]}>
          <Ionicons name={getProofIcon(item.proof_type)} size={12} color="#fff" />
        </View>

        {/* Play button for videos */}
        {item.proof_type === 'video' && (
          <View style={styles.playButtonContainer}>
            <View style={styles.playButton}>
              <Ionicons name="play" size={24} color="#fff" />
            </View>
          </View>
        )}

        {/* Title overlay */}
        <View style={styles.titleOverlay}>
          <Text style={styles.proofTitle} numberOfLines={2}>
            {item.title}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderEmptyState = () => (
    <View style={[styles.emptyState, { backgroundColor: colors.card }]}>
      <View style={[styles.emptyIconContainer, { backgroundColor: `${colors.primary}15` }]}>
        <Ionicons name="shield-checkmark-outline" size={32} color={colors.primary} />
      </View>
      <Text style={[styles.emptyTitle, { color: colors.text }]}>
        {t('profile.ratingProofs.gallery.noProofsTitle')}
      </Text>
      <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>
        {t('profile.ratingProofs.gallery.noProofsDescription')}
      </Text>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Ionicons name="documents-outline" size={18} color={colors.primary} />
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            {t('profile.ratingProofs.gallery.title')}
          </Text>
        </View>
        <View style={[styles.loadingContainer, { backgroundColor: colors.card }]}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      </View>
    );
  }

  if (proofs.length === 0) {
    return (
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Ionicons name="documents-outline" size={18} color={colors.primary} />
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            {t('profile.ratingProofs.gallery.title')}
          </Text>
        </View>
        {renderEmptyState()}
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Ionicons name="documents-outline" size={18} color={colors.primary} />
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          {t('profile.ratingProofs.gallery.title')}
        </Text>
        <View style={[styles.countBadge, { backgroundColor: `${colors.primary}20` }]}>
          <Text style={[styles.countText, { color: colors.primary }]}>{proofs.length}</Text>
        </View>
      </View>

      {/* Grid */}
      <FlatList
        data={proofs}
        renderItem={renderProofCard}
        keyExtractor={item => item.id}
        numColumns={2}
        scrollEnabled={false}
        contentContainerStyle={styles.grid}
        columnWrapperStyle={styles.row}
        extraData={signedUrls}
      />

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
    flex: 1,
  },
  countBadge: {
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.full,
    minWidth: 24,
    alignItems: 'center',
  },
  countText: {
    fontSize: fontSizePixels.xs,
    fontWeight: fontWeightNumeric.bold,
  },
  grid: {},
  row: {
    justifyContent: 'space-between',
    marginBottom: spacingPixels[2],
  },
  proofCard: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: radiusPixels.lg,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
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
    top: spacingPixels[2],
    right: spacingPixels[2],
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
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
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingLeft: 4, // Optical centering for play icon
  },
  titleOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: spacingPixels[2],
  },
  proofTitle: {
    color: '#fff',
    fontSize: fontSizePixels.xs,
    fontWeight: fontWeightNumeric.medium,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  loadingContainer: {
    height: CARD_HEIGHT,
    borderRadius: radiusPixels.lg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyState: {
    borderRadius: radiusPixels.lg,
    padding: spacingPixels[6],
    alignItems: 'center',
  },
  emptyIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacingPixels[3],
  },
  emptyTitle: {
    fontSize: fontSizePixels.base,
    fontWeight: fontWeightNumeric.semibold,
    marginBottom: spacingPixels[1],
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: fontSizePixels.sm,
    textAlign: 'center',
    lineHeight: fontSizePixels.sm * 1.4,
  },
});

export default ProofGallerySection;
