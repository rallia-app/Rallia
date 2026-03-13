/**
 * ImageCropperSheet - Interactive image cropping overlay for Android
 *
 * Provides a user-friendly image editing experience with:
 * - Pinch to zoom
 * - Pan to move image
 * - Visible crop frame
 * - Rotate buttons
 *
 * Uses expo-image-manipulator for image transformations.
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import ActionSheet, { SheetManager, SheetProps } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import * as ImageManipulator from 'expo-image-manipulator';
import { GestureDetector, Gesture, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { Text } from '@rallia/shared-components';
import { useTheme } from '@rallia/shared-hooks';
import {
  lightTheme,
  darkTheme,
  spacingPixels,
  radiusPixels,
  primary,
  neutral,
} from '@rallia/design-system';
import { lightHaptic, mediumHaptic } from '@rallia/shared-utils';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export interface ImageCropperPayload {
  imageUri: string;
  aspectRatio?: [number, number];
  onConfirm: (uri: string) => void;
  onCancel?: () => void;
  title?: string;
}

export function ImageCropperSheet({ payload }: SheetProps<'image-cropper'>) {
  const imageUri = payload?.imageUri ?? '';
  const aspectRatioInput = payload?.aspectRatio;
  const onConfirm = payload?.onConfirm;
  const onCancel = payload?.onCancel;
  const title = payload?.title ?? 'Edit Photo';

  const aspectRatio = useMemo<[number, number]>(
    () => aspectRatioInput ?? [1, 1],
    [aspectRatioInput]
  );

  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const themeColors = isDark ? darkTheme : lightTheme;

  const [currentImageUri, setCurrentImageUri] = useState<string>(imageUri);
  const [rotation, setRotation] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [imageSize, setImageSize] = useState({ width: SCREEN_WIDTH, height: SCREEN_WIDTH });

  // Get original image dimensions
  useEffect(() => {
    if (imageUri) {
      Image.getSize(
        imageUri,
        (width, height) => setImageSize({ width, height }),
        () => setImageSize({ width: SCREEN_WIDTH, height: SCREEN_WIDTH })
      );
    }
  }, [imageUri]);

  // Gesture values
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  const colors = {
    background: themeColors.background,
    cardBackground: themeColors.card,
    text: themeColors.foreground,
    textMuted: themeColors.mutedForeground,
    border: themeColors.border,
    primary: primary[500],
    primaryDark: primary[600],
    buttonBg: isDark ? neutral[800] : neutral[100],
    danger: '#EF4444',
    overlay: 'rgba(0, 0, 0, 0.95)',
  };

  // Calculate explicit heights for layout
  const HEADER_HEIGHT = 56;
  const TOOLS_HEIGHT = 80;
  const INSTRUCTIONS_HEIGHT = 40;
  const ASPECT_LABEL_HEIGHT = 32;
  const TOTAL_HEIGHT = SCREEN_HEIGHT * 0.9;
  const CROP_AREA_HEIGHT =
    TOTAL_HEIGHT - HEADER_HEIGHT - TOOLS_HEIGHT - INSTRUCTIONS_HEIGHT - ASPECT_LABEL_HEIGHT - 32;

  // Calculate crop frame dimensions
  const [aspectW, aspectH] = aspectRatio;
  const cropFrameWidth = SCREEN_WIDTH - spacingPixels['8'] * 2;
  const cropFrameHeight = cropFrameWidth * (aspectH / aspectW);

  // Calculate image display size to fit within the view
  const containerWidth = SCREEN_WIDTH;

  const imageAspect = imageSize.width / (imageSize.height || 1);
  const containerAspect = containerWidth / CROP_AREA_HEIGHT;

  let displayWidth: number;
  let displayHeight: number;

  if (imageAspect > containerAspect) {
    displayWidth = containerWidth;
    displayHeight = containerWidth / imageAspect;
  } else {
    displayHeight = CROP_AREA_HEIGHT;
    displayWidth = CROP_AREA_HEIGHT * imageAspect;
  }

  // Ensure image is at least as large as crop frame
  const minScale = Math.max(cropFrameWidth / displayWidth, cropFrameHeight / displayHeight);
  const initialScale = Math.max(1, minScale);

  useEffect(() => {
    scale.value = initialScale;
    savedScale.value = initialScale;
  }, [initialScale, scale, savedScale]);

  const handleClose = useCallback(() => {
    void lightHaptic();
    onCancel?.();
    void SheetManager.hide('image-cropper');
  }, [onCancel]);

  const handleRotateLeft = useCallback(() => {
    if (isProcessing) return;
    void lightHaptic();

    const performRotation = async () => {
      try {
        setIsProcessing(true);
        const newRotation = (rotation - 90 + 360) % 360;

        const result = await ImageManipulator.manipulateAsync(imageUri, [{ rotate: newRotation }], {
          compress: 0.9,
          format: ImageManipulator.SaveFormat.JPEG,
        });

        setCurrentImageUri(result.uri);
        setRotation(newRotation);

        // Reset transform on rotation
        scale.value = withSpring(initialScale);
        savedScale.value = initialScale;
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;

        // Update image size for rotated image
        Image.getSize(
          result.uri,
          (width, height) => setImageSize({ width, height }),
          () => {}
        );
      } catch (error) {
        console.error('Error rotating image:', error);
      } finally {
        setIsProcessing(false);
      }
    };

    void performRotation();
  }, [
    imageUri,
    rotation,
    isProcessing,
    scale,
    savedScale,
    translateX,
    translateY,
    savedTranslateX,
    savedTranslateY,
    initialScale,
  ]);

  const handleRotateRight = useCallback(() => {
    if (isProcessing) return;
    void lightHaptic();

    const performRotation = async () => {
      try {
        setIsProcessing(true);
        const newRotation = (rotation + 90) % 360;

        const result = await ImageManipulator.manipulateAsync(imageUri, [{ rotate: newRotation }], {
          compress: 0.9,
          format: ImageManipulator.SaveFormat.JPEG,
        });

        setCurrentImageUri(result.uri);
        setRotation(newRotation);

        // Reset transform on rotation
        scale.value = withSpring(initialScale);
        savedScale.value = initialScale;
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;

        // Update image size for rotated image
        Image.getSize(
          result.uri,
          (width, height) => setImageSize({ width, height }),
          () => {}
        );
      } catch (error) {
        console.error('Error rotating image:', error);
      } finally {
        setIsProcessing(false);
      }
    };

    void performRotation();
  }, [
    imageUri,
    rotation,
    isProcessing,
    scale,
    savedScale,
    translateX,
    translateY,
    savedTranslateX,
    savedTranslateY,
    initialScale,
  ]);

  const handleConfirm = useCallback(() => {
    if (isProcessing) return;
    void mediumHaptic();

    // Capture current transform values
    const currentScale = scale.value;
    const currentTranslateX = translateX.value;
    const currentTranslateY = translateY.value;

    const processImage = async () => {
      try {
        setIsProcessing(true);

        // Get current image dimensions
        const imgWidth = imageSize.width;
        const imgHeight = imageSize.height;

        // Calculate the visible portion based on transform
        const scaledDisplayWidth = displayWidth * currentScale;
        const scaledDisplayHeight = displayHeight * currentScale;

        // Calculate the center offset (crop frame is centered)
        const offsetX = (scaledDisplayWidth - cropFrameWidth) / 2 - currentTranslateX;
        const offsetY = (scaledDisplayHeight - cropFrameHeight) / 2 - currentTranslateY;

        // Convert to original image coordinates
        const scaleToOriginal = imgWidth / scaledDisplayWidth;

        const cropOriginX = Math.max(0, Math.floor(offsetX * scaleToOriginal));
        const cropOriginY = Math.max(0, Math.floor(offsetY * scaleToOriginal));
        const cropWidth = Math.floor(cropFrameWidth * scaleToOriginal);
        const cropHeight = Math.floor(cropFrameHeight * scaleToOriginal);

        // Ensure crop dimensions don't exceed image bounds
        const finalCropWidth = Math.min(cropWidth, imgWidth - cropOriginX);
        const finalCropHeight = Math.min(cropHeight, imgHeight - cropOriginY);

        const actions: ImageManipulator.Action[] = [];

        // Add crop action
        if (finalCropWidth > 0 && finalCropHeight > 0) {
          actions.push({
            crop: {
              originX: cropOriginX,
              originY: cropOriginY,
              width: finalCropWidth,
              height: finalCropHeight,
            },
          });
        }

        // Resize to reasonable dimensions
        const maxDimension = 1200;
        if (finalCropWidth > maxDimension || finalCropHeight > maxDimension) {
          if (finalCropWidth > finalCropHeight) {
            actions.push({ resize: { width: maxDimension } });
          } else {
            actions.push({ resize: { height: maxDimension } });
          }
        }

        if (actions.length > 0) {
          const result = await ImageManipulator.manipulateAsync(currentImageUri, actions, {
            compress: 0.85,
            format: ImageManipulator.SaveFormat.JPEG,
          });
          onConfirm?.(result.uri);
        } else {
          onConfirm?.(currentImageUri);
        }

        void SheetManager.hide('image-cropper');
      } catch (error) {
        console.error('Error processing image:', error);
        onConfirm?.(currentImageUri);
        void SheetManager.hide('image-cropper');
      } finally {
        setIsProcessing(false);
      }
    };

    void processImage();
  }, [
    currentImageUri,
    isProcessing,
    onConfirm,
    scale,
    translateX,
    translateY,
    imageSize,
    displayWidth,
    displayHeight,
    cropFrameWidth,
    cropFrameHeight,
  ]);

  // Pinch gesture for zooming
  const pinchGesture = Gesture.Pinch()
    .onUpdate(e => {
      scale.value = Math.max(minScale, savedScale.value * e.scale);
    })
    .onEnd(() => {
      savedScale.value = scale.value;
    });

  // Pan gesture for moving
  const panGesture = Gesture.Pan()
    .onUpdate(e => {
      const maxX = (displayWidth * scale.value - cropFrameWidth) / 2;
      const maxY = (displayHeight * scale.value - cropFrameHeight) / 2;

      translateX.value = Math.max(-maxX, Math.min(maxX, savedTranslateX.value + e.translationX));
      translateY.value = Math.max(-maxY, Math.min(maxY, savedTranslateY.value + e.translationY));
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const composedGesture = Gesture.Simultaneous(pinchGesture, panGesture);

  const animatedImageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const resetTransform = useCallback(() => {
    void lightHaptic();
    scale.value = withSpring(initialScale);
    savedScale.value = initialScale;
    translateX.value = withSpring(0);
    translateY.value = withSpring(0);
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
  }, [scale, savedScale, translateX, translateY, savedTranslateX, savedTranslateY, initialScale]);

  return (
    <ActionSheet
      id="image-cropper"
      gestureEnabled={false}
      containerStyle={[
        styles.sheetContainer,
        {
          backgroundColor: colors.overlay,
        },
      ]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
      closable={!isProcessing}
      defaultOverlayOpacity={0.8}
    >
      <GestureHandlerRootView style={{ height: TOTAL_HEIGHT }}>
        <View style={{ height: TOTAL_HEIGHT }}>
          {/* Header */}
          <View style={[styles.header, { height: HEADER_HEIGHT }]}>
            <TouchableOpacity
              style={styles.headerButton}
              onPress={handleClose}
              disabled={isProcessing}
              activeOpacity={0.7}
            >
              <Ionicons name="close" size={24} color="#FFFFFF" />
            </TouchableOpacity>

            <Text size="lg" weight="semibold" color="#FFFFFF">
              {title}
            </Text>

            <TouchableOpacity
              style={[
                styles.headerButton,
                styles.confirmButton,
                { backgroundColor: colors.primary },
              ]}
              onPress={handleConfirm}
              disabled={isProcessing}
              activeOpacity={0.7}
            >
              {isProcessing ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Ionicons name="checkmark" size={24} color="#FFFFFF" />
              )}
            </TouchableOpacity>
          </View>

          {/* Interactive Crop Area */}
          <View style={[styles.cropContainer, { height: CROP_AREA_HEIGHT }]}>
            {/* Gesturable image behind overlay */}
            <GestureDetector gesture={composedGesture}>
              <Animated.View
                style={[styles.imageContainer, { width: containerWidth, height: CROP_AREA_HEIGHT }]}
              >
                <Animated.Image
                  source={{ uri: currentImageUri }}
                  style={[
                    {
                      width: displayWidth,
                      height: displayHeight,
                    },
                    animatedImageStyle,
                  ]}
                  resizeMode="contain"
                />
              </Animated.View>
            </GestureDetector>

            {/* Dark overlay with transparent crop window */}
            <View style={styles.cropOverlayContainer} pointerEvents="none">
              {/* Top overlay */}
              <View
                style={[
                  styles.overlaySection,
                  { height: (CROP_AREA_HEIGHT - cropFrameHeight) / 2 },
                ]}
              />

              {/* Middle row */}
              <View style={styles.middleRow}>
                {/* Left overlay */}
                <View
                  style={[styles.overlaySection, { width: (containerWidth - cropFrameWidth) / 2 }]}
                />

                {/* Crop frame (transparent) */}
                <View
                  style={[
                    styles.cropFrame,
                    {
                      width: cropFrameWidth,
                      height: cropFrameHeight,
                      borderColor: colors.primary,
                    },
                  ]}
                >
                  {/* Corner indicators */}
                  <View style={[styles.corner, styles.cornerTL, { borderColor: colors.primary }]} />
                  <View style={[styles.corner, styles.cornerTR, { borderColor: colors.primary }]} />
                  <View style={[styles.corner, styles.cornerBL, { borderColor: colors.primary }]} />
                  <View style={[styles.corner, styles.cornerBR, { borderColor: colors.primary }]} />

                  {/* Grid lines */}
                  <View style={[styles.gridLineH, { top: '33%' }]} />
                  <View style={[styles.gridLineH, { top: '66%' }]} />
                  <View style={[styles.gridLineV, { left: '33%' }]} />
                  <View style={[styles.gridLineV, { left: '66%' }]} />
                </View>

                {/* Right overlay */}
                <View
                  style={[styles.overlaySection, { width: (containerWidth - cropFrameWidth) / 2 }]}
                />
              </View>

              {/* Bottom overlay */}
              <View
                style={[
                  styles.overlaySection,
                  { height: (CROP_AREA_HEIGHT - cropFrameHeight) / 2 },
                ]}
              />
            </View>

            {isProcessing && (
              <View style={styles.processingOverlay}>
                <ActivityIndicator size="large" color={colors.primary} />
              </View>
            )}
          </View>

          {/* Instructions */}
          <View style={styles.instructions}>
            <Text size="sm" color={colors.textMuted} align="center">
              Pinch to zoom • Drag to position
            </Text>
          </View>

          {/* Editing Tools */}
          <View style={styles.toolsContainer}>
            <View style={styles.toolsRow}>
              {/* Rotate Left */}
              <TouchableOpacity
                style={[styles.toolButton, { backgroundColor: colors.buttonBg }]}
                onPress={handleRotateLeft}
                disabled={isProcessing}
                activeOpacity={0.7}
              >
                <Ionicons
                  name="arrow-undo"
                  size={24}
                  color={isProcessing ? colors.textMuted : colors.primary}
                />
                <Text
                  size="xs"
                  weight="medium"
                  color={isProcessing ? colors.textMuted : colors.text}
                >
                  Rotate
                </Text>
              </TouchableOpacity>

              {/* Reset */}
              <TouchableOpacity
                style={[styles.toolButton, { backgroundColor: colors.buttonBg }]}
                onPress={resetTransform}
                disabled={isProcessing}
                activeOpacity={0.7}
              >
                <Ionicons
                  name="refresh"
                  size={24}
                  color={isProcessing ? colors.textMuted : colors.primary}
                />
                <Text
                  size="xs"
                  weight="medium"
                  color={isProcessing ? colors.textMuted : colors.text}
                >
                  Reset
                </Text>
              </TouchableOpacity>

              {/* Rotate Right */}
              <TouchableOpacity
                style={[styles.toolButton, { backgroundColor: colors.buttonBg }]}
                onPress={handleRotateRight}
                disabled={isProcessing}
                activeOpacity={0.7}
              >
                <Ionicons
                  name="arrow-redo"
                  size={24}
                  color={isProcessing ? colors.textMuted : colors.primary}
                />
                <Text
                  size="xs"
                  weight="medium"
                  color={isProcessing ? colors.textMuted : colors.text}
                >
                  Rotate
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Aspect Ratio Label */}
          <View style={[styles.aspectLabel, { backgroundColor: colors.cardBackground }]}>
            <Text size="sm" color={colors.text}>
              {aspectW}:{aspectH}
            </Text>
          </View>
        </View>
      </GestureHandlerRootView>
    </ActionSheet>
  );
}

const styles = StyleSheet.create({
  sheetContainer: {
    borderTopLeftRadius: radiusPixels['2xl'],
    borderTopRightRadius: radiusPixels['2xl'],
  },
  handleIndicator: {
    width: 40,
    height: 4,
    borderRadius: 2,
    marginTop: spacingPixels['2'],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacingPixels['4'],
    paddingVertical: spacingPixels['3'],
  },
  headerButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmButton: {
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  cropContainer: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  imageContainer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cropOverlayContainer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
  },
  overlaySection: {
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  middleRow: {
    flexDirection: 'row',
  },
  cropFrame: {
    borderWidth: 2,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderWidth: 3,
  },
  cornerTL: {
    top: -2,
    left: -2,
    borderRightWidth: 0,
    borderBottomWidth: 0,
  },
  cornerTR: {
    top: -2,
    right: -2,
    borderLeftWidth: 0,
    borderBottomWidth: 0,
  },
  cornerBL: {
    bottom: -2,
    left: -2,
    borderRightWidth: 0,
    borderTopWidth: 0,
  },
  cornerBR: {
    bottom: -2,
    right: -2,
    borderLeftWidth: 0,
    borderTopWidth: 0,
  },
  gridLineH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
  },
  gridLineV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
  },
  processingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
  instructions: {
    paddingHorizontal: spacingPixels['4'],
    paddingVertical: spacingPixels['2'],
  },
  toolsContainer: {
    paddingHorizontal: spacingPixels['4'],
    paddingBottom: spacingPixels['2'],
  },
  toolsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacingPixels['4'],
  },
  toolButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels['3'],
    paddingHorizontal: spacingPixels['4'],
    borderRadius: radiusPixels['lg'],
    gap: spacingPixels['1'],
    minWidth: 80,
  },
  aspectLabel: {
    alignSelf: 'center',
    paddingHorizontal: spacingPixels['3'],
    paddingVertical: spacingPixels['2'],
    borderRadius: radiusPixels['full'],
  },
});

export default ImageCropperSheet;
