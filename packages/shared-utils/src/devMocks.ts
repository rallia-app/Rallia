/**
 * Dev-mode toggle for short-circuiting paid/quota-limited third-party APIs
 * (Google Places, Geocoding, Time Zone) with canned fixtures.
 *
 * Default: on in dev, off in prod.
 * Override with USE_API_MOCKS / NEXT_PUBLIC_USE_API_MOCKS / EXPO_PUBLIC_USE_API_MOCKS
 * set to "true" or "false".
 */

declare const __DEV__: boolean | undefined;

let loggedOnce = false;

export function shouldUseApiMocks(): boolean {
  const flag =
    (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_USE_API_MOCKS) ||
    (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_USE_API_MOCKS) ||
    (typeof process !== 'undefined' && process.env?.USE_API_MOCKS);

  let result: boolean;
  if (flag === 'false') {
    result = false;
  } else if (flag === 'true') {
    result = true;
  } else if (typeof __DEV__ !== 'undefined') {
    result = Boolean(__DEV__);
  } else {
    result = (typeof process !== 'undefined' && process.env?.NODE_ENV) !== 'production';
  }

  if (result && !loggedOnce) {
    loggedOnce = true;
    // eslint-disable-next-line no-console
    console.info(
      '[dev-mocks] API mocks active — Google Places/Geocoding/Time Zone calls return canned data. Set USE_API_MOCKS=false to hit real APIs.'
    );
  }
  return result;
}
