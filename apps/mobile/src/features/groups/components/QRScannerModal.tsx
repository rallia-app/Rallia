/**
 * QRScannerModal
 * Modal with camera view for scanning group invite QR codes
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Linking,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@rallia/shared-components';
import { useThemeStyles, useTranslation } from '../../../hooks';
import { useJoinGroupByInviteCode } from '@rallia/shared-hooks';
import * as Analytics from '../../../services/analytics';

interface QRScannerModalProps {
  visible: boolean;
  onClose: () => void;
  playerId: string;
  onGroupJoined: (groupId: string, groupName: string) => void;
}

export function QRScannerModal({ visible, onClose, playerId, onGroupJoined }: QRScannerModalProps) {
  const { colors } = useThemeStyles();
  const { t } = useTranslation();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const cameraRef = useRef<CameraView>(null);

  const joinGroupMutation = useJoinGroupByInviteCode();

  // Reset scanned state when modal opens
  // This effect resets modal state when it becomes visible - standard modal reset pattern
  useEffect(() => {
    if (visible) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional reset of modal state on open
      setScanned(false);
      setIsProcessing(false);
      setTorchEnabled(false);
      setShowManualEntry(false);
      setManualCode('');
    }
  }, [visible]);

  // Extract invite code from URL or raw code
  const extractInviteCode = useCallback((data: string): string | null => {
    // Check if it's a full URL (e.g., https://rallia.app/join/ABC12345)
    const urlMatch = data.match(/\/join\/([A-Z0-9]{8})/i);
    if (urlMatch) {
      return urlMatch[1].toUpperCase();
    }

    // Check if it's just the code (8 alphanumeric characters)
    const codeMatch = data.match(/^[A-Z0-9]{8}$/i);
    if (codeMatch) {
      return data.toUpperCase();
    }

    return null;
  }, []);

  const handleBarCodeScanned = useCallback(
    async ({ data }: { data: string }) => {
      if (scanned || isProcessing) return;

      setScanned(true);
      setIsProcessing(true);

      const inviteCode = extractInviteCode(data);

      if (!inviteCode) {
        Alert.alert(t('groups.invalidQRCode'), t('groups.invalidQRCodeMessage'), [
          {
            text: t('groups.tryAgain'),
            onPress: () => {
              setScanned(false);
              setIsProcessing(false);
            },
          },
          {
            text: t('common.cancel'),
            style: 'cancel',
            onPress: onClose,
          },
        ]);
        return;
      }

      try {
        const result = await joinGroupMutation.mutateAsync({
          inviteCode,
          playerId,
        });

        if (result.success && result.groupId && result.groupName) {
          Analytics.groupJoined({ source: 'qr' });
          onClose();
          onGroupJoined(result.groupId, result.groupName);
        } else {
          Alert.alert(t('groups.couldNotJoin'), result.error || t('groups.failedToJoinGroup'), [
            {
              text: t('groups.tryAgain'),
              onPress: () => {
                setScanned(false);
                setIsProcessing(false);
              },
            },
            {
              text: t('common.cancel'),
              style: 'cancel',
              onPress: onClose,
            },
          ]);
        }
      } catch (error) {
        Alert.alert(
          t('common.error'),
          error instanceof Error ? error.message : t('groups.failedToJoinGroup'),
          [
            {
              text: t('groups.tryAgain'),
              onPress: () => {
                setScanned(false);
                setIsProcessing(false);
              },
            },
            {
              text: t('common.cancel'),
              style: 'cancel',
              onPress: onClose,
            },
          ]
        );
      }
    },
    [
      scanned,
      isProcessing,
      extractInviteCode,
      joinGroupMutation,
      playerId,
      onClose,
      onGroupJoined,
      t,
    ]
  );

  // Handle manual code submission
  const handleManualSubmit = useCallback(() => {
    if (!manualCode.trim()) {
      Alert.alert(t('common.error'), t('groups.pleaseEnterInviteCode'));
      return;
    }
    // Simulate barcode scan with manual entry
    handleBarCodeScanned({ data: manualCode.trim().toUpperCase() });
  }, [manualCode, handleBarCodeScanned, t]);

  // Toggle flashlight
  const toggleTorch = useCallback(() => {
    setTorchEnabled(prev => !prev);
  }, []);

  const handleRequestPermission = useCallback(async () => {
    const result = await requestPermission();
    if (!result.granted) {
      Alert.alert(t('groups.cameraPermissionRequired'), t('groups.cameraPermissionMessage'), [
        { text: t('common.cancel'), style: 'cancel', onPress: onClose },
        { text: t('groups.openSettings'), onPress: () => Linking.openSettings() },
      ]);
    }
  }, [requestPermission, onClose, t]);

  // Render permission request screen
  const renderPermissionRequest = () => (
    <View style={styles.permissionContainer}>
      <Ionicons name="camera-outline" size={64} color={colors.textMuted} />
      <Text
        weight="semibold"
        size="lg"
        style={{ color: colors.text, marginTop: 16, textAlign: 'center' }}
      >
        {t('groups.cameraAccessRequired')}
      </Text>
      <Text
        style={{
          color: colors.textSecondary,
          marginTop: 8,
          textAlign: 'center',
          paddingHorizontal: 32,
        }}
      >
        {t('groups.cameraAccessDescription')}
      </Text>
      <TouchableOpacity
        style={[styles.permissionButton, { backgroundColor: colors.primary }]}
        onPress={handleRequestPermission}
      >
        <Text weight="semibold" style={{ color: '#FFFFFF' }}>
          {t('groups.allowCameraAccess')}
        </Text>
      </TouchableOpacity>
    </View>
  );

  // Render manual entry form
  const renderManualEntry = () => (
    <KeyboardAvoidingView
      style={styles.manualEntryContainer}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.manualEntryContent}>
        <Ionicons name="keypad-outline" size={48} color={colors.textMuted} />
        <Text
          weight="semibold"
          size="lg"
          style={{ color: colors.text, marginTop: 16, textAlign: 'center' }}
        >
          {t('groups.enterInviteCode')}
        </Text>
        <Text style={{ color: colors.textSecondary, marginTop: 8, textAlign: 'center' }}>
          {t('groups.enterInviteCodeDescription')}
        </Text>

        <TextInput
          style={[
            styles.manualInput,
            {
              backgroundColor: colors.inputBackground,
              color: colors.text,
              borderColor: colors.border,
            },
          ]}
          placeholder="ABC12345"
          placeholderTextColor={colors.textMuted}
          value={manualCode}
          onChangeText={text => setManualCode(text.toUpperCase())}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={8}
          returnKeyType="done"
          onSubmitEditing={handleManualSubmit}
        />

        <View style={styles.manualEntryButtons}>
          <TouchableOpacity
            style={[styles.manualEntryButton, { backgroundColor: colors.border }]}
            onPress={() => setShowManualEntry(false)}
          >
            <Ionicons name="camera-outline" size={20} color={colors.text} />
            <Text weight="medium" style={{ color: colors.text, marginLeft: 8 }}>
              {t('groups.scanQR')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.manualEntryButton, { backgroundColor: colors.primary }]}
            onPress={handleManualSubmit}
            disabled={isProcessing || manualCode.length < 8}
          >
            {isProcessing ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <Ionicons name="arrow-forward-outline" size={20} color="#FFFFFF" />
                <Text weight="medium" style={{ color: '#FFFFFF', marginLeft: 8 }}>
                  {t('groups.join')}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );

  // Render scanner
  const renderScanner = () => (
    <View style={styles.scannerContainer}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFillObject}
        facing="back"
        enableTorch={torchEnabled}
        barcodeScannerSettings={{
          barcodeTypes: ['qr'],
        }}
        onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
      />

      {/* Overlay with scan frame */}
      <View style={styles.overlay}>
        {/* Top dark area */}
        <View style={styles.overlayTop} />

        {/* Middle row with scan frame */}
        <View style={styles.overlayMiddle}>
          <View style={styles.overlaySide} />

          {/* Scan frame */}
          <View style={styles.scanFrame}>
            {/* Corner markers */}
            <View style={[styles.corner, styles.cornerTopLeft]} />
            <View style={[styles.corner, styles.cornerTopRight]} />
            <View style={[styles.corner, styles.cornerBottomLeft]} />
            <View style={[styles.corner, styles.cornerBottomRight]} />
          </View>

          <View style={styles.overlaySide} />
        </View>

        {/* Bottom dark area with instructions and controls */}
        <View style={styles.overlayBottom}>
          <Text weight="medium" style={styles.instructionText}>
            {isProcessing ? t('groups.processing') : t('groups.pointAtQRCode')}
          </Text>
          {isProcessing && (
            <ActivityIndicator size="small" color="#FFFFFF" style={{ marginTop: 12 }} />
          )}

          {/* Scanner controls */}
          {!isProcessing && (
            <View style={styles.scannerControls}>
              {/* Flashlight toggle */}
              <TouchableOpacity
                style={[styles.controlButton, torchEnabled && styles.controlButtonActive]}
                onPress={toggleTorch}
              >
                <Ionicons
                  name={torchEnabled ? 'flash' : 'flash-outline'}
                  size={24}
                  color="#FFFFFF"
                />
                <Text size="xs" style={styles.controlButtonText}>
                  {torchEnabled ? t('groups.lightOn') : t('groups.lightOff')}
                </Text>
              </TouchableOpacity>

              {/* Manual entry */}
              <TouchableOpacity
                style={styles.controlButton}
                onPress={() => setShowManualEntry(true)}
              >
                <Ionicons name="keypad-outline" size={24} color="#FFFFFF" />
                <Text size="xs" style={styles.controlButtonText}>
                  {t('groups.enterCode')}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </View>
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={[styles.header, { backgroundColor: 'rgba(0,0,0,0.7)' }]}>
          <View style={styles.headerSpacer} />
          <Text weight="semibold" size="lg" style={styles.headerTitle}>
            {t('groups.scanQRCode')}
          </Text>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Ionicons name="close-outline" size={28} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        {/* Content */}
        {!permission?.granted
          ? renderPermissionRequest()
          : showManualEntry
            ? renderManualEntry()
            : renderScanner()}
      </View>
    </Modal>
  );
}

const SCAN_FRAME_SIZE = 250;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 60,
    paddingBottom: 16,
    paddingHorizontal: 16,
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  closeButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    color: '#FFFFFF',
  },
  headerSpacer: {
    width: 44,
  },
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  permissionButton: {
    marginTop: 24,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
  },
  scannerContainer: {
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlayTop: {
    flex: 1,
    width: '100%',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  overlayMiddle: {
    flexDirection: 'row',
    height: SCAN_FRAME_SIZE,
  },
  overlaySide: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  scanFrame: {
    width: SCAN_FRAME_SIZE,
    height: SCAN_FRAME_SIZE,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderColor: '#FFFFFF',
  },
  cornerTopLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: 4,
  },
  cornerTopRight: {
    top: 0,
    right: 0,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: 4,
  },
  cornerBottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: 4,
  },
  cornerBottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: 4,
  },
  overlayBottom: {
    flex: 1,
    width: '100%',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    alignItems: 'center',
    paddingTop: 32,
  },
  instructionText: {
    color: '#FFFFFF',
    fontSize: 16,
  },
  scannerControls: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 24,
    gap: 32,
  },
  controlButton: {
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    minWidth: 80,
  },
  controlButtonActive: {
    backgroundColor: 'rgba(255, 193, 7, 0.4)',
  },
  controlButtonText: {
    color: '#FFFFFF',
    marginTop: 4,
  },
  manualEntryContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  manualEntryContent: {
    alignItems: 'center',
    width: '100%',
    maxWidth: 320,
  },
  manualInput: {
    width: '100%',
    height: 56,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    fontSize: 24,
    fontWeight: '600',
    textAlign: 'center',
    letterSpacing: 4,
    marginTop: 24,
  },
  manualEntryButtons: {
    flexDirection: 'row',
    marginTop: 24,
    gap: 12,
  },
  manualEntryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
  },
});
