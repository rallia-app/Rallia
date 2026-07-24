'use client';

import { Bold, Italic, Link2, List } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { RefObject } from 'react';

import { Button } from './ui/button';

interface MarkdownToolbarProps {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (next: string) => void;
}

/**
 * Formatting toolbar for textareas whose content is rendered with the
 * broadcast email markdown subset (send-broadcast/template.ts): **bold**,
 * *italic*, [link](https://…), and "- " bullet lists.
 */
export function MarkdownToolbar({ textareaRef, value, onChange }: MarkdownToolbarProps) {
  const t = useTranslations('admin.emails.compose');

  const replaceSelection = (
    build: (selected: string) => { text: string; selectStart: number; selectEnd: number }
  ) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const { text, selectStart, selectEnd } = build(value.slice(start, end));
    onChange(value.slice(0, start) + text + value.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + selectStart, start + selectEnd);
    });
  };

  const wrap = (marker: string, placeholder: string) =>
    replaceSelection(selected => {
      const inner = selected || placeholder;
      return {
        text: `${marker}${inner}${marker}`,
        selectStart: marker.length,
        selectEnd: marker.length + inner.length,
      };
    });

  const link = () =>
    replaceSelection(selected => {
      const label = selected || t('formatLink');
      const url = 'https://';
      // Select the URL part so the admin can type over it right away.
      return {
        text: `[${label}](${url})`,
        selectStart: label.length + 3,
        selectEnd: label.length + 3 + url.length,
      };
    });

  const bulletList = () =>
    replaceSelection(selected => {
      const lines = (selected || t('formatList')).split('\n');
      const text = lines.map(line => (line.trim() ? `- ${line.trim()}` : line)).join('\n');
      return { text, selectStart: 0, selectEnd: text.length };
    });

  const actions = [
    { icon: Bold, label: t('formatBold'), run: () => wrap('**', t('formatBold')) },
    { icon: Italic, label: t('formatItalic'), run: () => wrap('*', t('formatItalic')) },
    { icon: Link2, label: t('formatLink'), run: link },
    { icon: List, label: t('formatList'), run: bulletList },
  ];

  return (
    <div className="flex items-center gap-1">
      {actions.map(({ icon: Icon, label, run }) => (
        <Button
          key={label}
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          title={label}
          aria-label={label}
          onMouseDown={e => e.preventDefault()}
          onClick={run}
        >
          <Icon className="size-3.5" />
        </Button>
      ))}
    </div>
  );
}
