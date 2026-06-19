'use client';

import { Loader2, Send } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export function MessageComposer({
  placeholder,
  sendLabel,
  disabled,
  onSend,
}: {
  placeholder: string;
  sendLabel: string;
  disabled: boolean;
  onSend: (content: string) => void;
}) {
  const [value, setValue] = useState('');
  const trimmed = value.trim();
  const canSend = trimmed.length > 0 && !disabled;

  const submit = () => {
    if (!canSend) return;
    onSend(trimmed);
    setValue('');
  };

  return (
    <div className="flex items-end gap-2 border-t bg-background/80 p-3">
      <Textarea
        value={value}
        onChange={event => setValue(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
        placeholder={placeholder}
        rows={1}
        className="max-h-32 min-h-10 flex-1 resize-none"
        aria-label={placeholder}
      />
      <Button
        type="button"
        size="icon"
        onClick={submit}
        disabled={!canSend}
        aria-label={sendLabel}
        className="size-10 shrink-0"
      >
        {disabled ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
      </Button>
    </div>
  );
}
