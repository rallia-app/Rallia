'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';

import { Button } from '@/components/ui/button';
import DownloadDialog from '@/components/download-dialog';
import { downloadDialogOpened } from '@/lib/analytics';
import { cn } from '@/lib/utils';

interface HeroDownloadCtaProps {
  label: string;
  /** `secondary` sits under another primary CTA on the dark hero video. */
  variant?: 'primary' | 'secondary';
}

export function HeroDownloadCta({ label, variant = 'primary' }: HeroDownloadCtaProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        size="lg"
        variant={variant === 'secondary' ? 'outline' : 'default'}
        className={cn(
          'button-scale text-lg px-8 py-6',
          variant === 'secondary'
            ? 'border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white'
            : 'bg-[var(--secondary-500)] hover:bg-[var(--secondary-600)] text-white'
        )}
        onClick={() => {
          downloadDialogOpened({ placement: 'hero' });
          setOpen(true);
        }}
      >
        <Download className="size-5 mr-2" />
        {label}
      </Button>
      <DownloadDialog open={open} onOpenChange={setOpen} placement="hero" />
    </>
  );
}
