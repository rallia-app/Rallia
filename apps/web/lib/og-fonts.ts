const FONT_URLS = {
  poppinsBold: 'https://fonts.gstatic.com/s/poppins/v24/pxiByp8kv8JHgFVrLCz7V1s.ttf',
  poppinsSemiBold: 'https://fonts.gstatic.com/s/poppins/v24/pxiByp8kv8JHgFVrLEj6V1s.ttf',
  /** Poppins ExtraBold Italic — the result poster's hero and ghost numeral. */
  poppinsExtraBoldItalic: 'https://fonts.gstatic.com/s/poppins/v24/pxiDyp8kv8JHgFVrJJLm111lEA.ttf',
  interMedium:
    'https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuI6fMZg.ttf',
} as const;

export interface OgFonts {
  poppinsBold: ArrayBuffer;
  poppinsSemiBold: ArrayBuffer;
  poppinsExtraBoldItalic: ArrayBuffer;
  interMedium: ArrayBuffer;
}

let cache: Promise<OgFonts> | null = null;

async function fetchFont(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OG font fetch failed (${res.status}): ${url}`);
  return res.arrayBuffer();
}

/**
 * Fonts for OG image rendering. Fetched lazily on first render — never at
 * module load, where a rejection is unhandled (no stack, blamed on whatever
 * route triggered the import) and a transient failure poisons the instance
 * for its lifetime. A failed load clears the cache so the next render retries.
 */
export function loadOgFonts(): Promise<OgFonts> {
  cache ??= Promise.all([
    fetchFont(FONT_URLS.poppinsBold),
    fetchFont(FONT_URLS.poppinsSemiBold),
    fetchFont(FONT_URLS.poppinsExtraBoldItalic),
    fetchFont(FONT_URLS.interMedium),
  ])
    .then(([poppinsBold, poppinsSemiBold, poppinsExtraBoldItalic, interMedium]) => ({
      poppinsBold,
      poppinsSemiBold,
      poppinsExtraBoldItalic,
      interMedium,
    }))
    .catch(err => {
      cache = null;
      throw err;
    });
  return cache;
}
