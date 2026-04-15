'use client';

import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';

interface ClipboardDownloadButtonProps {
  inviteUrl: string;
  appStoreUrl: string;
  label: string;
  hint: string;
}

export function ClipboardDownloadButton({
  inviteUrl,
  appStoreUrl,
  label,
  hint,
}: ClipboardDownloadButtonProps) {
  const handleDownload = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
    } catch {
      // Clipboard write failed — fingerprint fallback will handle attribution
    }
    window.location.href = appStoreUrl;
  };

  return (
    <div className="flex flex-col items-center gap-3 w-full">
      <Button size="lg" className="w-full text-base gap-2" onClick={handleDownload}>
        <Download className="h-5 w-5" />
        {label}
      </Button>
      <p className="text-xs text-muted-foreground text-center">{hint}</p>
    </div>
  );
}
