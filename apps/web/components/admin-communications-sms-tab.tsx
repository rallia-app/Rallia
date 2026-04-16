'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import {
  DEFAULT_PREFERENCES,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_TYPES_WITH_MESSAGES,
  MOCK_DATA,
  formatSmsPreview,
  getNotificationMessage,
  interpolate,
  type NotificationType,
} from './admin-communications-data';
import { Badge } from './ui/badge';
import { Card, CardContent, CardHeader } from './ui/card';
import { Switch } from './ui/switch';
import { Label } from './ui/label';
import type { Locale } from '@rallia/shared-translations';

interface SmsPreviewTabProps {
  previewLocale: string;
  category: string;
}

export function SmsPreviewTab({ previewLocale, category }: SmsPreviewTabProps) {
  const t = useTranslations('admin.communications');
  const tTypes = useTranslations('notifications.types');
  const [smsEnabledOnly, setSmsEnabledOnly] = useState(false);

  const items = useMemo(() => {
    return NOTIFICATION_TYPES_WITH_MESSAGES.filter(type => {
      if (category !== 'all' && NOTIFICATION_CATEGORIES[type] !== category) return false;
      if (smsEnabledOnly && !DEFAULT_PREFERENCES[type].sms) return false;
      return true;
    })
      .map(type => {
        const msg = getNotificationMessage(type, previewLocale as Locale);
        if (!msg) return null;

        const title = interpolate(msg.title, MOCK_DATA);
        const body = interpolate(msg.body, MOCK_DATA);
        const sms = formatSmsPreview(type, title, body);
        const smsEnabled = DEFAULT_PREFERENCES[type].sms;
        const cat = NOTIFICATION_CATEGORIES[type];

        return { type, title, sms, smsEnabled, category: cat };
      })
      .filter(Boolean) as {
      type: NotificationType;
      title: string;
      sms: { text: string; length: number; segments: number };
      smsEnabled: boolean;
      category: string;
    }[];
  }, [previewLocale, category, smsEnabledOnly]);

  return (
    <div className="space-y-4">
      {/* Filter toggle */}
      <div className="flex items-center gap-2">
        <Switch id="sms-filter" checked={smsEnabledOnly} onCheckedChange={setSmsEnabledOnly} />
        <Label htmlFor="sms-filter" className="text-sm cursor-pointer">
          {t('sms.showEnabledOnly')}
        </Label>
      </div>

      {items.length === 0 ? (
        <div className="text-center text-muted-foreground py-16">
          <p className="text-sm">No notification types match the selected filters.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map(item => {
            let typeLabel: string;
            try {
              typeLabel = tTypes(item.type);
            } catch {
              typeLabel = item.type;
            }

            return (
              <Card key={item.type} className="overflow-hidden">
                <CardHeader className="pb-2 pt-3 px-4 flex flex-row items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-muted-foreground truncate whitespace-pre-line leading-tight">
                      {typeLabel.replace(/\n/g, ' ')}
                    </p>
                  </div>
                  <Badge
                    variant={item.smsEnabled ? 'default' : 'outline'}
                    className={cn('shrink-0 text-[10px]', !item.smsEnabled && 'opacity-50')}
                  >
                    {item.smsEnabled ? t('sms.smsEnabled') : t('sms.smsDisabled')}
                  </Badge>
                </CardHeader>
                <CardContent className="px-4 pb-3 space-y-2">
                  {/* SMS text mockup */}
                  <div className="rounded-lg border bg-muted/40 p-3">
                    <p className="text-xs font-mono leading-relaxed break-all">{item.sms.text}</p>
                  </div>
                  {/* Character count */}
                  <div className="flex items-center justify-between text-[11px]">
                    <span
                      className={cn(
                        'font-medium',
                        item.sms.length < 120
                          ? 'text-green-600 dark:text-green-400'
                          : item.sms.length < 160
                            ? 'text-yellow-600 dark:text-yellow-400'
                            : 'text-red-600 dark:text-red-400'
                      )}
                    >
                      {t('sms.characterCount', { count: item.sms.length })}
                    </span>
                    {item.sms.segments > 1 && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {t('sms.segments', { count: item.sms.segments })}
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
