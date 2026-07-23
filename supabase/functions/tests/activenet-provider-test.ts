import { assertEquals } from 'jsr:@std/assert';

import { fetchProviderAvailability } from '../refresh-facility-availability/providers.ts';

// Response shape captured live from the Toronto instance on 2026-07-22:
//   GET /toronto/rest/reservation/resource/availability/daily/{id}
// status 7 = open day with an hourly grid; status 5 = closed (times empty).
function torontoFixture() {
  return {
    headers: { response_code: '0000', response_message: 'Successful' },
    body: {
      details: {
        resource_id: 7724,
        daily_details: [
          {
            date: '2026-07-24',
            status: 7,
            times: [
              { id: 954, start_time: '08:00:00', end_time: '09:00:00', available: true },
              { id: 955, start_time: '09:00:00', end_time: '10:00:00', available: false },
              { id: 956, start_time: '21:00:00', end_time: '22:00:00', available: true },
            ],
          },
          // Closed day: must contribute nothing.
          { date: '2026-07-25', status: 5, times: [] },
          // Outside the requested window: must be filtered even though open.
          {
            date: '2026-07-26',
            status: 7,
            times: [{ id: 954, start_time: '08:00:00', end_time: '09:00:00', available: true }],
          },
        ],
      },
    },
  };
}

const CONFIG = {
  providerType: 'active_net',
  apiBaseUrl: 'https://anc.ca.apm.activecommunities.com/toronto',
  apiConfig: { timezone: 'America/Toronto' },
  bookingUrlTemplate: null,
  externalProviderId: '7724',
};

function withStubbedFetch<T>(
  handler: (url: string) => unknown,
  run: () => Promise<T>
): Promise<T> {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = ((input: Request | URL | string) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    return Promise.resolve(
      new Response(JSON.stringify(handler(url)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
  }) as typeof fetch;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

Deno.test('active_net: parses open slots, drops unavailable/closed/out-of-window', async () => {
  const result = await withStubbedFetch(
    () => torontoFixture(),
    () =>
      fetchProviderAvailability(CONFIG, {
        externalProviderId: '7724',
        dates: ['2026-07-24', '2026-07-25'],
        timezone: 'America/Toronto',
      })
  );

  assertEquals(result.source, 'active_net');
  // 3 grid slots on the open day, 1 unavailable → 2 rows; closed + out-of-window days drop.
  assertEquals(result.rows.length, 2);

  const first = result.rows[0];
  // 08:00 America/Toronto in July (EDT, UTC-4) → 12:00Z.
  assertEquals(first.slot_start, '2026-07-24T12:00:00.000Z');
  assertEquals(first.slot_end, '2026-07-24T13:00:00.000Z');
  assertEquals(first.external_court_id, '7724');
  // Slot-template ids repeat across dates → namespaced by resource + date.
  assertEquals(first.external_slot_id, '7724-2026-07-24-954');
  assertEquals(first.is_available, true);
  assertEquals(first.price_cents, null);

  // Evening slot crosses no date boundary in local time.
  assertEquals(result.rows[1].slot_start, '2026-07-25T01:00:00.000Z');
});

Deno.test('active_net: multi-court parks fan out over comma-separated resource ids', async () => {
  const urls: string[] = [];
  const result = await withStubbedFetch(
    url => {
      urls.push(url);
      return torontoFixture();
    },
    () =>
      fetchProviderAvailability(
        { ...CONFIG, externalProviderId: '7724,7725' },
        {
          externalProviderId: '7724,7725',
          dates: ['2026-07-24'],
          timezone: 'America/Toronto',
        }
      )
  );

  assertEquals(urls.length, 2);
  assertEquals(urls[0].includes('/daily/7724?'), true);
  assertEquals(urls[1].includes('/daily/7725?'), true);
  // 2 open slots per resource.
  assertEquals(result.rows.length, 4);
  // Court identity preserved per resource; slot ids never collide.
  assertEquals(new Set(result.rows.map(r => r.external_court_id)).size, 2);
  assertEquals(new Set(result.rows.map(r => r.external_slot_id)).size, 4);
});

Deno.test('active_net: non-0000 response code throws (worker records refresh error)', async () => {
  let threw = false;
  await withStubbedFetch(
    () => ({ headers: { response_code: '0012', response_message: 'Invalid CSRF token' }, body: {} }),
    async () => {
      try {
        await fetchProviderAvailability(CONFIG, {
          externalProviderId: '7724',
          dates: ['2026-07-24'],
          timezone: 'America/Toronto',
        });
      } catch {
        threw = true;
      }
    }
  );
  assertEquals(threw, true);
});
