/**
 * InviteQRScannerModal
 * Unified scanner for any Rallia QR code:
 *   - https://rallia.app/join/{8-char}            → join group
 *   - https://rallia.app/community/join/{8-char}  → request to join community
 *   - https://rallia.app/match/{uuid}             → open match detail sheet
 *   - raw 8-char invite code                       → group / community (auto-detected)
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
import { Text, useToast } from '@rallia/shared-components';
import { useJoinByInviteCode } from '@rallia/shared-hooks';
import { getMatchWithDetails } from '@rallia/shared-services';

import { useThemeStyles, useTranslation } from '#/hooks';
import * as Analytics from '#/services/analytics';
import type { MatchDetailData } from '#/context/MatchDetailSheetContext';
import { getJoinErrorToastMessage } from '#/utils/joinErrorToast';
import { parseRalliaLink } from '#/utils/ralliaLink';

export const parseRalliaQR = parseRalliaLink;

export interface InviteScanJoinResult {
  kind: 'group' | 'community';
  networkId: string;
  name: string;
  sportId?: string | null;
}

interface InviteQRScannerModalProps {
  visible: boolean;
  onClose: () => void;
  playerId: string;
  onJoined: (result: InviteScanJoinResult) => void;
  onMatchScanned: (match: MatchDetailData) => void;
}

const NON_RETRYABLE_PREFIXES = [
  'RATING_TOO_LOW',
  'RATING_REQUIRED',
  'CERTIFIED_REQUIRED',
  'ALREADY_MEMBER',
  'PENDING_REQUEST',
];

function isNonRetryable(message: string | undefined): boolean {
  if (!message) return false;
  return NON_RETRYABLE_PREFIXES.some(prefix => message.includes(prefix));
}

export function InviteQRScannerModal({
  visible,
  onClose,
  playerId,
  onJoined,
  onMatchScanned,
}: InviteQRScannerModalProps) {
  const { colors } = useThemeStyles();
  const { t } = useTranslation();
  const toast = useToast();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const cameraRef = useRef<CameraView>(null);

  const joinMutation = useJoinByInviteCode();

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

  const showRetryAlert = useCallback(
    (title: string, message: string) => {
      Alert.alert(title, message, [
        {
          text: t('inviteScanner.tryAgain'),
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
    },
    [onClose, t]
  );

  const handleScan = useCallback(
    async (raw: string) => {
      if (scanned || isProcessing) return;
      setScanned(true);
      setIsProcessing(true);

      const parsed = parseRalliaQR(raw);

      if (!parsed) {
        showRetryAlert(t('inviteScanner.invalidTitle'), t('inviteScanner.invalidMessage'));
        return;
      }

      if (parsed.kind === 'match') {
        try {
          const match = await getMatchWithDetails(parsed.matchId);
          if (!match) {
            showRetryAlert(
              t('inviteScanner.matchNotFoundTitle'),
              t('inviteScanner.matchNotFoundMessage')
            );
            return;
          }
          Analytics.matchOpenedFromQR();
          onClose();
          onMatchScanned(match as MatchDetailData);
        } catch {
          showRetryAlert(
            t('inviteScanner.matchNotFoundTitle'),
            t('inviteScanner.matchNotFoundMessage')
          );
        }
        return;
      }

      const handleJoinFailure = (rawError: string | undefined) => {
        if (isNonRetryable(rawError)) {
          onClose();
          toast.error(getJoinErrorToastMessage(rawError, t));
          return;
        }
        showRetryAlert(
          t('inviteScanner.joinFailedTitle'),
          rawError || t('inviteScanner.joinFailedMessage')
        );
      };

      try {
        const result = await joinMutation.mutateAsync({
          inviteCode: parsed.code,
          playerId,
        });

        if (!result.success) {
          handleJoinFailure(result.error);
          return;
        }

        if (result.kind === 'group') {
          Analytics.groupJoined({ source: 'qr' });
        } else {
          Analytics.communityJoined({ source: 'qr' });
        }

        onClose();
        onJoined({
          kind: result.kind,
          networkId: result.networkId,
          name: result.name,
          sportId: result.sportId ?? null,
        });
      } catch (error) {
        handleJoinFailure(error instanceof Error ? error.message : undefined);
      }
    },
    [
      scanned,
      isProcessing,
      joinMutation,
      playerId,
      onClose,
      onJoined,
      onMatchScanned,
      showRetryAlert,
      toast,
      t,
    ]
  );

  const handleManualSubmit = useCallback(() => {
    const code = manualCode.trim();
    if (!code) {
      Alert.alert(t('common.error'), t('inviteScanner.pleaseEnterInviteCode'));
      return;
    }
    handleScan(code);
  }, [manualCode, handleScan, t]);

  const toggleTorch = useCallback(() => {
    setTorchEnabled(prev => !prev);
  }, []);

  const handleRequestPermission = useCallback(async () => {
    const result = await requestPermission();
    if (!result.granted) {
      Alert.alert(
        t('inviteScanner.cameraPermissionRequired'),
        t('inviteScanner.cameraPermissionMessage'),
        [
          { text: t('common.cancel'), style: 'cancel', onPress: onClose },
          { text: t('inviteScanner.openSettings'), onPress: () => Linking.openSettings() },
        ]
      );
    }
  }, [requestPermission, onClose, t]);

  const renderPermissionRequest = () => (
    <View style={styles.permissionContainer}>
      <Ionicons name="camera-outline" size={64} color={colors.textMuted} />
      <Text
        weight="semibold"
        size="lg"
        style={{ color: colors.text, marginTop: 16, textAlign: 'center' }}
      >
        {t('inviteScanner.cameraAccessRequired')}
      </Text>
      <Text
        style={{
          color: colors.textSecondary,
          marginTop: 8,
          textAlign: 'center',
          paddingHorizontal: 32,
        }}
      >
        {t('inviteScanner.cameraAccessDescription')}
      </Text>
      <TouchableOpacity
        style={[styles.permissionButton, { backgroundColor: colors.primary }]}
        onPress={handleRequestPermission}
      >
        <Text weight="semibold" style={{ color: '#FFFFFF' }}>
          {t('inviteScanner.allowCameraAccess')}
        </Text>
      </TouchableOpacity>
    </View>
  );

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
          {t('inviteScanner.enterInviteCode')}
        </Text>
        <Text style={{ color: colors.textSecondary, marginTop: 8, textAlign: 'center' }}>
          {t('inviteScanner.enterInviteCodeDescription')}
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
              {t('inviteScanner.scanQR')}
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
                  {t('inviteScanner.join')}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );

  const renderScanner = () => (
    <View style={styles.scannerContainer}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFillObject}
        facing="back"
        enableTorch={torchEnabled}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={scanned ? undefined : ({ data }) => handleScan(data)}
      />

      <View style={styles.overlay}>
        <View style={styles.overlayTop} />

        <View style={styles.overlayMiddle}>
          <View style={styles.overlaySide} />
          <View style={styles.scanFrame}>
            <View style={[styles.corner, styles.cornerTopLeft]} />
            <View style={[styles.corner, styles.cornerTopRight]} />
            <View style={[styles.corner, styles.cornerBottomLeft]} />
            <View style={[styles.corner, styles.cornerBottomRight]} />
          </View>
          <View style={styles.overlaySide} />
        </View>

        <View style={styles.overlayBottom}>
          <Text weight="medium" style={styles.instructionText}>
            {isProcessing ? t('inviteScanner.processing') : t('inviteScanner.instructions')}
          </Text>
          {isProcessing && (
            <ActivityIndicator size="small" color="#FFFFFF" style={{ marginTop: 12 }} />
          )}

          {!isProcessing && (
            <View style={styles.scannerControls}>
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
                  {torchEnabled ? t('inviteScanner.lightOn') : t('inviteScanner.lightOff')}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.controlButton}
                onPress={() => setShowManualEntry(true)}
              >
                <Ionicons name="keypad-outline" size={24} color="#FFFFFF" />
                <Text size="xs" style={styles.controlButtonText}>
                  {t('inviteScanner.enterCode')}
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
        <View style={[styles.header, { backgroundColor: 'rgba(0,0,0,0.7)' }]}>
          <View style={styles.headerSpacer} />
          <Text weight="semibold" size="lg" style={styles.headerTitle}>
            {t('inviteScanner.title')}
          </Text>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Ionicons name="close-outline" size={28} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

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
