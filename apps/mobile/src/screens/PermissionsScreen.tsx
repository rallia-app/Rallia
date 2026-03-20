/**
 * PermissionsScreen
 * Allows users to view and manage app permissions.
 * Displays each permission with status and controls to request or open settings.
 */

import React, { useMemo, useCallback, useState, useEffect } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text, Button } from '@rallia/shared-components';
import { useTheme } from '@rallia/shared-hooks';
import { useTranslation } from '../hooks';
import {
  lightTheme,
  darkTheme,
  spacingPixels,
  radiusPixels,
  primary,
  neutral,
  status,
} from '@rallia/design-system';
import { lightHaptic, successHaptic, warningHaptic } from '@rallia/shared-utils';

// Permission imports
import * as Notifications from 'expo-notifications';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import * as Contacts from 'expo-contacts';
import { Camera } from 'expo-camera';

const BASE_WHITE = '#ffffff';

// Permission types
type PermissionType = 'notifications' | 'location' | 'photos' | 'contacts' | 'camera';
type PermissionStatus = 'granted' | 'denied' | 'undetermined' | 'loading';

interface PermissionInfo {
  type: PermissionType;
  status: PermissionStatus;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
}

// Permission configuration
const PERMISSION_CONFIG: Record<
  PermissionType,
  { icon: keyof typeof Ionicons.glyphMap; color: string }
> = {
  notifications: { icon: 'notifications-outline', color: '#FF9500' },
  location: { icon: 'location-outline', color: '#007AFF' },
  photos: { icon: 'images-outline', color: '#AF52DE' },
  contacts: { icon: 'people-outline', color: '#5856D6' },
  camera: { icon: 'camera-outline', color: '#FF2D55' },
};

function useColors() {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const themeColors = isDark ? darkTheme : lightTheme;

  return useMemo(
    () => ({
      background: themeColors.background,
      cardBackground: themeColors.card,
      text: themeColors.foreground,
      textSecondary: isDark ? primary[300] : neutral[600],
      textMuted: themeColors.mutedForeground,
      border: themeColors.border,
      icon: themeColors.foreground,
      iconMuted: themeColors.mutedForeground,
      buttonActive: isDark ? primary[500] : primary[600],
      buttonTextActive: BASE_WHITE,
      buttonInactive: themeColors.muted,
      success: status.success.DEFAULT,
      error: status.error.DEFAULT,
      warning: status.warning.DEFAULT,
    }),
    [themeColors, isDark]
  );
}

interface PermissionRowProps {
  permission: PermissionInfo;
  onRequest: () => void;
  onOpenSettings: () => void;
  isRequesting: boolean;
  colors: ReturnType<typeof useColors>;
  label: string;
  statusLabel: string;
}

const PermissionRow: React.FC<PermissionRowProps> = ({
  permission,
  onRequest,
  onOpenSettings,
  isRequesting,
  colors,
  label,
  statusLabel,
}) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const getStatusColor = () => {
    switch (permission.status) {
      case 'granted':
        return colors.success;
      case 'denied':
        return colors.error;
      case 'undetermined':
        return colors.warning;
      default:
        return colors.textMuted;
    }
  };

  const getStatusIcon = (): keyof typeof Ionicons.glyphMap => {
    switch (permission.status) {
      case 'granted':
        return 'checkmark-circle';
      case 'denied':
        return 'close-circle';
      case 'undetermined':
        return 'help-circle';
      default:
        return 'ellipse';
    }
  };

  const canRequest = permission.status === 'undetermined';
  const needsSettings = permission.status === 'denied';

  return (
    <View style={[styles.permissionRow, { borderBottomColor: colors.border }]}>
      <View style={styles.permissionInfo}>
        <View style={[styles.permissionIcon, { backgroundColor: `${permission.color}20` }]}>
          <Ionicons name={permission.icon} size={22} color={permission.color} />
        </View>
        <View style={styles.permissionText}>
          <Text size="base" weight="medium" color={colors.text}>
            {label}
          </Text>
          <View style={styles.statusRow}>
            <Ionicons name={getStatusIcon()} size={14} color={getStatusColor()} />
            <Text size="xs" color={getStatusColor()}>
              {statusLabel}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.actionContainer}>
        {permission.status === 'loading' ? (
          <ActivityIndicator size="small" color={colors.buttonActive} />
        ) : canRequest ? (
          <Button
            variant="primary"
            size="sm"
            loading={isRequesting}
            onPress={onRequest}
            isDark={isDark}
          >
            Allow
          </Button>
        ) : needsSettings ? (
          <Button
            variant="ghost"
            size="sm"
            onPress={onOpenSettings}
            leftIcon={<Ionicons name="settings-outline" size={16} color={colors.text} />}
            isDark={isDark}
          >
            Settings
          </Button>
        ) : (
          <View style={[styles.grantedBadge, { backgroundColor: `${colors.success}20` }]}>
            <Ionicons name="checkmark-outline" size={16} color={colors.success} />
          </View>
        )}
      </View>
    </View>
  );
};

const PermissionsScreen: React.FC = () => {
  const { t } = useTranslation();
  const colors = useColors();

  const [permissions, setPermissions] = useState<Record<PermissionType, PermissionStatus>>({
    notifications: 'loading',
    location: 'loading',
    photos: 'loading',
    contacts: 'loading',
    camera: 'loading',
  });
  const [isRequesting, setIsRequesting] = useState<PermissionType | null>(null);

  // Check all permissions on mount
  useEffect(() => {
    checkAllPermissions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkAllPermissions = async () => {
    const [notifStatus, locationStatus, photosStatus, contactsStatus, cameraStatus] =
      await Promise.all([
        checkNotificationPermission(),
        checkLocationPermission(),
        checkPhotosPermission(),
        checkContactsPermission(),
        checkCameraPermission(),
      ]);

    setPermissions({
      notifications: notifStatus,
      location: locationStatus,
      photos: photosStatus,
      contacts: contactsStatus,
      camera: cameraStatus,
    });
  };

  const checkNotificationPermission = async (): Promise<PermissionStatus> => {
    try {
      const { status } = await Notifications.getPermissionsAsync();
      return mapExpoStatus(status);
    } catch {
      return 'undetermined';
    }
  };

  const checkLocationPermission = async (): Promise<PermissionStatus> => {
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      return mapExpoStatus(status);
    } catch {
      return 'undetermined';
    }
  };

  const checkPhotosPermission = async (): Promise<PermissionStatus> => {
    try {
      const { status } = await ImagePicker.getMediaLibraryPermissionsAsync();
      return mapExpoStatus(status);
    } catch {
      return 'undetermined';
    }
  };

  const checkContactsPermission = async (): Promise<PermissionStatus> => {
    try {
      const { status } = await Contacts.getPermissionsAsync();
      return mapExpoStatus(status);
    } catch {
      return 'undetermined';
    }
  };

  const checkCameraPermission = async (): Promise<PermissionStatus> => {
    try {
      const { status } = await Camera.getCameraPermissionsAsync();
      return mapExpoStatus(status);
    } catch {
      return 'undetermined';
    }
  };

  const mapExpoStatus = (
    status: 'granted' | 'denied' | 'undetermined' | string
  ): PermissionStatus => {
    if (status === 'granted') return 'granted';
    if (status === 'denied') return 'denied';
    return 'undetermined';
  };

  const requestPermission = useCallback(async (type: PermissionType) => {
    lightHaptic();
    setIsRequesting(type);

    try {
      let newStatus: PermissionStatus = 'undetermined';

      switch (type) {
        case 'notifications': {
          const { status } = await Notifications.requestPermissionsAsync();
          newStatus = mapExpoStatus(status);
          break;
        }
        case 'location': {
          const { status } = await Location.requestForegroundPermissionsAsync();
          newStatus = mapExpoStatus(status);
          break;
        }
        case 'photos': {
          const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
          newStatus = mapExpoStatus(status);
          break;
        }
        case 'contacts': {
          const { status } = await Contacts.requestPermissionsAsync();
          newStatus = mapExpoStatus(status);
          break;
        }
        case 'camera': {
          const { status } = await Camera.requestCameraPermissionsAsync();
          newStatus = mapExpoStatus(status);
          break;
        }
      }

      if (newStatus === 'granted') {
        successHaptic();
      } else if (newStatus === 'denied') {
        warningHaptic();
      }

      setPermissions(prev => ({ ...prev, [type]: newStatus }));
    } catch {
      warningHaptic();
    } finally {
      setIsRequesting(null);
    }
  }, []);

  const openSettings = useCallback(() => {
    lightHaptic();
    if (Platform.OS === 'ios') {
      Linking.openURL('app-settings:');
    } else {
      Linking.openSettings();
    }
  }, []);

  const permissionList: PermissionInfo[] = useMemo(
    () =>
      (['notifications', 'location', 'photos', 'contacts', 'camera'] as PermissionType[]).map(
        type => ({
          type,
          status: permissions[type],
          ...PERMISSION_CONFIG[type],
        })
      ),
    [permissions]
  );

  const getPermissionLabel = (type: PermissionType): string => {
    return t(`permissions.types.${type}`);
  };

  const getStatusLabel = (status: PermissionStatus): string => {
    return t(`permissions.status.${status}`);
  };

  const isLoading = Object.values(permissions).some(s => s === 'loading');

  if (isLoading) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.background }]}
        edges={['bottom']}
      >
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.buttonActive} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['bottom']}
    >
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Description */}
        <View style={styles.descriptionContainer}>
          <Text size="sm" color={colors.textMuted}>
            {t('permissions.description')}
          </Text>
        </View>

        {/* Permission rows */}
        <View style={[styles.permissionsCard, { backgroundColor: colors.cardBackground }]}>
          {permissionList.map(permission => (
            <PermissionRow
              key={permission.type}
              permission={permission}
              onRequest={() => requestPermission(permission.type)}
              onOpenSettings={openSettings}
              isRequesting={isRequesting === permission.type}
              colors={colors}
              label={getPermissionLabel(permission.type)}
              statusLabel={getStatusLabel(permission.status)}
            />
          ))}
        </View>

        {/* Info note */}
        <View style={styles.infoContainer}>
          <Ionicons name="information-circle-outline" size={16} color={colors.textMuted} />
          <Text size="xs" color={colors.textMuted} style={styles.infoText}>
            {t('permissions.settingsNote')}
          </Text>
        </View>

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingVertical: spacingPixels[4],
  },
  descriptionContainer: {
    paddingHorizontal: spacingPixels[5],
    marginBottom: spacingPixels[4],
  },
  permissionsCard: {
    marginHorizontal: spacingPixels[4],
    borderRadius: radiusPixels.xl,
    overflow: 'hidden',
  },
  permissionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[4],
    borderBottomWidth: 1,
  },
  permissionInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  permissionIcon: {
    width: spacingPixels[10],
    height: spacingPixels[10],
    borderRadius: radiusPixels.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacingPixels[3],
  },
  permissionText: {
    flex: 1,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    marginTop: spacingPixels[0.5],
  },
  actionContainer: {
    marginLeft: spacingPixels[3],
  },
  grantedBadge: {
    width: spacingPixels[8],
    height: spacingPixels[8],
    borderRadius: radiusPixels.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[5],
    marginTop: spacingPixels[4],
    gap: spacingPixels[2],
  },
  infoText: {
    flex: 1,
  },
  bottomSpacer: {
    height: spacingPixels[10],
  },
});

export default PermissionsScreen;
