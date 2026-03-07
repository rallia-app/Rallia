/**
 * PortfolioSection Component
 *
 * A gallery section for displaying all user's rating proofs.
 * Organizes proofs by type: videos, photos, and documents.
 * Includes sport toggle for users with multiple sports.
 * Matches UserProfile section styling.
 */

import React, { useState, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, Image, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Text, Skeleton } from '@rallia/shared-components';
import { useThemeStyles, useTranslation } from '../../hooks';
import ProofViewer from '../ratings/components/ProofViewer';
import {
  spacingPixels,
  radiusPixels,
  fontSizePixels,
  fontWeightNumeric,
  shadowsNative,
} from '@rallia/design-system';

// Horizontal scroll card dimensions
const CARD_WIDTH = 120;
const CARD_HEIGHT = 150;

export interface PortfolioProof {
  id: string;
  proof_type: 'external_link' | 'video' | 'image' | 'document';
  title: string;
  description: string | null;
  external_url: string | null;
  status: string;
  created_at: string;
  sport_id?: string;
  sport_name?: string;
  file?: {
    id: string;
    url: string;
    thumbnail_url: string | null;
    file_type: string;
    original_name: string;
    mime_type: string;
  } | null;
}

export interface PortfolioSport {
  id: string;
  display_name: string;
}

interface PortfolioSectionProps {
  proofs: PortfolioProof[];
  sports: PortfolioSport[];
  loading: boolean;
  skeletonBg: string;
  skeletonHighlight: string;
}

const PortfolioSection: React.FC<PortfolioSectionProps> = ({
  proofs,
  sports,
  loading,
  skeletonBg,
  skeletonHighlight,
}) => {
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const [selectedProof, setSelectedProof] = useState<PortfolioProof | null>(null);
  const [showViewer, setShowViewer] = useState(false);
  const [selectedSportId, setSelectedSportId] = useState<string | null>(null);

  // Filter proofs by selected sport
  const filteredProofs = useMemo(() => {
    if (selectedSportId === null) {
      return proofs;
    }
    return proofs.filter(p => p.sport_id === selectedSportId);
  }, [proofs, selectedSportId]);

  // Helper to get effective type - use file.file_type for file-based proofs
  const getEffectiveType = (proof: PortfolioProof): string => {
    if (proof.proof_type === 'external_link') return 'external_link';
    if (proof.file?.file_type) return proof.file.file_type;
    return proof.proof_type || 'unknown';
  };

  // Debug: log proof types to diagnose categorization issues
  if (__DEV__ && proofs.length > 0) {
    console.log('[Portfolio] Proofs received:', proofs.length);
    console.log(
      '[Portfolio] Proof details:',
      proofs.map(p => ({
        id: p.id,
        proof_type: p.proof_type,
        file_type: p.file?.file_type,
        effective_type: getEffectiveType(p),
        title: p.title,
        has_file: !!p.file,
        file_url: p.file?.url?.substring(0, 50),
      }))
    );
  }

  // Group proofs by effective type (file.file_type takes precedence for file-based proofs)
  const videoProofs = filteredProofs.filter(p => getEffectiveType(p) === 'video');
  const imageProofs = filteredProofs.filter(p => getEffectiveType(p) === 'image');
  const linkProofs = filteredProofs.filter(p => getEffectiveType(p) === 'external_link');
  const documentProofs = filteredProofs.filter(p => getEffectiveType(p) === 'document');
  // Fallback for any proofs that don't match known types
  const otherProofs = filteredProofs.filter(
    p => !['video', 'image', 'document', 'external_link'].includes(getEffectiveType(p))
  );

  const totalCount = filteredProofs.length;
  // Show sport toggle when user has multiple active sports
  const showSportToggle = sports.length > 1;

  const handleProofPress = (proof: PortfolioProof) => {
    setSelectedProof(proof);
    setShowViewer(true);
  };

  const getProofIcon = (proof: PortfolioProof): keyof typeof Ionicons.glyphMap => {
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

  const getProofColor = (proof: PortfolioProof) => {
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

  const getThumbnail = (proof: PortfolioProof) => {
    // For images, use the URL directly
    if (proof.file?.file_type === 'image' && proof.file?.url) {
      return proof.file.url;
    }
    // For videos, use the thumbnail_url if available
    if (proof.file?.file_type === 'video' && proof.file?.thumbnail_url) {
      return proof.file.thumbnail_url;
    }
    // Fallback: any thumbnail_url
    if (proof.file?.thumbnail_url) {
      return proof.file.thumbnail_url;
    }
    return null;
  };

  const renderProofCard = ({ item }: { item: PortfolioProof }) => {
    const thumbnail = getThumbnail(item);
    const typeColor = getProofColor(item);
    const statusColor = getStatusColor(item.status);
    const effectiveType = getEffectiveType(item);

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
        {item.status !== 'approved' && (
          <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
            <Text style={styles.statusText}>
              {item.status === 'pending' ? t('profile.ratingProofs.status.pending') : item.status}
            </Text>
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
      </TouchableOpacity>
    );
  };

  const renderCategorySection = (
    title: string,
    icon: keyof typeof Ionicons.glyphMap,
    categoryProofs: PortfolioProof[],
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
        {sports.map(sport => (
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
        {t('profile.portfolio.emptyDescription')}
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
          <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>
            {t('profile.sections.portfolio')}
          </Text>
        </View>
        {renderSkeletonSection()}
      </View>
    );
  }

  const hasAnyProofs = proofs.length > 0;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>
          {t('profile.sections.portfolio')}
        </Text>
        {hasAnyProofs && (
          <View style={[styles.totalBadge, { backgroundColor: `${colors.primary}15` }]}>
            <Text style={[styles.totalBadgeText, { color: colors.primary }]}>{proofs.length}</Text>
          </View>
        )}
      </View>

      {!hasAnyProofs ? (
        renderEmptyState()
      ) : (
        <View style={[styles.card, { backgroundColor: colors.card }]}>
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
              {/* Fallback for any proof types that don't match */}
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
  // Match UserProfile section styling exactly
  section: {
    marginTop: spacingPixels[5],
    paddingHorizontal: spacingPixels[4],
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacingPixels[3],
  },
  sectionTitle: {
    fontSize: fontSizePixels.xs,
    fontWeight: fontWeightNumeric.bold,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  totalBadge: {
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[0.5],
    borderRadius: radiusPixels.full,
    minWidth: 24,
    alignItems: 'center',
  },
  totalBadgeText: {
    fontSize: fontSizePixels.xs,
    fontWeight: fontWeightNumeric.bold,
  },
  card: {
    borderRadius: radiusPixels.xl,
    padding: spacingPixels[4],
    ...shadowsNative.sm,
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
  proofCard: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: radiusPixels.lg,
    overflow: 'hidden',
    ...shadowsNative.sm,
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
  // Empty state
  emptyState: {
    borderRadius: radiusPixels.xl,
    padding: spacingPixels[5],
    alignItems: 'center',
    ...shadowsNative.sm,
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

export default PortfolioSection;
