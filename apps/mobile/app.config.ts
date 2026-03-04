import { ExpoConfig, ConfigContext } from 'expo/config';

// Read from app.json as base
import appJson from './app.json';

export default ({ config: _config }: ConfigContext): ExpoConfig => {
  // Extract the iOS URL scheme from the iOS Client ID
  // The iOS URL scheme for Google Sign-In should be in format: com.googleusercontent.apps.CLIENT_ID
  const googleIosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '';
  let googleIosUrlScheme =
    'com.googleusercontent.apps.438904367358-9a8l1o2u2a5ap608fq88m912fppdsveq';

  if (googleIosClientId) {
    // Extract just the client ID part from formats like:
    // "438904367358-9a8l1o2u2a5ap608fq88m912fppdsveq.apps.googleusercontent.com"
    // or "438904367358-9a8l1o2u2a5ap608fq88m912fppdsveq"
    const clientIdMatch = googleIosClientId.match(/^([^.]+)/);
    const clientId = clientIdMatch ? clientIdMatch[1] : googleIosClientId;
    googleIosUrlScheme = `com.googleusercontent.apps.${clientId}`;
  }

  // Start with base config from app.json
  const baseConfig = appJson.expo as ExpoConfig;

  // Filter out plugins that need dynamic configuration
  const basePlugins = (baseConfig.plugins || []).filter(plugin => {
    if (Array.isArray(plugin)) {
      const pluginName = plugin[0];
      return pluginName !== '@react-native-google-signin/google-signin';
    }
    return true;
  });

  // Build dynamic plugins array
  const dynamicPlugins: ExpoConfig['plugins'] = [...basePlugins];

  // Add Google Sign-In with dynamic URL scheme
  dynamicPlugins.push([
    '@react-native-google-signin/google-signin',
    {
      iosUrlScheme: googleIosUrlScheme,
    },
  ]);

  // Determine app environment: production, preview, or development
  // This can be set via EXPO_PUBLIC_APP_ENV during EAS build
  const appEnv = process.env.EXPO_PUBLIC_APP_ENV || 'development';

  return {
    ...baseConfig,
    android: {
      ...baseConfig.android,
      config: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...((baseConfig.android as any)?.config || {}),
        googleMaps: {
          apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '',
        },
      },
    },
    plugins: dynamicPlugins,
    extra: {
      ...baseConfig.extra,
      appEnv,
      eas: baseConfig.extra?.eas,
    },
  };
};
