import {
  PostHog,
  PostHogProvider as PHProvider,
  PostHogSurveyProvider,
} from 'posthog-react-native';

const isProduction = process.env.EXPO_PUBLIC_APP_ENV === 'production';
const isEnabled = isProduction && !!process.env.EXPO_PUBLIC_POSTHOG_KEY;

if (!__DEV__ && !process.env.EXPO_PUBLIC_APP_ENV) {
  console.warn('[PostHog] EXPO_PUBLIC_APP_ENV is missing — analytics will not be reported.');
}
if (!__DEV__ && isProduction && !process.env.EXPO_PUBLIC_POSTHOG_KEY) {
  console.warn('[PostHog] EXPO_PUBLIC_POSTHOG_KEY is missing — analytics will not be reported.');
}

/**
 * Pre-instantiated PostHog client (docs pattern #2).
 * Created at module level so it's available immediately — no React context needed.
 * Exported for direct use in analytics.ts and App.tsx identify/screen calls.
 */
export const posthogClient: PostHog | undefined = isEnabled
  ? new PostHog(process.env.EXPO_PUBLIC_POSTHOG_KEY, {
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
        // Touch autocapture disabled: per-tap tree traversal added latency in prod.
        captureTouches: false,
        captureScreens: false,
      }}
    >
      <PostHogSurveyProvider client={posthogClient}>{children}</PostHogSurveyProvider>
    </PHProvider>
  );
}
