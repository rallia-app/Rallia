import { withSchemaCacheRetry } from './supabaseFetch';

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

describe('withSchemaCacheRetry', () => {
  it('replays a request that PostgREST refused while reloading its schema cache', async () => {
    const base = jest.fn().mockResolvedValueOnce(reloading()).mockResolvedValueOnce(ok());
    const fetch = withSchemaCacheRetry(base, noSleep);

    const res = await fetch('https://x/rest/v1/rpc/foo', { method: 'POST', body: '{}' });

    expect(res.status).toBe(200);
    expect(base).toHaveBeenCalledTimes(2);
  });

  it('gives up after the retry budget and returns the last 503', async () => {
    const base = jest.fn().mockImplementation(() => Promise.resolve(reloading()));
    const fetch = withSchemaCacheRetry(base, noSleep);

    const res = await fetch('https://x/rest/v1/player', { method: 'GET' });

    expect(res.status).toBe(503);
    expect(base).toHaveBeenCalledTimes(3);
    await expect(res.json()).resolves.toMatchObject({ code: 'PGRST002' });
  });

  it('passes every other response through without a retry', async () => {
    const other = new Response(JSON.stringify({ code: '42501' }), { status: 403 });
    const base = jest.fn().mockResolvedValue(other);
    const fetch = withSchemaCacheRetry(base, noSleep);

    const res = await fetch('https://x/rest/v1/player');

    expect(res).toBe(other);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('leaves a 503 without the PGRST002 code alone', async () => {
    const base = jest.fn().mockResolvedValue(new Response('gateway down', { status: 503 }));
    const fetch = withSchemaCacheRetry(base, noSleep);

    const res = await fetch('https://x/rest/v1/player');

    expect(res.status).toBe(503);
    expect(base).toHaveBeenCalledTimes(1);
  });
});
