import posthog from 'posthog-js';

if (typeof window !== 'undefined') {
  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
    api_host: '/ingest',
    ui_host: 'https://us.posthog.com',
    capture_pageview: false, // Handled manually for SPA route changes
    capture_pageleave: true,
  });
}

export default posthog;
