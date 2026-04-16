'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { EmailPreviewTab } from './admin-communications-email-tab';
import { PushPreviewTab } from './admin-communications-push-tab';
import { SmsPreviewTab } from './admin-communications-sms-tab';
import { Button } from './ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';

const CATEGORY_OPTIONS = ['all', 'match', 'social', 'organization', 'system'] as const;

export function AdminCommunicationsView() {
  const t = useTranslations('admin.communications');
  const locale = useLocale();
  const [previewLocale, setPreviewLocale] = useState(locale);
  const [activeTab, setActiveTab] = useState('email');
  const [category, setCategory] = useState('all');

  return (
    <div className="space-y-4">
      {/* Controls bar */}
      <div className="flex items-center gap-4 flex-wrap">
        {/* Locale toggle */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{t('controls.locale')}:</span>
          <div className="flex items-center rounded-md border">
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'h-7 rounded-r-none text-xs px-3',
                previewLocale === 'en-US' &&
                  'bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground'
              )}
              onClick={() => setPreviewLocale('en-US')}
            >
              EN-US
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'h-7 rounded-l-none text-xs px-3 border-l',
                previewLocale === 'fr-CA' &&
                  'bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground'
              )}
              onClick={() => setPreviewLocale('fr-CA')}
            >
              FR-CA
            </Button>
          </div>
        </div>

        {/* Category filter */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{t('controls.category')}:</span>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="h-7 w-[180px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORY_OPTIONS.map(opt => (
                <SelectItem key={opt} value={opt} className="text-xs">
                  {opt === 'all' ? t('controls.allCategories') : t(`categories.${opt}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="email">{t('tabs.email')}</TabsTrigger>
          <TabsTrigger value="push">{t('tabs.push')}</TabsTrigger>
          <TabsTrigger value="sms">{t('tabs.sms')}</TabsTrigger>
        </TabsList>

        <TabsContent value="email">
          <EmailPreviewTab previewLocale={previewLocale} category={category} />
        </TabsContent>

        <TabsContent value="push">
          <PushPreviewTab previewLocale={previewLocale} category={category} />
        </TabsContent>

        <TabsContent value="sms">
          <SmsPreviewTab previewLocale={previewLocale} category={category} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
