// PGRST002 = PostgREST reloading its schema cache; the request never reached Postgres.
export const SCHEMA_CACHE_ERROR_CODE = 'PGRST002';
// PGRST303 = PostgREST rejected the bearer as expired; a refreshed token can replay it.
export const JWT_EXPIRED_ERROR_CODE = 'PGRST303';

const RETRY_DELAYS_MS = [750, 1500];

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface SupabaseRetryOptions {
  sleep?: (ms: number) => Promise<void>;
  // Returns a fresh access token, or null when the session cannot be refreshed.
  refreshAccessToken?: () => Promise<string | null>;
}

async function hasErrorCode(response: Response, status: number, code: string): Promise<boolean> {
  if (response.status !== status) return false;
  try {
    const body = (await response.clone().json()) as { code?: unknown };
    return body?.code === code;
  } catch {
    return false;
  }
}

function canReplay(init?: RequestInit): boolean {
  const body = init?.body;
  return body == null || typeof body === 'string';
}

function bearerOf(init?: RequestInit): string | null {
  const headers = new Headers(init?.headers);
  const value = headers.get('Authorization');
  return value?.startsWith('Bearer ') ? value.slice('Bearer '.length) : null;
}

function withBearer(init: RequestInit | undefined, token: string): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return { ...init, headers };
}

export function withSupabaseRetries(
  baseFetch: FetchLike,
  options: SupabaseRetryOptions = {}
): FetchLike {
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  let refreshInFlight: Promise<string | null> | null = null;

  // Concurrent 303s share one refresh so a rotated refresh token isn't reused.
  const refreshOnce = (): Promise<string | null> => {
    if (!options.refreshAccessToken) return Promise.resolve(null);
    if (!refreshInFlight) {
      refreshInFlight = options
        .refreshAccessToken()
        .catch(() => null)
        .finally(() => {
          refreshInFlight = null;
        });
    }
    return refreshInFlight;
  };

  return async (input, init) => {
    let response = await baseFetch(input, init);
    if (!canReplay(init)) return response;

    for (const delay of RETRY_DELAYS_MS) {
      if (!(await hasErrorCode(response, 503, SCHEMA_CACHE_ERROR_CODE))) break;
      await sleep(delay);
      response = await baseFetch(input, init);
    }

    if (await hasErrorCode(response, 401, JWT_EXPIRED_ERROR_CODE)) {
      const staleToken = bearerOf(init);
      const freshToken = staleToken ? await refreshOnce() : null;
      if (freshToken && freshToken !== staleToken) {
        response = await baseFetch(input, withBearer(init, freshToken));
      }
    }

    return response;
  };
}
