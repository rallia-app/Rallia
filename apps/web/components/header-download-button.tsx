'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import DownloadDialog from '@/components/download-dialog';
import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';

export default function HeaderDownloadButton() {
  const t = useTranslations('home.header');
  const [downloadOpen, setDownloadOpen] = useState(false);

  return (
    <>
      <Button
        size="sm"
        className="bg-[var(--secondary-500)] hover:bg-[var(--secondary-600)] text-white"
        onClick={() => setDownloadOpen(true)}
      >
        <Download className="size-4 mr-1.5" />
        {t('ctaButton')}
      </Button>
      <DownloadDialog open={downloadOpen} onOpenChange={setDownloadOpen} />
    </>
  );
}
