/**
 * Match Organizer service tests.
 *
 * getSessionMatchSportId reads through three to-one embeds. PostgREST nests
 * those as objects while the generated types widen them to arrays, so the
 * narrowing is the fragile part and is what these tests pin down.
 */

jest.mock('../supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

import { getSessionMatchSportId } from './matchOrganizerService';
import { supabase } from '../supabase';

const mockFrom = supabase.from as jest.Mock;

beforeEach(() => {
  mockFrom.mockReset();
});

function chain(result: { data: unknown; error: unknown }) {
  const proxy: Record<string, jest.Mock> = {};
  const handler = {
    get(_target: unknown, prop: string) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => void) => resolve(result);
      }
      if (!proxy[prop]) {
        proxy[prop] = jest.fn(() => chainProxy);
      }
      return proxy[prop];
    },
  };
  const chainProxy = new Proxy({}, handler) as Record<string, jest.Mock>;
  return { chainProxy, proxy };
}

describe('getSessionMatchSportId', () => {
  it("unwraps the nested embeds and returns the league's sport", async () => {
    const { chainProxy, proxy } = chain({
      data: { sessions: { seasons: { leagues: { sport_id: 'sport-1' } } } },
      error: null,
    });
    mockFrom.mockReturnValue(chainProxy);

    await expect(getSessionMatchSportId('sm-1')).resolves.toBe('sport-1');
    expect(mockFrom).toHaveBeenCalledWith('session_matches');
    expect(proxy.eq).toHaveBeenCalledWith('id', 'sm-1');
  });

  it('returns null when the pairing cannot be read', async () => {
    const { chainProxy } = chain({ data: null, error: { message: 'boom' } });
    mockFrom.mockReturnValue(chainProxy);

    await expect(getSessionMatchSportId('sm-1')).resolves.toBeNull();
  });

  it('returns null on a partial chain rather than throwing', async () => {
    const { chainProxy } = chain({ data: { sessions: { seasons: null } }, error: null });
    mockFrom.mockReturnValue(chainProxy);

    await expect(getSessionMatchSportId('sm-1')).resolves.toBeNull();
  });
});
