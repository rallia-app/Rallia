import * as ImagePicker from 'expo-image-picker';

// iPhones record Dolby Vision HEVC, which many Android decoders refuse. Ask iOS
// for an H.264 SDR rendition instead; both options are ignored on Android.
export const COMPATIBLE_VIDEO_CAPTURE_OPTIONS = {
  videoExportPreset: ImagePicker.VideoExportPreset.H264_1920x1080,
} as const;

export const COMPATIBLE_VIDEO_LIBRARY_OPTIONS = {
  ...COMPATIBLE_VIDEO_CAPTURE_OPTIONS,
  preferredAssetRepresentationMode:
    ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
} as const;
