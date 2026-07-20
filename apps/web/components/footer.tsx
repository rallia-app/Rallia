import { getTranslations } from 'next-intl/server';
import { Mail } from 'lucide-react';

import { Separator } from '@/components/ui/separator';
import { Link } from '@/i18n/navigation';
import { CookiePreferencesTrigger } from '@/components/consent/cookie-preferences-trigger';
import { SocialIcons } from '@/components/social-icons';

export async function Footer() {
  const t = await getTranslations('footer');

  return (
    <footer className="w-full border-t bg-muted/30">
      <div className="w-full max-w-4xl mx-auto px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
          {/* Brand Section */}
          <div className="md:col-span-2">
            <h1 className="text-4xl font-bold mb-4">{t('title')}</h1>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4 max-w-md">
              {t('description')}
            </p>
            <div className="flex items-center gap-4">
              <a
                href="mailto:contact@rallia.ca"
                className="text-gray-600 dark:text-gray-400 hover:text-[var(--secondary-500)] transition-colors"
                aria-label="Email"
              >
                <Mail className="size-5" />
              </a>
              <SocialIcons />
            </div>
          </div>

          {/* Quick Links */}
          <div>
            <h4 className="font-semibold mb-4">{t('quickLinks')}</h4>
            <ul className="space-y-3 text-sm">
              <li>
                <Link
                  href="/about"
                  className="text-gray-600 dark:text-gray-400 hover:text-foreground transition-colors"
                >
                  {t('about')}
                </Link>
              </li>
              <li>
                <Link
                  href="/guides"
                  className="text-gray-600 dark:text-gray-400 hover:text-foreground transition-colors"
                >
                  {t('guides')}
                </Link>
              </li>
              <li>
                <Link
                  href="/games"
                  className="text-gray-600 dark:text-gray-400 hover:text-foreground transition-colors"
                >
                  {t('games')}
                </Link>
              </li>
              <li>
                <Link
                  href="/courts"
                  className="text-gray-600 dark:text-gray-400 hover:text-foreground transition-colors"
                >
                  {t('courts')}
                </Link>
              </li>
              <li>
                <Link
                  href="/communities"
                  className="text-gray-600 dark:text-gray-400 hover:text-foreground transition-colors"
                >
                  {t('communities')}
                </Link>
              </li>
              <li>
                <Link
                  href="/donate"
                  className="text-gray-600 dark:text-gray-400 hover:text-foreground transition-colors"
                >
                  {t('donate')}
                </Link>
              </li>
              <li>
                <Link
                  href="/#download"
                  className="text-gray-600 dark:text-gray-400 hover:text-foreground transition-colors"
                >
                  {t('download')}
                </Link>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className="font-semibold mb-4">{t('legal')}</h4>
            <ul className="space-y-3 text-sm">
              <li>
                <Link
                  href="/privacy"
                  className="text-gray-600 dark:text-gray-400 hover:text-foreground transition-colors"
                >
                  {t('privacy')}
                </Link>
              </li>
              <li>
                <Link
                  href="/terms"
                  className="text-gray-600 dark:text-gray-400 hover:text-foreground transition-colors"
                >
                  {t('terms')}
                </Link>
              </li>
              <li>
                <Link
                  href="/eula"
                  className="text-gray-600 dark:text-gray-400 hover:text-foreground transition-colors"
                >
                  {t('eula')}
                </Link>
              </li>
              <li>
                <Link
                  href="/delete-account"
                  className="text-gray-600 dark:text-gray-400 hover:text-foreground transition-colors"
                >
                  {t('deleteAccount')}
                </Link>
              </li>
              <li>
                <CookiePreferencesTrigger />
              </li>
            </ul>
          </div>
        </div>

        <Separator className="mb-6" />

        {/* Bottom Section */}
        <div className="flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-gray-600 dark:text-gray-400">
          <p>
            &copy; {new Date().getFullYear()} {t('title')}. {t('rights')}
          </p>
        </div>
      </div>
    </footer>
  );
}

export default Footer;
