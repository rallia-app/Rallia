import { PostHog } from 'posthog-node';

let posthogServerClient: PostHog | null = null;

export function getPostHogServer(): PostHog {
  if (!posthogServerClient) {
    posthogServerClient = new PostHog(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
      host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
      flushAt: 1,
      flushInterval: 0,
    });
  }
  return posthogServerClient;
}
