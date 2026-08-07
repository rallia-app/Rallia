/**
 * Regression cover for the 2026-08-05 Montréal outage: loisirs.montreal.ca
 * started 301-ing the slash-less search path, XHR followed the redirect as a
 * bodyless GET, and the POST-only endpoint answered 405. Every Montréal
 * facility stopped refreshing for two days behind that one status code.
 */

import { IC3OtiumProvider, normalizeIC3SearchPath } from './IC3OtiumProvider';
import type { ProviderConfig } from '../types';

jest.mock('../../logger', () => ({
  Logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

interface StubResponse {
  status: number;
  statusText?: string;
  responseText?: string;
  /** Final URL the XHR layer landed on, mimicking a followed redirect. */
  responseURL?: string;
}

interface RecordedRequest {
  method: string;
  url: string;
  body?: string;
}

const requests: RecordedRequest[] = [];
let responses: StubResponse[] = [];

/** Minimal XHR stand-in: replays `responses` in order and records each call. */
class StubXhr {
  status = 0;
  statusText = '';
  responseText = '';
  responseURL = '';
  timeout = 0;
  responseType = '';
  onload: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onerror: (() => void) | null = null;

  private method = '';
  private url = '';

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(): void {}

  send(body?: string): void {
    requests.push({ method: this.method, url: this.url, body });
    const next = responses.shift();
    if (!next) throw new Error(`StubXhr: no stubbed response for ${this.method} ${this.url}`);
    this.status = next.status;
    this.statusText = next.statusText ?? '';
    this.responseText = next.responseText ?? '';
    this.responseURL = next.responseURL ?? this.url;
    this.onload?.();
  }
}

const SLOT_PAYLOAD = JSON.stringify({
  results: [
    {
      startDateTime: '2026-08-08T22:00:00.000Z',
      endDateTime: '2026-08-08T23:00:00.000Z',
      facilityScheduleId: 987,
      totalPrice: 0,
      facility: { id: 42, name: 'Terrain 1', site: { name: 'Parc Martin-Luther-King' } },
    },
  ],
});

function makeProvider(searchPath?: string): IC3OtiumProvider {
  const config: ProviderConfig = {
    id: 'provider-uuid',
    providerType: 'ic3_otium',
    apiBaseUrl: 'https://loisirs.montreal.ca/IC3/api/U6510',
    apiConfig: searchPath === undefined ? {} : { searchPath },
    bookingUrlTemplate: null,
  };
  return new IC3OtiumProvider(config);
}

beforeEach(() => {
  requests.length = 0;
  responses = [];
  (global as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = StubXhr;
});

describe('normalizeIC3SearchPath', () => {
  it('adds the trailing slash IC3 hosts canonicalize to', () => {
    expect(normalizeIC3SearchPath('/public/search')).toBe('/public/search/');
  });

  it('leaves an already-canonical path alone', () => {
    expect(normalizeIC3SearchPath('/public/search/')).toBe('/public/search/');
  });

  it('falls back to the default path when unset or empty', () => {
    expect(normalizeIC3SearchPath(undefined)).toBe('/public/search/');
    expect(normalizeIC3SearchPath(null)).toBe('/public/search/');
    expect(normalizeIC3SearchPath('')).toBe('/public/search/');
  });
});

describe('IC3OtiumProvider request path', () => {
  it('requests the trailing-slash path even when the config omits it', async () => {
    responses = [{ status: 200, responseText: SLOT_PAYLOAD }];

    const slots = await makeProvider('/public/search').fetchAvailability({
      dates: ['2026-08-08'],
      facilityExternalId: '1755',
    });

    expect(slots).toHaveLength(1);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toContain('/public/search/?_=');
    expect(requests[0].method).toBe('POST');
  });

  it('re-POSTs to the redirect target instead of surrendering to the 405', async () => {
    // Exactly the Montréal shape: XHR silently followed the 301 as a GET, so
    // the first attempt comes back 405 with a different responseURL.
    responses = [
      {
        status: 405,
        statusText: 'Method Not Allowed',
        responseURL: 'https://loisirs.montreal.ca/IC3/api/U6510/public/search/?_=1',
      },
      { status: 200, responseText: SLOT_PAYLOAD },
    ];

    const slots = await makeProvider('/legacy/search').fetchAvailability({
      dates: ['2026-08-08'],
      facilityExternalId: '1755',
    });

    expect(slots).toHaveLength(1);
    expect(requests).toHaveLength(2);
    expect(requests[1].url).toBe('https://loisirs.montreal.ca/IC3/api/U6510/public/search/?_=1');
    // The retry has to carry the method and body, which is the whole point.
    expect(requests[1].method).toBe('POST');
    expect(JSON.parse(requests[1].body ?? '{}')).toMatchObject({ siteId: 1755 });
  });

  it('does not retry a plain failure that involved no redirect', async () => {
    responses = [{ status: 500, statusText: 'Server Error' }];

    const slots = await makeProvider().fetchAvailability({
      dates: ['2026-08-08'],
      facilityExternalId: '1755',
    });

    expect(slots).toEqual([]);
    expect(requests).toHaveLength(1);
  });
});
