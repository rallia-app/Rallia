import React, { useState, useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ActionSheet, { SheetManager, SheetProps } from 'react-native-actions-sheet';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { Text } from '@rallia/shared-components';
import { useThemeStyles, useTranslation } from '../../../hooks';
import { lightHaptic } from '@rallia/shared-utils';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import { ExternalLinkProofForm } from './ExternalLinkProofOverlay';
import { ImageProofForm } from './ImageProofOverlay';
import { VideoProofForm } from './VideoProofOverlay';
import { DocumentProofForm } from './DocumentProofOverlay';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const SPRING_CONFIG = { damping: 80, stiffness: 600, overshootClamping: false };

export type ProofType = 'external_link' | 'video' | 'image' | 'document';

export interface ProofFormProps {
  onBack: () => void;
  onClose: () => void;
  onSuccess: () => void;
  playerRatingScoreId: string;
}

interface ProofTypeOption {
  type: ProofType;
  icon: keyof typeof Ionicons.glyphMap;
  titleKey: string;
  descriptionKey: string;
}

const PROOF_TYPES: ProofTypeOption[] = [
  {
    type: 'external_link',
    icon: 'link-outline',
    titleKey: 'profile.ratingProofs.proofTypes.externalLink.title',
    descriptionKey: 'profile.ratingProofs.proofTypes.externalLink.description',
  },
  {
    type: 'video',
    icon: 'videocam-outline',
    titleKey: 'profile.ratingProofs.proofTypes.video.title',
    descriptionKey: 'profile.ratingProofs.proofTypes.video.description',
  },
  {
    type: 'image',
    icon: 'image-outline',
    titleKey: 'profile.ratingProofs.proofTypes.image.title',
    descriptionKey: 'profile.ratingProofs.proofTypes.image.description',
  },
  {
    type: 'document',
    icon: 'document-text-outline',
    titleKey: 'profile.ratingProofs.proofTypes.document.title',
    descriptionKey: 'profile.ratingProofs.proofTypes.document.description',
  },
];

export function AddRatingProofActionSheet({ payload }: SheetProps<'add-rating-proof'>) {
  const playerRatingScoreId = payload?.playerRatingScoreId || '';
  const onSuccessCallback = payload?.onSuccess;
  const { colors } = useThemeStyles();
  const { t } = useTranslation();

  const [activeFormType, setActiveFormType] = useState<ProofType | null>(null);
  const slideProgress = useSharedValue(0);

  const isFormActive = activeFormType !== null;

  const onClose = useCallback(() => {
    SheetManager.hide('add-rating-proof');
  }, []);

  const handleSelectType = useCallback(
    (type: ProofType) => {
      lightHaptic();
      setActiveFormType(type);
      slideProgress.value = withSpring(1, SPRING_CONFIG);
    },
    [slideProgress]
  );

  const handleBack = useCallback(() => {
    slideProgress.value = withSpring(0, SPRING_CONFIG);
    setTimeout(() => setActiveFormType(null), 300);
  }, [slideProgress]);

  const handleSuccess = useCallback(() => {
    onSuccessCallback?.();
  }, [onSuccessCallback]);

  const handleBeforeClose = useCallback(() => {
    setActiveFormType(null);
    slideProgress.value = 0;
  }, [slideProgress]);

  const typeListAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -slideProgress.value * SCREEN_WIDTH }],
    opacity: 1 - slideProgress.value * 0.3,
  }));

  const formAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (1 - slideProgress.value) * SCREEN_WIDTH }],
    opacity: 0.7 + slideProgress.value * 0.3,
  }));

  return (
    <ActionSheet
      gestureEnabled={!isFormActive}
      containerStyle={[
        styles.sheetBackground,
        { backgroundColor: colors.card },
        isFormActive && { height: SCREEN_HEIGHT * 0.92 },
      ]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
      onBeforeClose={handleBeforeClose}
    >
      <View style={[styles.slidingContainer, isFormActive && { flex: 1 }]}>
        {/* Type list panel */}
        <Animated.View style={[styles.slidePanel, typeListAnimatedStyle]}>
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <View style={styles.headerCenter}>
              <Text size="lg" weight="semibold" color={colors.text}>
                {t('profile.ratingProofs.addProof')}
              </Text>
              <Text size="sm" color={colors.textMuted}>
                {t('profile.ratingProofs.chooseProofType')}
              </Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeButton}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close-outline" size={24} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          {/* Proof type list */}
          <View style={styles.content}>
            {PROOF_TYPES.map(option => (
              <TouchableOpacity
                key={option.type}
                style={[styles.actionItem, { borderBottomColor: colors.border }]}
                onPress={() => handleSelectType(option.type)}
                activeOpacity={0.7}
              >
                <View
                  style={[styles.actionIconContainer, { backgroundColor: colors.buttonInactive }]}
                >
                  <Ionicons name={option.icon} size={24} color={colors.primary} />
                </View>
                <View style={styles.actionTextContainer}>
                  <Text size="base" weight="semibold" color={colors.text}>
                    {t(option.titleKey as never)}
                  </Text>
                  <Text size="sm" color={colors.textMuted} style={styles.actionDescription}>
                    {t(option.descriptionKey as never)}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            ))}
          </View>
        </Animated.View>

        {/* Form panel (absolutely positioned overlay) */}
        {isFormActive && (
          <Animated.View style={[styles.slidePanel, styles.formPanel, formAnimatedStyle]}>
            {activeFormType === 'external_link' && (
              <ExternalLinkProofForm
                onBack={handleBack}
                onClose={onClose}
                onSuccess={handleSuccess}
                playerRatingScoreId={playerRatingScoreId}
              />
            )}
            {activeFormType === 'image' && (
              <ImageProofForm
                onBack={handleBack}
                onClose={onClose}
                onSuccess={handleSuccess}
                playerRatingScoreId={playerRatingScoreId}
              />
            )}
            {activeFormType === 'video' && (
              <VideoProofForm
                onBack={handleBack}
                onClose={onClose}
                onSuccess={handleSuccess}
                playerRatingScoreId={playerRatingScoreId}
              />
            )}
            {activeFormType === 'document' && (
              <DocumentProofForm
                onBack={handleBack}
                onClose={onClose}
                onSuccess={handleSuccess}
                playerRatingScoreId={playerRatingScoreId}
              />
            )}
          </Animated.View>
        )}
      </View>
    </ActionSheet>
  );
}

const styles = StyleSheet.create({
  sheetBackground: {
    borderTopLeftRadius: radiusPixels['2xl'],
    borderTopRightRadius: radiusPixels['2xl'],
  },
  handleIndicator: {
    width: spacingPixels[10],
    height: 4,
    borderRadius: 4,
    alignSelf: 'center',
  },
  slidingContainer: {
    overflow: 'hidden',
  },
  slidePanel: {
    width: '100%',
  },
  formPanel: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  header: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacingPixels[4],
    borderBottomWidth: 1,
    position: 'relative',
  },
  headerCenter: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButton: {
    padding: spacingPixels[1],
    position: 'absolute',
    right: spacingPixels[4],
  },
  content: {
    paddingHorizontal: spacingPixels[4],
    paddingBottom: spacingPixels[6],
  },
  actionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacingPixels[4],
    borderBottomWidth: 1,
  },
  actionIconContainer: {
    width: spacingPixels[11],
    height: spacingPixels[11],
    borderRadius: radiusPixels.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionTextContainer: {
    flex: 1,
    marginLeft: spacingPixels[3],
  },
  actionDescription: {
    marginTop: spacingPixels[0.5],
  },
});

export default AddRatingProofActionSheet;
