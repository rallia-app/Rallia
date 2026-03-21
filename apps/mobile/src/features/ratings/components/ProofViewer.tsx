/**
 * ProofViewer Component
 *
 * A modern, full-screen viewer for rating proofs.
 * Supports videos, images, documents, and external links.
 * Provides smooth animations and professional UI.
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Dimensions,
  Image,
  ActivityIndicator,
  Linking,
  ScrollView,
  StatusBar,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Video, ResizeMode } from 'expo-av';
import { WebView } from 'react-native-webview';
import { Text } from '@rallia/shared-components';
import { Logger } from '@rallia/shared-services';
import { useThemeStyles, useTranslation } from '../../../hooks';
import { resolveStorageUrl } from '../../../services/imageUpload';
import {
  spacingPixels,
  radiusPixels,
  fontSizePixels,
  fontWeightNumeric,
} from '@rallia/design-system';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface ProofViewerProps {
  visible: boolean;
  onClose: () => void;
  proof: {
    id: string;
    proof_type: 'external_link' | 'video' | 'image' | 'document';
    title: string;
    description?: string | null;
    external_url?: string | null;
    file?: {
      id: string;
      url: string;
      thumbnail_url: string | null;
      file_type: string;
      original_name: string;
      mime_type: string;
    } | null;
    created_at: string;
  } | null;
}

const ProofViewer: React.FC<ProofViewerProps> = ({ visible, onClose, proof }) => {
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const videoRef = useRef<Video>(null);
  const [loading, setLoading] = useState(true);
  const [, setVideoStatus] = useState<{ isPlaying: boolean }>({ isPlaying: false });
  const [error, setError] = useState<string | null>(null);
  const [resolvedFileUrl, setResolvedFileUrl] = useState<string | null>(null);

  // Resolve signed URLs for private storage buckets (rating-proof-*)
  useEffect(() => {
    if (!proof?.file?.url) {
      setResolvedFileUrl(null);
      return;
    }

    let cancelled = false;
    resolveStorageUrl(proof.file.url).then(url => {
      if (!cancelled) setResolvedFileUrl(url);
    });

    return () => {
      cancelled = true;
    };
  }, [proof?.file?.url]);

  if (!proof) return null;

  // Get effective type - use file.file_type for file-based proofs
  const getEffectiveType = (): 'external_link' | 'video' | 'image' | 'document' => {
    if (proof.proof_type === 'external_link') return 'external_link';
    if (proof.file?.file_type) {
      const fileType = proof.file.file_type as 'video' | 'image' | 'document';
      if (['video', 'image', 'document'].includes(fileType)) {
        return fileType;
      }
    }
    return proof.proof_type;
  };

  const effectiveType = getEffectiveType();

  const handleOpenExternalLink = async () => {
    if (proof.external_url) {
      try {
        const canOpen = await Linking.canOpenURL(proof.external_url);
        if (canOpen) {
          await Linking.openURL(proof.external_url);
        } else {
          setError(t('profile.ratingProofs.gallery.cannotOpenLink'));
        }
      } catch (err) {
        Logger.error('Failed to open external link', err as Error);
        setError(t('profile.ratingProofs.gallery.failedToOpenLink'));
      }
    }
  };

  const renderContent = () => {
    switch (effectiveType) {
      case 'video':
        if (!resolvedFileUrl) {
          return (
            <View style={styles.errorContainer}>
              <Ionicons name="alert-circle" size={48} color={colors.textMuted} />
              <Text style={[styles.errorText, { color: colors.textMuted }]}>
                {t('profile.ratingProofs.gallery.videoNotAvailable')}
              </Text>
            </View>
          );
        }
        return (
          <View style={styles.videoContainer}>
            <Video
              ref={videoRef}
              source={{ uri: resolvedFileUrl }}
              style={styles.video}
              resizeMode={ResizeMode.CONTAIN}
              useNativeControls
              isLooping={false}
              onLoadStart={() => setLoading(true)}
              onLoad={() => setLoading(false)}
              onPlaybackStatusUpdate={status => {
                if (status.isLoaded) {
                  setVideoStatus({ isPlaying: status.isPlaying });
                }
              }}
              onError={err => {
                Logger.error('Video playback error', new Error(String(err)));
                setError(t('profile.ratingProofs.gallery.failedToLoadVideo'));
                setLoading(false);
              }}
            />
            {loading && (
              <View style={styles.loadingOverlay}>
                <ActivityIndicator size="large" color={colors.primary} />
              </View>
            )}
          </View>
        );

      case 'image':
        if (!resolvedFileUrl) {
          return (
            <View style={styles.errorContainer}>
              <Ionicons name="alert-circle" size={48} color={colors.textMuted} />
              <Text style={[styles.errorText, { color: colors.textMuted }]}>
                {t('profile.ratingProofs.gallery.imageNotAvailable')}
              </Text>
            </View>
          );
        }
        return (
          <View style={styles.imageContainer}>
            {loading && (
              <View style={styles.loadingOverlay}>
                <ActivityIndicator size="large" color={colors.primary} />
              </View>
            )}
            <Image
              source={{ uri: resolvedFileUrl }}
              style={styles.image}
              resizeMode="contain"
              onLoadStart={() => setLoading(true)}
              onLoad={() => setLoading(false)}
              onError={() => {
                setError(t('profile.ratingProofs.gallery.failedToLoadImage'));
                setLoading(false);
              }}
            />
          </View>
        );

      case 'document': {
        if (!resolvedFileUrl) {
          return (
            <View style={styles.errorContainer}>
              <Ionicons name="alert-circle" size={48} color={colors.textMuted} />
              <Text style={[styles.errorText, { color: colors.textMuted }]}>
                {t('profile.ratingProofs.gallery.documentNotAvailable')}
              </Text>
            </View>
          );
        }

        // iOS WebView renders PDFs natively — load directly
        // Android cannot, so show a download/open button instead
        if (Platform.OS === 'ios') {
          return (
            <View style={styles.documentContainer}>
              {loading && (
                <View style={styles.loadingOverlay}>
                  <ActivityIndicator size="large" color={colors.primary} />
                </View>
              )}
              <WebView
                source={{ uri: resolvedFileUrl }}
                style={styles.webview}
                onLoadStart={() => setLoading(true)}
                onLoad={() => setLoading(false)}
                onError={() => {
                  setError(t('profile.ratingProofs.gallery.failedToLoadDocument'));
                  setLoading(false);
                }}
                startInLoadingState
                renderLoading={() => (
                  <View style={[styles.loadingOverlay, { backgroundColor: colors.background }]}>
                    <ActivityIndicator size="large" color={colors.primary} />
                  </View>
                )}
              />
            </View>
          );
        }

        // Android: show document info (WebView can't render PDFs on Android)
        return (
          <View style={styles.errorContainer}>
            <View
              style={[styles.documentPlaceholderIcon, { backgroundColor: `${colors.primary}15` }]}
            >
              <Ionicons name="document-text" size={48} color={colors.primary} />
            </View>
            <Text style={[styles.documentFileName, { color: colors.text }]} numberOfLines={2}>
              {proof.file?.original_name || t('profile.ratingProofs.proofTypes.document.title')}
            </Text>
          </View>
        );
      }

      case 'external_link':
        return (
          <View style={styles.externalLinkContainer}>
            <View style={[styles.linkCard, { backgroundColor: colors.card }]}>
              <View style={[styles.linkIconContainer, { backgroundColor: `${colors.primary}15` }]}>
                <Ionicons name="link" size={48} color={colors.primary} />
              </View>
              <Text style={[styles.linkTitle, { color: colors.text }]}>{proof.title}</Text>
              {proof.description && (
                <Text style={[styles.linkDescription, { color: colors.textMuted }]}>
                  {proof.description}
                </Text>
              )}
              <TouchableOpacity
                style={[styles.openLinkButton, { backgroundColor: colors.primary }]}
                onPress={handleOpenExternalLink}
              >
                <Ionicons name="open-outline" size={20} color="#fff" />
                <Text style={styles.openLinkButtonText}>
                  {t('profile.ratingProofs.gallery.openLink')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        );

      default:
        return (
          <View style={styles.errorContainer}>
            <Ionicons name="help-circle" size={48} color={colors.textMuted} />
            <Text style={[styles.errorText, { color: colors.textMuted }]}>
              {t('profile.ratingProofs.gallery.unknownProofType')}
            </Text>
          </View>
        );
    }
  };

  const getTypeIcon = () => {
    switch (proof.proof_type) {
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

  const getTypeLabel = () => {
    switch (proof.proof_type) {
      case 'video':
        return t('profile.ratingProofs.proofTypes.video.title');
      case 'image':
        return t('profile.ratingProofs.proofTypes.image.title');
      case 'document':
        return t('profile.ratingProofs.proofTypes.document.title');
      case 'external_link':
        return t('profile.ratingProofs.proofTypes.externalLink.title');
      default:
        return t('profile.ratingProofs.title');
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={styles.headerSpacer} />
          <View style={styles.headerCenter}>
            <View style={styles.headerTitleRow}>
              <Ionicons
                name={getTypeIcon()}
                size={18}
                color={colors.textMuted}
                style={{ marginRight: 6 }}
              />
              <Text style={[styles.headerType, { color: colors.textMuted }]}>{getTypeLabel()}</Text>
            </View>
            <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
              {proof.title}
            </Text>
          </View>
          <TouchableOpacity
            onPress={onClose}
            style={[styles.closeButton, { backgroundColor: colors.inputBackground }]}
          >
            <Ionicons name="close-outline" size={28} color={colors.text} />
          </TouchableOpacity>
        </View>

        {/* Content */}
        <View style={styles.content}>
          {error ? (
            <View style={styles.errorContainer}>
              <Ionicons name="alert-circle" size={48} color={colors.error} />
              <Text style={[styles.errorText, { color: colors.textMuted }]}>{error}</Text>
              <TouchableOpacity
                style={[styles.retryButton, { backgroundColor: colors.inputBackground }]}
                onPress={() => {
                  setError(null);
                  setLoading(true);
                }}
              >
                <Text style={[styles.retryButtonText, { color: colors.text }]}>
                  {t('profile.ratingProofs.gallery.retry')}
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            renderContent()
          )}
        </View>

        {/* Footer with description */}
        {proof.description && proof.proof_type !== 'external_link' && (
          <View
            style={[styles.footer, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Text style={[styles.footerLabel, { color: colors.textMuted }]}>
              {t('profile.ratingProofs.descriptionLabel')}
            </Text>
            <ScrollView style={styles.footerScroll} showsVerticalScrollIndicator={false}>
              <Text style={[styles.footerDescription, { color: colors.text }]}>
                {proof.description}
              </Text>
            </ScrollView>
          </View>
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacingPixels[4],
    paddingTop: Platform.OS === 'ios' ? 60 : spacingPixels[4],
    paddingBottom: spacingPixels[3],
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: spacingPixels[2],
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  headerType: {
    fontSize: fontSizePixels.xs,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  headerTitle: {
    fontSize: fontSizePixels.base,
    fontWeight: fontWeightNumeric.semibold,
  },
  headerSpacer: {
    width: 44,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  // Video styles
  videoContainer: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  video: {
    width: '100%',
    height: '100%',
  },
  // Image styles
  imageContainer: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.7,
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  // Document styles
  documentContainer: {
    flex: 1,
    width: SCREEN_WIDTH,
  },
  webview: {
    flex: 1,
  },
  documentPlaceholderIcon: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacingPixels[4],
  },
  documentFileName: {
    fontSize: fontSizePixels.base,
    fontWeight: fontWeightNumeric.medium,
    textAlign: 'center',
    marginBottom: spacingPixels[4],
    paddingHorizontal: spacingPixels[6],
  },
  // External link styles
  externalLinkContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacingPixels[6],
  },
  linkCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: radiusPixels.xl,
    padding: spacingPixels[6],
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 8,
  },
  linkIconContainer: {
    width: 96,
    height: 96,
    borderRadius: 48,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacingPixels[4],
  },
  linkTitle: {
    fontSize: fontSizePixels.xl,
    fontWeight: fontWeightNumeric.bold,
    textAlign: 'center',
    marginBottom: spacingPixels[2],
  },
  linkDescription: {
    fontSize: fontSizePixels.sm,
    textAlign: 'center',
    marginBottom: spacingPixels[3],
  },
  openLinkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[6],
    borderRadius: radiusPixels.lg,
    gap: spacingPixels[2],
    alignSelf: 'stretch',
  },
  openLinkButtonText: {
    color: '#fff',
    fontSize: fontSizePixels.base,
    fontWeight: fontWeightNumeric.semibold,
    flexShrink: 0,
  },
  // Error styles
  errorContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacingPixels[6],
  },
  errorText: {
    fontSize: fontSizePixels.base,
    marginTop: spacingPixels[3],
    textAlign: 'center',
  },
  retryButton: {
    marginTop: spacingPixels[4],
    paddingVertical: spacingPixels[2],
    paddingHorizontal: spacingPixels[4],
    borderRadius: radiusPixels.md,
  },
  retryButtonText: {
    fontSize: fontSizePixels.sm,
  },
  // Footer
  footer: {
    marginHorizontal: spacingPixels[3],
    marginBottom: Platform.OS === 'ios' ? 34 : spacingPixels[3],
    borderRadius: radiusPixels.xl,
    borderWidth: 1,
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[3],
    paddingBottom: spacingPixels[4],
    maxHeight: 160,
  },
  footerLabel: {
    fontSize: fontSizePixels.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: fontWeightNumeric.semibold,
    marginBottom: spacingPixels[1],
  },
  footerScroll: {
    maxHeight: 110,
  },
  footerDescription: {
    fontSize: fontSizePixels.sm,
    lineHeight: fontSizePixels.sm * 1.6,
  },
});

export default ProofViewer;
