import { useState, useEffect } from 'react';
import * as VideoThumbnails from 'expo-video-thumbnails';

const thumbnailCache = new Map<string, string>();

/**
 * Generates and caches a thumbnail from a video URL.
 * Returns the local thumbnail URI once ready, or null while loading.
 */
export function useVideoThumbnail(videoUrl: string | undefined | null) {
  const [thumbnailUri, setThumbnailUri] = useState<string | null>(
    videoUrl ? (thumbnailCache.get(videoUrl) ?? null) : null
  );

  useEffect(() => {
    if (!videoUrl) return;

    // Already cached
    if (thumbnailCache.has(videoUrl)) {
      setThumbnailUri(thumbnailCache.get(videoUrl)!);
      return;
    }

    let cancelled = false;

    VideoThumbnails.getThumbnailAsync(videoUrl, { time: 1000 })
      .then(({ uri }) => {
        if (!cancelled) {
          thumbnailCache.set(videoUrl, uri);
          setThumbnailUri(uri);
        }
      })
      .catch(() => {
        // Silently fail — the fallback placeholder will show
      });

    return () => {
      cancelled = true;
    };
  }, [videoUrl]);

  return thumbnailUri;
}
