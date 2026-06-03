import { SentryTransport } from './SentryTransport';
import { LogEntry, LogLevel } from './Logger';

function makeEntry(error: unknown, message = 'Failed to update player'): LogEntry {
  return {
    level: LogLevel.ERROR,
    message,
    timestamp: new Date(),
    error: error as Error,
    context: { playerId: '123' },
  };
}

describe('SentryTransport error normalization', () => {
  let sentry: {
    captureException: jest.Mock;
    captureMessage: jest.Mock;
    addBreadcrumb: jest.Mock;
  };

  beforeEach(() => {
    sentry = {
      captureException: jest.fn(),
      captureMessage: jest.fn(),
      addBreadcrumb: jest.fn(),
    };
    SentryTransport.configure(sentry);
  });

  it('captures a real Error as-is, without an override fingerprint', () => {
    const err = new Error('boom');
    new SentryTransport().log(makeEntry(err));

    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    const [captured, ctx] = sentry.captureException.mock.calls[0];
    expect(captured).toBe(err);
    expect(ctx.fingerprint).toBeUndefined();
  });

  it('wraps a Supabase/PostgREST object into a real Error with a stable fingerprint', () => {
    const supabaseError = {
      code: '42703',
      details: null,
      hint: null,
      message: 'column player_availability.period does not exist',
    };
    new SentryTransport().log(makeEntry(supabaseError));

    const [captured, ctx] = sentry.captureException.mock.calls[0];
    expect(captured).toBeInstanceOf(Error);
    expect(captured.name).toBe('SupabaseError');
    expect(captured.message).toContain('Failed to update player');
    expect(captured.message).toContain('column player_availability.period does not exist');
    // Distinct call sites / codes group separately; the raw object is preserved.
    expect(ctx.fingerprint).toEqual(['logged-object-error', 'Failed to update player', '42703']);
    expect(ctx.extra.originalError).toBe(supabaseError);
    expect(ctx.extra.playerId).toBe('123');
  });

  it('groups different call-site messages into different fingerprints', () => {
    new SentryTransport().log(makeEntry({ code: '42703', message: 'x' }, 'Failed to load profile'));
    new SentryTransport().log(
      makeEntry({ code: '42703', message: 'x' }, 'Failed to update player')
    );

    const fp1 = sentry.captureException.mock.calls[0][1].fingerprint;
    const fp2 = sentry.captureException.mock.calls[1][1].fingerprint;
    expect(fp1).not.toEqual(fp2);
  });

  it('wraps a primitive throw into a real Error', () => {
    new SentryTransport().log(makeEntry('plain string failure'));

    const [captured, ctx] = sentry.captureException.mock.calls[0];
    expect(captured).toBeInstanceOf(Error);
    expect(captured.message).toContain('plain string failure');
    expect(ctx.fingerprint).toEqual(['logged-primitive-error', 'Failed to update player']);
  });
});
