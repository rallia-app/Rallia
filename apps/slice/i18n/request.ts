import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';

import enUS from '../messages/en-US.json';
import frCA from '../messages/fr-CA.json';

/**
 * next-intl requires a server config even when there is no i18n routing, and
 * rendering NextIntlClientProvider from a Server Component triggers the lookup.
 * Each page still passes its locale and messages explicitly, so this only
 * supplies the server-side fallback.
 */
export default getRequestConfig(async () => {
  const locale = (await cookies()).get('slice_lang')?.value === 'fr-CA' ? 'fr-CA' : 'en-US';

  return {
    locale,
    messages: locale === 'fr-CA' ? (frCA as typeof enUS) : enUS,
    timeZone: 'America/Toronto',
  };
});
