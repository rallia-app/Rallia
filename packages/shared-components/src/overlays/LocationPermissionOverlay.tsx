import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Overlay from '../Overlay';
import { COLORS } from '@rallia/design-system';

interface LocationPermissionOverlayProps {
  visible: boolean;
  onAccept: () => void;
  onRefuse: () => void;
}

const LocationPermissionOverlay: React.FC<LocationPermissionOverlayProps> = ({
  visible,
  onAccept,
  onRefuse,
}) => {
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
        <Text style={styles.title}>Location Access</Text>

        {/* Description */}
        <Text style={styles.description}>
          Allow access to your location to show{'\n'}
          nearby events and improve{'\n'}
          recommendations.
        </Text>

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

export default LocationPermissionOverlay;
