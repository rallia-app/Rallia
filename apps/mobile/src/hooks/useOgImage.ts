import { useState, useEffect } from 'react';

const ogImageCache = new Map<string, string | false>();

/**
 * Fetches and caches the Open Graph image (og:image) from a URL.
 * Returns the image URI once ready, or null while loading / on failure.
 */
export function useOgImage(url: string | undefined | null) {
  const [imageUri, setImageUri] = useState<string | null>(
    url && ogImageCache.has(url) ? ogImageCache.get(url) || null : null
  );

  useEffect(() => {
    if (!url) return;

    // Already resolved (image or known failure)
    if (ogImageCache.has(url)) {
      const cached = ogImageCache.get(url);
      setImageUri(cached || null);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        const response = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'Rallia/1.0 (Link Preview)' },
        });
        clearTimeout(timeoutId);

        // Only parse HTML responses
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('text/html')) {
          ogImageCache.set(url, false);
          return;
        }

        // Read only the first chunk to find og:image in <head>
        const text = await response.text();
        const headEnd = text.indexOf('</head>');
        const head = headEnd > -1 ? text.slice(0, headEnd) : text.slice(0, 8000);

        // Match og:image content — handles both quote styles and attribute order
        const match =
          head.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/) ||
          head.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/);

        if (!cancelled) {
          const ogImage = match?.[1] || null;
          ogImageCache.set(url, ogImage || false);
          setImageUri(ogImage);
        }
      } catch {
        // Silently fail — the fallback placeholder will show
        if (!cancelled) {
          ogImageCache.set(url, false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url]);

  return imageUri;
}
