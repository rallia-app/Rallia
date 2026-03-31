import { PostHogProvider as PHProvider } from 'posthog-react-native';

const isProduction = process.env.EXPO_PUBLIC_APP_ENV === 'production';
const apiKey = process.env.EXPO_PUBLIC_POSTHOG_KEY ?? 'phc_dummy';

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  return (
    <PHProvider
      apiKey={apiKey}
      options={{
        host: process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
        disabled: !isProduction || !process.env.EXPO_PUBLIC_POSTHOG_KEY,
        enableSessionReplay: false,
        captureAppLifecycleEvents: isProduction,
      }}
      autocapture={{
        captureTouches: isProduction,
        captureScreens: false,
      }}
    >
      {children}
    </PHProvider>
  );
}
