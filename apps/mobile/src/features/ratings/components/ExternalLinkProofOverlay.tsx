import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ActionSheet, { SheetManager, SheetProps } from 'react-native-actions-sheet';
import { Text, Button, useToast } from '@rallia/shared-components';
import { useThemeStyles, useTranslation } from '../../../hooks';
import { lightHaptic, mediumHaptic } from '@rallia/shared-utils';
import { createExternalLinkProof } from '../../../services/ratingProofUpload';
import { Logger } from '@rallia/shared-services';
import { spacingPixels, radiusPixels, fontSizePixels } from '@rallia/design-system';
import type { ProofFormProps } from './AddRatingProofOverlay';

interface ExternalLinkProofOverlayProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
  playerRatingScoreId: string;
}

// Common rating/video platforms for quick suggestions
const SUGGESTED_PLATFORMS = [
  { name: 'YouTube', icon: 'logo-youtube', baseUrl: 'youtube.com' },
  { name: 'FFT', icon: 'globe-outline', baseUrl: 'fft.fr' },
  { name: 'WTN', icon: 'globe-outline', baseUrl: 'worldtennisnumber.com' },
  { name: 'UTR', icon: 'globe-outline', baseUrl: 'utrsports.net' },
  { name: 'DUPR', icon: 'globe-outline', baseUrl: 'mydupr.com' },
];

export function ExternalLinkProofForm({
  onBack,
  onClose,
  onSuccess,
  playerRatingScoreId,
}: ProofFormProps) {
  const { colors } = useThemeStyles();
  const { t } = useTranslation();
  const toast = useToast();

  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);

  const resetForm = () => {
    setUrl('');
    setTitle('');
    setDescription('');
    setUrlError(null);
  };

  const validateUrl = (urlString: string): boolean => {
    if (!urlString.trim()) {
      setUrlError(t('profile.ratingProofs.errors.invalidUrl'));
      return false;
    }

    try {
      let normalizedUrl = urlString.trim();
      if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
        normalizedUrl = 'https://' + normalizedUrl;
      }

      const parsedUrl = new URL(normalizedUrl);
      if (!parsedUrl.hostname.includes('.')) {
        setUrlError(t('profile.ratingProofs.errors.invalidUrl'));
        return false;
      }

      setUrlError(null);
      return true;
    } catch {
      setUrlError(t('profile.ratingProofs.errors.invalidUrl'));
      return false;
    }
  };

  const normalizeUrl = (urlString: string): string => {
    let normalized = urlString.trim();
    if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
      normalized = 'https://' + normalized;
    }
    return normalized;
  };

  const handleSubmit = async () => {
    if (!validateUrl(url)) return;

    if (!title.trim()) {
      toast.error(t('profile.ratingProofs.errors.titleRequired'));
      return;
    }

    mediumHaptic();
    setIsSubmitting(true);

    try {
      const normalizedUrl = normalizeUrl(url);

      const result = await createExternalLinkProof(
        playerRatingScoreId,
        normalizedUrl,
        title.trim(),
        description.trim() || undefined
      );

      if (result.success) {
        toast.success(t('profile.ratingProofs.upload.success'));
        resetForm();
        onSuccess();
        onClose();
      } else {
        throw new Error(result.error || 'Unknown error');
      }
    } catch (error) {
      Logger.error('Failed to create external link proof', error as Error);
      toast.error(t('profile.ratingProofs.errors.saveFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenUrl = () => {
    if (validateUrl(url)) {
      const normalizedUrl = normalizeUrl(url);
      Linking.openURL(normalizedUrl);
    }
  };

  const handlePlatformSuggestion = (baseUrl: string) => {
    lightHaptic();
    setUrl(`https://www.${baseUrl}/`);
  };

  return (
    <View style={styles.modalContent}>
      {/* Handle indicator */}
      <View style={styles.handleIndicatorRow}>
        <View style={[styles.handleIndicator, { backgroundColor: colors.border }]} />
      </View>

      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={onBack}
          style={styles.backButton}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text
            weight="semibold"
            size="lg"
            style={{ color: colors.text }}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {t('profile.ratingProofs.proofTypes.externalLink.title')}
          </Text>
        </View>
        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
          <Ionicons name="close-outline" size={24} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Scrollable Content */}
      <ScrollView
        style={styles.scrollContent}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.iconHeaderContainer}>
          <View style={[styles.iconHeader, { backgroundColor: colors.primary + '20' }]}>
            <Ionicons name="link-outline" size={32} color={colors.primary} />
          </View>
          <Text size="sm" color={colors.textMuted} style={styles.subtitle}>
            {t('profile.ratingProofs.proofTypes.externalLink.urlHint')}
          </Text>
        </View>

        {/* Platform Suggestions */}
        <View style={styles.suggestionsContainer}>
          <Text size="xs" color={colors.textMuted} style={styles.suggestionsLabel}>
            {t('profile.ratingProofs.proofTypes.externalLink.popularPlatforms')}
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.suggestionsScroll}
          >
            {SUGGESTED_PLATFORMS.map(platform => (
              <TouchableOpacity
                key={platform.name}
                style={[
                  styles.suggestionChip,
                  { backgroundColor: colors.cardBackground, borderColor: colors.border },
                ]}
                onPress={() => handlePlatformSuggestion(platform.baseUrl)}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={platform.icon as keyof typeof Ionicons.glyphMap}
                  size={14}
                  color={colors.textMuted}
                />
                <Text size="xs" color={colors.text} style={styles.suggestionText}>
                  {platform.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* URL Input */}
        <View style={styles.inputGroup}>
          <Text size="sm" weight="medium" color={colors.text} style={styles.label}>
            {t('profile.ratingProofs.proofTypes.externalLink.urlLabel')} *
          </Text>
          <View
            style={[
              styles.urlInputContainer,
              {
                backgroundColor: colors.inputBackground,
                borderColor: urlError ? colors.error : colors.border,
              },
            ]}
          >
            <TextInput
              style={[styles.urlInput, { color: colors.text }]}
              value={url}
              onChangeText={text => {
                setUrl(text);
                setUrlError(null);
              }}
              placeholder={t('profile.ratingProofs.proofTypes.externalLink.placeholder')}
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="next"
              editable={!isSubmitting}
            />
            {url.length > 0 && (
              <TouchableOpacity onPress={handleOpenUrl} style={styles.urlPreviewButton}>
                <Ionicons name="open-outline" size={20} color={colors.primary} />
              </TouchableOpacity>
            )}
          </View>
          {urlError && (
            <Text size="xs" color={colors.error} style={styles.errorText}>
              {urlError}
            </Text>
          )}
        </View>

        {/* Title Input */}
        <View style={styles.inputGroup}>
          <Text size="sm" weight="medium" color={colors.text} style={styles.label}>
            {t('profile.ratingProofs.form.title')} *
          </Text>
          <TextInput
            style={[
              styles.textInput,
              {
                backgroundColor: colors.inputBackground,
                borderColor: colors.border,
                color: colors.text,
              },
            ]}
            value={title}
            onChangeText={setTitle}
            placeholder={t('profile.ratingProofs.form.titlePlaceholder')}
            placeholderTextColor={colors.textMuted}
            maxLength={100}
            returnKeyType="next"
            editable={!isSubmitting}
          />
        </View>

        {/* Description Input */}
        <View style={styles.inputGroup}>
          <Text size="sm" weight="medium" color={colors.text} style={styles.label}>
            {t('profile.ratingProofs.form.description')}
          </Text>
          <TextInput
            style={[
              styles.textInput,
              styles.textArea,
              {
                backgroundColor: colors.inputBackground,
                borderColor: colors.border,
                color: colors.text,
              },
            ]}
            value={description}
            onChangeText={setDescription}
            placeholder={t('profile.ratingProofs.form.descriptionPlaceholder')}
            placeholderTextColor={colors.textMuted}
            maxLength={500}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            editable={!isSubmitting}
          />
        </View>
      </ScrollView>

      {/* Sticky Footer */}
      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <Button
          variant="primary"
          onPress={handleSubmit}
          disabled={isSubmitting || !url.trim() || !title.trim()}
          style={styles.submitButton}
        >
          {isSubmitting ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={colors.primaryForeground} />
              <Text
                size="base"
                weight="semibold"
                color={colors.primaryForeground}
                style={styles.loadingText}
              >
                {t('profile.ratingProofs.upload.uploading')}
              </Text>
            </View>
          ) : (
            t('profile.ratingProofs.form.submit')
          )}
        </Button>
      </View>
    </View>
  );
}

export function ExternalLinkProofActionSheet({ payload }: SheetProps<'external-link-proof'>) {
  const onClose = () => {
    SheetManager.hide('external-link-proof');
  };
  const onSuccess = payload?.onSuccess;
  const playerRatingScoreId = payload?.playerRatingScoreId || '';

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={[styles.sheetBackground, { backgroundColor: 'transparent' }]}
      indicatorStyle={[styles.handleIndicator]}
    >
      <ExternalLinkProofForm
        onBack={onClose}
        onClose={onClose}
        onSuccess={() => onSuccess?.()}
        playerRatingScoreId={playerRatingScoreId}
      />
    </ActionSheet>
  );
}

// Keep old export for backwards compatibility during migration
const ExternalLinkProofOverlay: React.FC<ExternalLinkProofOverlayProps> = ({
  visible,
  onClose,
  onSuccess,
  playerRatingScoreId,
}) => {
  useEffect(() => {
    if (visible) {
      SheetManager.show('external-link-proof', {
        payload: {
          onSuccess,
          playerRatingScoreId,
        },
      });
    }
  }, [visible, onSuccess, playerRatingScoreId]);

  useEffect(() => {
    if (!visible) {
      SheetManager.hide('external-link-proof');
    }
  }, [visible]);

  return null;
};

const styles = StyleSheet.create({
  sheetBackground: {
    flex: 1,
    borderTopLeftRadius: radiusPixels['2xl'],
    borderTopRightRadius: radiusPixels['2xl'],
  },
  modalContent: {
    flex: 1,
  },
  handleIndicatorRow: {
    alignItems: 'center',
    paddingTop: spacingPixels[2],
  },
  handleIndicator: {
    width: spacingPixels[10],
    height: 4,
    borderRadius: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacingPixels[4],
    borderBottomWidth: 1,
    position: 'relative',
    minHeight: 56,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: spacingPixels[12],
  },
  backButton: {
    padding: spacingPixels[1],
    position: 'absolute',
    left: spacingPixels[4],
    zIndex: 1,
  },
  closeButton: {
    padding: spacingPixels[1],
    position: 'absolute',
    right: spacingPixels[4],
    zIndex: 1,
  },
  scrollContent: {
    flex: 1,
  },
  content: {
    padding: spacingPixels[4],
    paddingBottom: spacingPixels[6],
  },
  iconHeaderContainer: {
    alignItems: 'center',
    marginBottom: spacingPixels[4],
  },
  iconHeader: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacingPixels[3],
  },
  title: {
    textAlign: 'center',
    marginBottom: spacingPixels[1],
  },
  subtitle: {
    textAlign: 'center',
    paddingHorizontal: spacingPixels[4],
  },
  suggestionsContainer: {
    marginBottom: spacingPixels[4],
  },
  suggestionsLabel: {
    marginBottom: spacingPixels[2],
  },
  suggestionsScroll: {
    gap: spacingPixels[2],
  },
  suggestionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[2],
    borderRadius: radiusPixels.full,
    borderWidth: 1,
    gap: spacingPixels[1],
  },
  suggestionText: {
    marginLeft: spacingPixels[1],
  },
  inputGroup: {
    marginBottom: spacingPixels[4],
  },
  label: {
    marginBottom: spacingPixels[2],
  },
  urlInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radiusPixels.md,
    paddingHorizontal: spacingPixels[3],
  },
  urlInput: {
    flex: 1,
    fontSize: fontSizePixels.base,
    paddingVertical: spacingPixels[3],
  },
  urlPreviewButton: {
    padding: spacingPixels[2],
  },
  textInput: {
    borderWidth: 1,
    borderRadius: radiusPixels.md,
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[3],
    fontSize: fontSizePixels.base,
  },
  textArea: {
    minHeight: 80,
  },
  errorText: {
    marginTop: spacingPixels[1],
  },
  footer: {
    padding: spacingPixels[4],
    borderTopWidth: 1,
  },
  submitButton: {
    width: '100%',
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginLeft: spacingPixels[2],
  },
});

export default ExternalLinkProofOverlay;
