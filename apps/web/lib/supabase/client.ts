import { Database } from '@/types';
import { createBrowserClient } from '@supabase/ssr';

/**
 * One client per browser context. A second instance shares the same auth storage
 * key and competes for GoTrue's lock, which can stall getSession() indefinitely.
 */
let browserClient: ReturnType<typeof createBrowserClient<Database>> | undefined;

export function createClient() {
  browserClient ??= createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  );
  return browserClient;
}
