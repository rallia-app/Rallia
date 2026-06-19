'use client';

import { Loader2, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';

export function ChatRulesGate({
  title,
  body,
  acceptLabel,
  isAccepting,
  onAccept,
}: {
  title: string;
  body: string;
  acceptLabel: string;
  isAccepting: boolean;
  onAccept: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-4 border-t bg-muted/30 px-6 py-6 text-center">
      <div className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
        <ShieldCheck className="size-6" />
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="mx-auto max-w-sm text-xs leading-relaxed text-muted-foreground">{body}</p>
      </div>
      <Button
        type="button"
        size="sm"
        onClick={onAccept}
        disabled={isAccepting}
        className="font-semibold"
      >
        {isAccepting && <Loader2 className="size-4 animate-spin" />}
        {acceptLabel}
      </Button>
    </div>
  );
}
