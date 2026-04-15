'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import DownloadDialog from '@/components/download-dialog';
import { Download } from 'lucide-react';

interface HeroDownloadCtaProps {
  label: string;
}

export function HeroDownloadCta({ label }: HeroDownloadCtaProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        size="lg"
        className="button-scale text-lg px-8 py-6 bg-[var(--secondary-500)] hover:bg-[var(--secondary-600)] text-white"
        onClick={() => setOpen(true)}
      >
        <Download className="size-5 mr-2" />
        {label}
      </Button>
      <DownloadDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
