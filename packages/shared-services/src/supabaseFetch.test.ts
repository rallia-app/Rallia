import { withSupabaseRetries } from './supabaseFetch';

const reloading = () =>
  new Response(
    JSON.stringify({
      code: 'PGRST002',
      message: 'Could not query the database for the schema cache. Retrying.',
    }),
    { status: 503, headers: { 'content-type': 'application/json' } }
  );
const ok = () => new Response('[]', { status: 200 });
const noSleep = () => Promise.resolve();

describe('withSupabaseRetries: schema cache reload', () => {
  it('replays a request that PostgREST refused while reloading its schema cache', async () => {
    const base = jest.fn().mockResolvedValueOnce(reloading()).mockResolvedValueOnce(ok());
    const fetch = withSupabaseRetries(base, { sleep: noSleep });

    const res = await fetch('https://x/rest/v1/rpc/foo', { method: 'POST', body: '{}' });

    expect(res.status).toBe(200);
    expect(base).toHaveBeenCalledTimes(2);
  });

  it('gives up after the retry budget and returns the last 503', async () => {
    const base = jest.fn().mockImplementation(() => Promise.resolve(reloading()));
    const fetch = withSupabaseRetries(base, { sleep: noSleep });

    const res = await fetch('https://x/rest/v1/player', { method: 'GET' });

    expect(res.status).toBe(503);
    expect(base).toHaveBeenCalledTimes(3);
    await expect(res.json()).resolves.toMatchObject({ code: 'PGRST002' });
  });

  it('passes every other response through without a retry', async () => {
    const other = new Response(JSON.stringify({ code: '42501' }), { status: 403 });
    const base = jest.fn().mockResolvedValue(other);
    const fetch = withSupabaseRetries(base, { sleep: noSleep });

    const res = await fetch('https://x/rest/v1/player');

    expect(res).toBe(other);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('leaves a 503 without the PGRST002 code alone', async () => {
    const base = jest.fn().mockResolvedValue(new Response('gateway down', { status: 503 }));
    const fetch = withSupabaseRetries(base, { sleep: noSleep });

    const res = await fetch('https://x/rest/v1/player');

    expect(res.status).toBe(503);
    expect(base).toHaveBeenCalledTimes(1);
  });
});

const expired = () =>
  new Response(JSON.stringify({ code: 'PGRST303', message: 'JWT expired' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  });
const withToken = (token: string): RequestInit => ({
  method: 'GET',
  headers: new Headers({ apikey: 'anon', Authorization: `Bearer ${token}` }),
});
const bearerSentOn = (base: jest.Mock, call: number) =>
  new Headers(base.mock.calls[call][1].headers).get('Authorization');

describe('withSupabaseRetries: expired JWT', () => {
  it('refreshes the session and replays the request with the new bearer', async () => {
    const base = jest.fn().mockResolvedValueOnce(expired()).mockResolvedValueOnce(ok());
    const refreshAccessToken = jest.fn().mockResolvedValue('fresh');
    const fetch = withSupabaseRetries(base, { sleep: noSleep, refreshAccessToken });

    const res = await fetch('https://x/rest/v1/player', withToken('stale'));

    expect(res.status).toBe(200);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(base).toHaveBeenCalledTimes(2);
    expect(bearerSentOn(base, 0)).toBe('Bearer stale');
    expect(bearerSentOn(base, 1)).toBe('Bearer fresh');
  });

  it('returns the 401 untouched when the session cannot be refreshed', async () => {
    const base = jest.fn().mockResolvedValue(expired());
    const refreshAccessToken = jest.fn().mockResolvedValue(null);
    const fetch = withSupabaseRetries(base, { sleep: noSleep, refreshAccessToken });

    const res = await fetch('https://x/rest/v1/player', withToken('stale'));

    expect(res.status).toBe(401);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('replays only once even if the refreshed token is also rejected', async () => {
    const base = jest.fn().mockResolvedValue(expired());
    const refreshAccessToken = jest.fn().mockResolvedValue('fresh');
    const fetch = withSupabaseRetries(base, { sleep: noSleep, refreshAccessToken });

    const res = await fetch('https://x/rest/v1/player', withToken('stale'));

    expect(res.status).toBe(401);
    expect(base).toHaveBeenCalledTimes(2);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it('does not replay when the refresh hands back the same token', async () => {
    const base = jest.fn().mockResolvedValue(expired());
    const refreshAccessToken = jest.fn().mockResolvedValue('stale');
    const fetch = withSupabaseRetries(base, { sleep: noSleep, refreshAccessToken });

    await fetch('https://x/rest/v1/player', withToken('stale'));

    expect(base).toHaveBeenCalledTimes(1);
  });

  it('shares one refresh across concurrent expired requests', async () => {
    const base = jest
      .fn()
      .mockImplementation((_input, init: RequestInit) =>
        Promise.resolve(
          new Headers(init.headers).get('Authorization') === 'Bearer fresh' ? ok() : expired()
        )
      );
    let release!: (token: string) => void;
    const refreshAccessToken = jest.fn(() => new Promise<string>(resolve => (release = resolve)));
    const fetch = withSupabaseRetries(base, { sleep: noSleep, refreshAccessToken });

    const pending = Promise.all([
      fetch('https://x/rest/v1/player', withToken('stale')),
      fetch('https://x/rest/v1/sport', withToken('stale')),
    ]);
    await new Promise(resolve => setTimeout(resolve, 0));
    release('fresh');
    const [a, b] = await pending;

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(base).toHaveBeenCalledTimes(4);
  });

  it('leaves a request without a bearer alone', async () => {
    const base = jest.fn().mockResolvedValue(expired());
    const refreshAccessToken = jest.fn().mockResolvedValue('fresh');
    const fetch = withSupabaseRetries(base, { sleep: noSleep, refreshAccessToken });

    await fetch('https://x/rest/v1/player', { method: 'GET' });

    expect(refreshAccessToken).not.toHaveBeenCalled();
    expect(base).toHaveBeenCalledTimes(1);
  });
});
