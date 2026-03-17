import { useState, useCallback, useMemo } from 'react';
import { Platform, Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { SheetManager } from 'react-native-actions-sheet';
import { Logger } from '@rallia/shared-services';

import { useTranslation } from './useTranslation';

export interface ImagePickerResult {
  uri: string | null;
  error?: string;
}

export interface ImagePickerPermissions {
  camera: boolean;
  library: boolean;
}

/**
 * Custom hook for handling image selection with permissions
 * Supports both camera and gallery, with platform-specific handling
 *
 * On Android, uses a custom cropper UI for better UX (the native Android
 * image editor has confusing grayed-out buttons).
 * On iOS, uses the native editing experience.
 *
 * Uses SheetManager to show the globally registered ImagePickerSheet.
 * Components can use:
 * - openPicker(): to show the image picker sheet
 * - pickFromCamera / pickFromGallery: to trigger selection directly
 * - image: the selected image URI
 */
export interface UseImagePickerOptions {
  title?: string;
  cameraLabel?: string;
  galleryLabel?: string;
  /** Aspect ratio for cropping [width, height], default [1, 1] */
  aspectRatio?: [number, number];
  /** Whether to skip editing/cropping, default false */
  skipEditing?: boolean;
}

export const useImagePicker = (options?: UseImagePickerOptions) => {
  const [image, setImage] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<ImagePickerPermissions>({
    camera: false,
    library: false,
  });
  const { t } = useTranslation();

  // Memoize aspectRatio to avoid recreating arrays on every render
  const aspectRatio = useMemo<[number, number]>(
    () => options?.aspectRatio ?? [1, 1],
    [options?.aspectRatio]
  );
  const skipEditing = options?.skipEditing ?? false;

  // On Android, we disable native editing and use our custom cropper
  // On iOS, the native editing experience is good
  const useNativeEditing = Platform.OS === 'ios' && !skipEditing;

  const requestPermissions = useCallback(async () => {
    const { status: cameraStatus } = await ImagePicker.requestCameraPermissionsAsync();
    const { status: libraryStatus } = await ImagePicker.requestMediaLibraryPermissionsAsync();

    const perms = {
      camera: cameraStatus === ImagePicker.PermissionStatus.GRANTED,
      library: libraryStatus === ImagePicker.PermissionStatus.GRANTED,
    };
    setPermissions(perms);
    return perms;
  }, []);

  /**
   * Shows the custom image cropper on Android
   */
  const showCustomCropper = useCallback(
    (imageUri: string): Promise<ImagePickerResult> => {
      return new Promise(resolve => {
        void SheetManager.show('image-cropper', {
          payload: {
            imageUri,
            aspectRatio,
            title: options?.title,
            onConfirm: (croppedUri: string) => {
              setImage(croppedUri);
              resolve({ uri: croppedUri });
            },
            onCancel: () => {
              resolve({ uri: null });
            },
          },
        });
      });
    },
    [aspectRatio, options?.title]
  );

  const pickFromCamera = useCallback(async (): Promise<ImagePickerResult> => {
    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        allowsEditing: useNativeEditing,
        aspect: aspectRatio,
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        const uri = result.assets[0].uri;

        // On Android (or when native editing is disabled), show custom cropper
        if (!useNativeEditing && !skipEditing) {
          return await showCustomCropper(uri);
        }

        setImage(uri);
        return { uri };
      }

      return { uri: null };
    } catch (error) {
      Logger.error('Failed to pick image from camera', error as Error, { source: 'camera' });
      return { uri: null, error: 'Failed to capture image' };
    }
  }, [useNativeEditing, skipEditing, aspectRatio, showCustomCropper]);

  const pickFromGallery = useCallback(async (): Promise<ImagePickerResult> => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: useNativeEditing,
        aspect: aspectRatio,
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        const uri = result.assets[0].uri;

        // On Android (or when native editing is disabled), show custom cropper
        if (!useNativeEditing && !skipEditing) {
          return await showCustomCropper(uri);
        }

        setImage(uri);
        return { uri };
      }

      return { uri: null };
    } catch (error) {
      Logger.error('Failed to pick image from gallery', error as Error, { source: 'gallery' });
      return { uri: null, error: 'Failed to select image' };
    }
  }, [useNativeEditing, skipEditing, aspectRatio, showCustomCropper]);

  /**
   * Opens the image picker sheet (custom UI)
   * Uses SheetManager to show the globally registered ImagePickerSheet
   */
  const openPicker = useCallback(async () => {
    // Web: directly launch image picker (no sheet needed)
    if (Platform.OS === 'web') {
      return await pickFromGallery();
    }

    // Mobile: request permissions and show sheet
    const perms = await requestPermissions();

    if (!perms.camera && !perms.library) {
      Alert.alert(t('alerts.error'), t('errors.permissionsDenied'), [{ text: t('common.ok') }]);
      return { uri: null, error: t('errors.permissionsDenied') };
    }

    // Show the image picker sheet via SheetManager
    // Note: The actual image URI will be set by pickFromCamera/pickFromGallery callbacks
    void SheetManager.show('image-picker', {
      payload: {
        onTakePhoto: () => void pickFromCamera(),
        onChooseFromGallery: () => void pickFromGallery(),
        title: options?.title,
        cameraLabel: options?.cameraLabel,
        galleryLabel: options?.galleryLabel,
        cameraDisabled: !perms.camera,
        galleryDisabled: !perms.library,
      },
    });

    return { uri: null }; // Actual result will come from pickFromCamera/pickFromGallery
  }, [requestPermissions, pickFromGallery, pickFromCamera, t, options]);

  /**
   * Legacy pickImage function that uses native Alert
   * @deprecated Use openPicker() with ImagePickerSheet component instead
   */
  const pickImage = useCallback(async () => {
    // Web: directly launch image picker
    if (Platform.OS === 'web') {
      return await pickFromGallery();
    }

    // Mobile: request permissions first
    const perms = await requestPermissions();

    if (!perms.camera && !perms.library) {
      Alert.alert(t('alerts.error'), t('errors.permissionsDenied'), [{ text: t('common.ok') }]);
      return { uri: null, error: t('errors.permissionsDenied') };
    }

    // Show options dialog (legacy native Alert)
    return new Promise<ImagePickerResult>(resolve => {
      Alert.alert(t('profile.profilePicture'), t('common.select'), [
        {
          text: t('profile.changePhoto'),
          onPress: () => {
            if (!perms.camera) {
              Alert.alert(t('alerts.error'), t('errors.permissionsDenied'));
              resolve({ uri: null, error: t('errors.permissionsDenied') });
              return;
            }
            void pickFromCamera().then(result => resolve(result));
          },
        },
        {
          text: t('common.select'),
          onPress: () => {
            if (!perms.library) {
              Alert.alert(t('alerts.error'), t('errors.permissionsDenied'));
              resolve({ uri: null, error: t('errors.permissionsDenied') });
              return;
            }
            void pickFromGallery().then(result => resolve(result));
          },
        },
        {
          text: t('common.cancel'),
          style: 'cancel',
          onPress: () => resolve({ uri: null }),
        },
      ]);
    });
  }, [requestPermissions, pickFromCamera, pickFromGallery, t]);

  const clearImage = useCallback(() => {
    setImage(null);
  }, []);

  return {
    image,
    // Legacy API (still works, uses native Alert)
    pickImage,
    // New API (uses SheetManager)
    openPicker,
    pickFromCamera,
    pickFromGallery,
    permissions,
    // Utility
    clearImage,
    setImage, // Allow manual setting
  };
};
