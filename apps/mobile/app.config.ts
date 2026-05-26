import { ExpoConfig, ConfigContext } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
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

  // Start with base config from app.json (merged by Expo via ConfigContext)
  const baseConfig = config;

  // Meta (Facebook) SDK credentials — pulled from env so the same app.json
  // template ships to all build profiles. Falls back to the placeholder
  // strings in app.json when the env var is missing; prebuild still succeeds
  // but the SDK won't authenticate, which is fine for type-check / dev runs
  // without a configured Meta App.
  const fbAppId = process.env.EXPO_PUBLIC_FB_APP_ID || 'PLACEHOLDER_FB_APP_ID';
  const fbClientToken = process.env.EXPO_PUBLIC_FB_CLIENT_TOKEN || 'PLACEHOLDER_FB_CLIENT_TOKEN';

  // Filter out plugins that need dynamic configuration
  const basePlugins = (baseConfig.plugins || []).filter(plugin => {
    if (Array.isArray(plugin)) {
      const pluginName = plugin[0];
      return (
        pluginName !== '@react-native-google-signin/google-signin' &&
        pluginName !== 'react-native-fbsdk-next'
      );
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

  // Add Meta SDK plugin with env-injected credentials. This block fully
  // replaces the react-native-fbsdk-next entry from app.json (filtered out
  // above), so the flags here — not app.json — are the source of truth.
  // advertiserIDCollection + autoLogAppEvents are enabled for Meta install
  // attribution; the AD_ID permission is declared via android.permissions.
  dynamicPlugins.push([
    'react-native-fbsdk-next',
    {
      appID: fbAppId,
      clientToken: fbClientToken,
      displayName: 'Rallia',
      scheme: `fb${fbAppId}`,
      advertiserIDCollectionEnabled: true,
      autoLogAppEventsEnabled: true,
      isAutoInitEnabled: true,
      iosUserTrackingPermission:
        'Allow tracking so $(PRODUCT_NAME) can measure which ads bring real players and personalize match suggestions. Your data is never sold.',
    },
  ]);

  // Determine app environment: production, preview, or development
  // This can be set via EXPO_PUBLIC_APP_ENV during EAS build
  const appEnv = process.env.EXPO_PUBLIC_APP_ENV || 'development';

  return {
    ...baseConfig,
    name: baseConfig.name ?? 'Rallia',
    slug: baseConfig.slug ?? 'rallia-app',
    android: {
      ...baseConfig.android,
      googleServicesFile: './google-services.json',
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
