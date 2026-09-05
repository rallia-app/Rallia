// PGRST002 = PostgREST reloading its schema cache; the request never reached Postgres.
export const SCHEMA_CACHE_ERROR_CODE = 'PGRST002';

const RETRY_DELAYS_MS = [750, 1500];

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

async function isSchemaCacheReload(response: Response): Promise<boolean> {
  if (response.status !== 503) return false;
  try {
    const body = (await response.clone().json()) as { code?: unknown };
    return body?.code === SCHEMA_CACHE_ERROR_CODE;
  } catch {
    return false;
  }
}

function canReplay(init?: RequestInit): boolean {
  const body = init?.body;
  return body == null || typeof body === 'string';
}

export function withSchemaCacheRetry(
  baseFetch: FetchLike,
  sleep: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms))
): FetchLike {
  return async (input, init) => {
    let response = await baseFetch(input, init);
    if (!canReplay(init)) return response;
    for (const delay of RETRY_DELAYS_MS) {
      if (!(await isSchemaCacheReload(response))) return response;
      await sleep(delay);
      response = await baseFetch(input, init);
    }
    return response;
  };
}
