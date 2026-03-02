import { PostHogProvider as PHProvider } from 'posthog-react-native';

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const apiKey = process.env.EXPO_PUBLIC_POSTHOG_KEY;

  if (!apiKey) {
    return <>{children}</>;
  }

  return (
    <PHProvider
      apiKey={apiKey}
      options={{
        host: process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
        enableSessionReplay: false,
        captureAppLifecycleEvents: true,
      }}
      autocapture={{
        captureTouches: true,
        captureScreens: true,
      }}
    >
      {children}
    </PHProvider>
  );
}
