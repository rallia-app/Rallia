'use client';

import { Check, Copy, Download } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { appStoreClicked } from '@/lib/analytics';
import type { ReferralContext } from '@/lib/attribution-token';
import { useAttributionHandoff } from '@/lib/use-attribution-handoff';

interface IOSCodeHandoffProps {
  code: string;
  appStoreUrl: string;
  downloadLabel: string;
  codeLabel: string;
  codeHint: string;
  copyLabel: string;
  copiedLabel: string;
  /**
   * Referral context for the iOS clipboard handoff — when present, the
   * signed token written on App Store click carries it so the mobile app
   * auto-attributes the invite on first launch (no manual code entry).
   */
  referral?: ReferralContext;
}

export function IOSCodeHandoff({
  code,
  appStoreUrl,
  downloadLabel,
  codeLabel,
  codeHint,
  copyLabel,
  copiedLabel,
  referral,
}: IOSCodeHandoffProps) {
  const [copied, setCopied] = useState(false);
  // Pre-mints a signed `rallia_attrib_v1:<token>` and returns a sync writer
  // we can call inside the App Store click handler (iOS Safari requires
  // the clipboard write to happen within an active user gesture).
  const writeClipboard = useAttributionHandoff(referral ? { referral } : {});

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Selection-based copy fallback handled by user
    }
  };

  return (
    <div className="flex flex-col items-center gap-4 w-full">
      <div className="flex flex-col items-center gap-2 w-full">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{codeLabel}</p>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-3 rounded-xl border border-border bg-muted px-5 py-3 font-mono text-2xl font-semibold tracking-[0.3em] button-scale"
          aria-label={copyLabel}
        >
          <span>{code}</span>
          {copied ? (
            <Check className="h-5 w-5 text-primary" />
          ) : (
            <Copy className="h-5 w-5 text-muted-foreground" />
          )}
        </button>
        <p className="text-xs text-muted-foreground text-center">
          {copied ? copiedLabel : codeHint}
        </p>
      </div>

      <a
        href={appStoreUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="w-full"
        onClick={() => {
          // Sync clipboard write inside the user gesture, then fire the
          // analytics event. Order matters: navigator.clipboard.writeText
          // must happen before any awaited work to satisfy Safari's
          // user-activation requirement.
          writeClipboard();
          appStoreClicked({
            store: 'app_store',
            placement: 'invite_page',
            invitation_code: code,
          });
        }}
      >
        <Button size="lg" className="w-full text-base gap-2">
          <Download className="h-5 w-5" />
          {downloadLabel}
        </Button>
      </a>
    </div>
  );
}
