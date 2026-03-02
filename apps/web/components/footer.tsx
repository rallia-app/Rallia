import { getTranslations } from 'next-intl/server';
import { Separator } from '@/components/ui/separator';
import { Mail } from 'lucide-react';
import { Link } from '@/i18n/navigation';

export async function Footer() {
  const t = await getTranslations('footer');

  return (
    <footer className="w-full border-t bg-muted/30">
      <div className="w-full max-w-4xl mx-auto px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
          {/* Brand Section */}
          <div className="md:col-span-2">
            <h1 className="text-4xl font-bold mb-4">{t('title')}</h1>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4 max-w-md">
              {t('description')}
            </p>
            <div className="flex gap-4">
              <a
                href="mailto:apprallia@gmail.com"
                className="text-gray-600 dark:text-gray-400 hover:text-[var(--secondary-500)] transition-colors"
                aria-label="Email"
              >
                <Mail className="size-5" />
              </a>
            </div>
          </div>

          {/* Quick Links */}
          <div>
            <h4 className="font-semibold mb-4">{t('quickLinks')}</h4>
            <ul className="space-y-3 text-sm">
              <li>
                <Link
                  href="/beta"
                  className="text-gray-600 dark:text-gray-400 hover:text-foreground transition-colors"
                >
                  {t('joinBeta')}
                </Link>
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
          <p className="text-xs">{t('comingSoon')}</p>
        </div>
      </div>
    </footer>
  );
}

export default Footer;
