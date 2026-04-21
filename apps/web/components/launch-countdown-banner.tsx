'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { Rocket, X } from 'lucide-react';

import { LAUNCH_MS, getCountdownParts, type CountdownParts } from '@/lib/launch';
import DownloadDialog from '@/components/download-dialog';

const DISMISS_KEY = 'rallia.launchBanner.dismissed';

function pad(n: number) {
  return n.toString().padStart(2, '0');
}

function DigitBlock({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-w-[44px] px-2 py-1.5 rounded-lg bg-white/15 backdrop-blur-sm border border-white/20">
      <span className="text-xl font-bold tabular-nums leading-none text-white">{value}</span>
      <span className="text-[9px] font-semibold uppercase tracking-wider text-white/75 mt-1">
        {label}
      </span>
    </div>
  );
}

export function LaunchCountdownBanner() {
  const t = useTranslations('launch');
  const [mounted, setMounted] = useState(false);
  const [parts, setParts] = useState<CountdownParts>(() =>
    getCountdownParts(Date.now(), LAUNCH_MS)
  );
  const [dismissed, setDismissed] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      if (window.localStorage.getItem(DISMISS_KEY) === '1') {
        setDismissed(true);
      }
    } catch {
      /* ignore */
    }

    const tick = () => setParts(getCountdownParts(Date.now(), LAUNCH_MS));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  if (!mounted || parts.isOver || dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignore */
    }
  };

  const openDownload = () => setDownloadOpen(true);

  return (
    <>
      <div
        role="status"
        aria-live="polite"
        className="fixed bottom-4 right-4 z-50 max-w-[calc(100vw-2rem)] animate-launch-slide-in"
      >
        <div className="animated-border rounded-2xl shadow-2xl">
          <div
            className="relative rounded-[calc(1rem-2px)] overflow-hidden"
            style={{
              background:
                'linear-gradient(135deg, var(--primary-600) 0%, var(--secondary-600) 55%, var(--accent-500) 100%)',
            }}
          >
            {/* Decorative glow */}
            <div className="absolute -top-10 -right-10 size-32 rounded-full bg-white/20 blur-3xl pointer-events-none" />
            <div className="absolute -bottom-10 -left-10 size-28 rounded-full bg-[var(--accent-300)]/30 blur-3xl pointer-events-none" />

            {/* Dismiss */}
            <button
              type="button"
              onClick={handleDismiss}
              aria-label={t('dismissLabel')}
              className="absolute right-2 top-2 z-10 rounded-full p-1 text-white/70 hover:text-white hover:bg-white/15 transition-colors"
            >
              <X className="size-4" />
            </button>

            <div className="relative p-4 pr-10 flex flex-col gap-3 min-w-[280px]">
              {/* Header */}
              <div className="flex items-center gap-2.5">
                <div className="flex size-9 items-center justify-center rounded-full bg-white/20 border border-white/30 animate-bounce-subtle-y">
                  <Rocket className="size-4 text-white" />
                </div>
                <div className="flex flex-col leading-tight">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-white/80">
                    {t('bannerPrefix')}
                  </span>
                  <span className="text-sm font-bold text-white">{t('mobileTitle')}</span>
                </div>
              </div>

              {/* Digits */}
              <div className="flex items-center gap-1.5">
                <DigitBlock value={parts.days.toString()} label={t('daysLabel')} />
                <DigitBlock value={pad(parts.hours)} label={t('hoursLabel')} />
                <DigitBlock value={pad(parts.minutes)} label={t('minutesLabel')} />
                <DigitBlock value={pad(parts.seconds)} label={t('secondsLabel')} />
              </div>

              {/* Early-access pitch */}
              <p className="text-center text-[11px] font-medium text-white/90 leading-snug px-1">
                {t('earlyAccessPitch')}
              </p>

              {/* CTA — store badges trigger download dialog */}
              <div className="flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={openDownload}
                  aria-label="Download on the App Store"
                  className="button-scale"
                >
                  <Image
                    src="/app-store-badge.svg"
                    alt="Download on the App Store"
                    width={108}
                    height={36}
                    className="h-9 w-auto"
                  />
                </button>
                <button
                  type="button"
                  onClick={openDownload}
                  aria-label="Get it on Google Play"
                  className="button-scale"
                >
                  <Image
                    src="/google-play-badge.svg"
                    alt="Get it on Google Play"
                    width={108}
                    height={36}
                    className="h-9 w-auto"
                  />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <DownloadDialog open={downloadOpen} onOpenChange={setDownloadOpen} />
    </>
  );
}
