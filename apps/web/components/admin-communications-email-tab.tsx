'use client';

import { cn } from '@/lib/utils';
import { Mail, Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { EMAIL_CATEGORIES, EMAIL_TEMPLATES } from './admin-communications-data';
import { Button } from './ui/button';

interface EmailPreviewTabProps {
  previewLocale: string;
  category: string;
}

export function EmailPreviewTab({ previewLocale, category }: EmailPreviewTabProps) {
  const t = useTranslations('admin.communications');
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [colorMode, setColorMode] = useState<'light' | 'dark'>('light');

  const filteredTemplates =
    category === 'all'
      ? EMAIL_TEMPLATES
      : EMAIL_TEMPLATES.filter(tmpl => tmpl.category.toLowerCase() === category);

  const selectedEntry = EMAIL_TEMPLATES.find(tmpl => tmpl.id === selectedTemplate);

  const iframeSrc = selectedTemplate
    ? `/api/admin/email-preview?template=${selectedTemplate}&locale=${previewLocale}&mode=${colorMode}`
    : null;

  return (
    <div className="flex border rounded-lg overflow-hidden bg-card" style={{ height: '70vh' }}>
      {/* Left panel — template list */}
      <div className="w-[260px] border-r flex-shrink-0 overflow-y-auto">
        <div className="p-3 border-b">
          <p className="text-xs text-muted-foreground">
            {t('email.templateCount', { count: filteredTemplates.length })}
          </p>
        </div>
        <nav className="p-2 space-y-3">
          {EMAIL_CATEGORIES.filter(cat => category === 'all' || cat.toLowerCase() === category).map(
            cat => {
              const items = filteredTemplates.filter(tmpl => tmpl.category === cat);
              if (items.length === 0) return null;
              return (
                <div key={cat}>
                  <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-2 py-1">
                    {cat}
                  </div>
                  {items.map(tmpl => (
                    <button
                      key={tmpl.id}
                      onClick={() => setSelectedTemplate(tmpl.id)}
                      className={cn(
                        'w-full text-left text-sm px-2 py-1.5 rounded-md transition-colors',
                        selectedTemplate === tmpl.id
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                      )}
                    >
                      {tmpl.label}
                    </button>
                  ))}
                </div>
              );
            }
          )}
        </nav>
      </div>

      {/* Right panel — preview */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedEntry ? (
          <>
            {/* Top bar */}
            <div className="flex items-center gap-3 px-4 py-2 border-b bg-muted/30">
              <span className="font-medium text-sm">
                {selectedEntry.category}: {selectedEntry.label}
              </span>
              <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                {previewLocale}
              </span>
              <div className="ml-auto">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                  onClick={() => setColorMode(prev => (prev === 'light' ? 'dark' : 'light'))}
                >
                  {colorMode === 'dark' ? (
                    <Sun className="size-3.5" />
                  ) : (
                    <Moon className="size-3.5" />
                  )}
                  {colorMode === 'dark' ? t('controls.light') : t('controls.dark')}
                </Button>
              </div>
            </div>
            {/* Iframe */}
            <iframe
              key={`${selectedTemplate}-${previewLocale}-${colorMode}`}
              src={iframeSrc!}
              className="flex-1 border-0 w-full"
              style={{
                backgroundColor: colorMode === 'dark' ? '#1a1a1a' : '#ffffff',
              }}
              title="Email preview"
            />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-muted-foreground">
              <Mail className="size-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">{t('email.selectTemplate')}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
