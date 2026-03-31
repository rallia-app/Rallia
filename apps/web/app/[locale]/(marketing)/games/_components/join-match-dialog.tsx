'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

interface JoinMatchDialogProps {
  matchId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function JoinMatchDialog({ matchId, open, onOpenChange }: JoinMatchDialogProps) {
  const t = useTranslations('gamesPage.joinDialog');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!matchId) return;

    setIsSubmitting(true);
    setStatus('idle');

    try {
      const locationRes = await fetch('/api/get-location');
      const locationData = locationRes.ok ? await locationRes.json() : null;

      const res = await fetch('/api/submit-match-interest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matchId,
          email,
          name: name || undefined,
          ipAddress: locationData?.ipAddress || 'unknown',
          location: locationData?.location || 'unknown',
        }),
      });

      if (!res.ok) throw new Error('Submission failed');

      setStatus('success');
      setEmail('');
      setName('');
      setTimeout(() => onOpenChange(false), 3000);
    } catch {
      setStatus('error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenChange = (value: boolean) => {
    if (!value) {
      setStatus('idle');
      setEmail('');
      setName('');
    }
    if (value) {
      setStatus('idle');
    }
    onOpenChange(value);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        {status === 'success' ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <DialogTitle className="sr-only">{t('successTitle')}</DialogTitle>
            <div className="size-16 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center">
              <svg
                className="size-8 text-green-600 dark:text-green-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <p className="text-lg font-semibold m-0">{t('successTitle')}</p>
            <p className="text-sm text-muted-foreground">{t('successMessage')}</p>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t('title')}</DialogTitle>
              <DialogDescription>{t('description')}</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <label htmlFor="join-email" className="text-sm font-medium">
                  {t('emailLabel')}
                </label>
                <Input
                  id="join-email"
                  type="email"
                  placeholder={t('emailPlaceholder')}
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="join-name" className="text-sm font-medium">
                  {t('nameLabel')}
                </label>
                <Input
                  id="join-name"
                  type="text"
                  placeholder={t('namePlaceholder')}
                  value={name}
                  onChange={e => setName(e.target.value)}
                />
              </div>
              {status === 'error' && (
                <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
                  Something went wrong. Please try again.
                </div>
              )}
              <DialogFooter>
                <Button type="submit" disabled={isSubmitting} className="w-full">
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    t('submitButton')
                  )}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
