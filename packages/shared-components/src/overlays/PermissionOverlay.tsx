import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Overlay from '../Overlay';
import { COLORS } from '@rallia/design-system';

export type PermissionType = 'location' | 'camera' | 'notification';

interface PermissionConfig {
  title: string;
  description: string;
  icon?: string;
}

const PERMISSION_CONFIGS: Record<PermissionType, PermissionConfig> = {
  location: {
    title: 'Location Access',
    description:
      'Allow access to your location to show\nnearby events and improve\nrecommendations.',
  },
  camera: {
    title: 'Camera Access',
    description: 'Allow access to your camera to take\nprofile pictures and share moments.',
  },
  notification: {
    title: 'Notification Access',
    description: 'Allow notifications to stay updated\nabout matches, messages, and events.',
  },
};

interface PermissionOverlayProps {
  visible: boolean;
  type: PermissionType;
  onAccept: () => void;
  onRefuse: () => void;
  customTitle?: string;
  customDescription?: string;
}

/**
 * Generic permission request overlay
 * Supports different permission types with consistent UI
 */
const PermissionOverlay: React.FC<PermissionOverlayProps> = ({
  visible,
  type,
  onAccept,
  onRefuse,
  customTitle,
  customDescription,
}) => {
  const config = PERMISSION_CONFIGS[type];
  const title = customTitle || config.title;
  const description = customDescription || config.description;

  const handleClose = () => {
    // For permission overlay, we don't want to close without action
  };

  return (
    <Overlay
      visible={visible}
      onClose={handleClose}
      type="center"
      dismissOnBackdropPress={false}
      showBackButton={false}
      showCloseButton={false}
      darkBackground={true}
      alignTop={true}
    >
      <View style={styles.container}>
        {/* Title */}
        <Text style={styles.title}>{title}</Text>

        {/* Description */}
        <Text style={styles.description}>{description}</Text>

        {/* Action Buttons */}
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={[styles.button, styles.refuseButton]}
            onPress={onRefuse}
            activeOpacity={0.8}
          >
            <Text style={styles.refuseButtonText}>Refuse</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.acceptButton]}
            onPress={onAccept}
            activeOpacity={0.8}
          >
            <Text style={styles.acceptButtonText}>Accept</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Overlay>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.white,
    textAlign: 'center',
    marginBottom: 16,
  },
  description: {
    fontSize: 14,
    color: COLORS.white,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
    opacity: 0.9,
  },
  buttonContainer: {
    flexDirection: 'row',
    width: '100%',
    gap: 12,
  },
  button: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  refuseButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  acceptButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
  },
  refuseButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '600',
  },
  acceptButtonText: {
    color: COLORS.dark,
    fontSize: 16,
    fontWeight: '600',
  },
});

export default PermissionOverlay;
