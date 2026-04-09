import { ActionSheetIOS, Alert, Linking, Platform } from 'react-native';

interface OpenInMapsOptions {
  latitude?: number | null;
  longitude?: number | null;
  address?: string | null;
  label?: string;
}

export function openInMaps({ latitude, longitude, address, label }: OpenInMapsOptions) {
  const hasCoords = latitude != null && longitude != null;
  if (!hasCoords && !address) return;

  const encodedAddress = address ? encodeURIComponent(address) : '';
  const encodedLabel = label ? encodeURIComponent(label) : '';

  const mapApps: { name: string; url: string }[] = [];

  if (Platform.OS === 'ios') {
    const appleUrl = hasCoords
      ? `maps:0,0?q=${encodedLabel || `${latitude},${longitude}`}&ll=${latitude},${longitude}`
      : `maps:0,0?q=${encodedAddress}`;
    mapApps.push({ name: 'Apple Maps', url: appleUrl });
  }

  const googleUrl = hasCoords
    ? `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`
    : `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;
  mapApps.push({ name: 'Google Maps', url: googleUrl });

  const wazeUrl = hasCoords
    ? `https://waze.com/ul?ll=${latitude},${longitude}&navigate=yes`
    : `https://waze.com/ul?q=${encodedAddress}&navigate=yes`;
  mapApps.push({ name: 'Waze', url: wazeUrl });

  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: [...mapApps.map(a => a.name), 'Cancel'],
        cancelButtonIndex: mapApps.length,
      },
      buttonIndex => {
        if (buttonIndex < mapApps.length) {
          Linking.openURL(mapApps[buttonIndex].url).catch(() => {});
        }
      }
    );
  } else {
    Alert.alert('Open in Maps', undefined, [
      ...mapApps.map(app => ({
        text: app.name,
        onPress: () => Linking.openURL(app.url).catch(() => {}),
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }
}
