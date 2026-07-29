'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check, Loader2, Trash2 } from 'lucide-react';

import { SmokeBrandLockup } from '@/lib/brand';
import { validateEmail } from '@/lib/validators';

/**
 * Standalone erase-my-info page. The funnel asks for an email and a phone
 * number, so people need a durable way to take that back once the tab is
 * closed — this is that way, and it acts on the spot instead of routing to an
 * inbox.
 */
export default function EraseDataClient() {
  const t = useTranslations('eraseData');
  const locale = useLocale();
  const isFrench = locale.toLowerCase().startsWith('fr');

  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const switchLanguage = () => {
    const target = isFrench ? 'en-US' : 'fr-CA';
    document.cookie = `slice_lang=${target}; path=/; max-age=31536000; samesite=lax`;
    window.location.assign(target === 'fr-CA' ? '/fr/erase' : '/erase');
  };

  const handleSubmit = async () => {
    const normalized = email.trim().toLowerCase();
    if (!validateEmail(normalized)) {
      setError(t('errors.email'));
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/lead/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalized }),
      });
      if (!response.ok) throw new Error('delete failed');
      setIsDone(true);
    } catch {
      setError(t('errors.generic'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-[100svh] w-full flex-col overflow-hidden">
      <div className="fixed left-4 top-4 z-30 sm:left-6">
        <SmokeBrandLockup />
      </div>

      <div className="fixed right-4 top-4 z-30">
        <button type="button" onClick={switchLanguage} className="smk-lang">
          {isFrench ? 'EN' : 'FR'}
        </button>
      </div>

      <div className="relative z-10 flex flex-1 flex-col justify-center px-5 py-24 sm:px-8">
        <div className="mx-auto flex w-full max-w-lg flex-col gap-8">
          {isDone ? (
            <div className="flex flex-col items-center gap-6 text-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-[color:var(--smk-ink)] bg-[var(--smk-lime)] shadow-[4px_4px_0_var(--smk-ink)]">
                <Check className="h-9 w-9 text-[color:var(--smk-ink)]" />
              </div>
              <div className="flex flex-col gap-3">
                <h1 className="smk-display text-3xl sm:text-4xl">{t('done.title')}</h1>
                <p className="smk-text-muted">{t('done.message')}</p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-3">
                <h1 className="smk-display text-3xl sm:text-4xl">{t('title')}</h1>
                <p className="smk-text-muted">{t('subtitle')}</p>
              </div>

              <input
                value={email}
                onChange={e => {
                  setEmail(e.target.value);
                  setError(null);
                }}
                placeholder={t('emailPlaceholder')}
                type="email"
                inputMode="email"
                autoComplete="email"
                className="smk-input"
              />

              {error && <p className="smk-text-error text-sm font-medium">{error}</p>}

              <button
                type="button"
                onClick={handleSubmit}
                disabled={isSubmitting || !validateEmail(email.trim().toLowerCase())}
                className="smk-btn w-full"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    {t('submitting')}
                  </>
                ) : (
                  <>
                    <Trash2 className="h-5 w-5" />
                    {t('cta')}
                  </>
                )}
              </button>

              <p className="smk-text-muted text-center text-xs">{t('note')}</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
