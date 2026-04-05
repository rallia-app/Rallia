import { PostHog, PostHogProvider as PHProvider } from 'posthog-react-native';

const isProduction = process.env.EXPO_PUBLIC_APP_ENV === 'production';
const isEnabled = isProduction && !!process.env.EXPO_PUBLIC_POSTHOG_KEY;

/**
 * Pre-instantiated PostHog client (docs pattern #2).
 * Created at module level so it's available immediately — no React context needed.
 * Exported for direct use in analytics.ts and App.tsx identify/screen calls.
 */
export const posthogClient: PostHog | undefined = isEnabled
  ? new PostHog(process.env.EXPO_PUBLIC_POSTHOG_KEY!, {
      host: process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
      enableSessionReplay: false,
      captureAppLifecycleEvents: true,
    })
  : undefined;

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  if (!posthogClient) {
    return <>{children}</>;
  }

  return (
    <PHProvider
      client={posthogClient}
      autocapture={{
        captureTouches: true,
        captureScreens: false,
      }}
    >
      {children}
    </PHProvider>
  );
}
