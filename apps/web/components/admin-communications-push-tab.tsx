'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import {
  DEFAULT_PREFERENCES,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_TYPES_WITH_MESSAGES,
  MOCK_DATA,
  formatPushTitle,
  getNotificationMessage,
  interpolate,
  type NotificationType,
} from './admin-communications-data';
import { Badge } from './ui/badge';
import { Card, CardContent, CardHeader } from './ui/card';
import type { Locale } from '@rallia/shared-translations';

interface PushPreviewTabProps {
  previewLocale: string;
  category: string;
}

export function PushPreviewTab({ previewLocale, category }: PushPreviewTabProps) {
  const t = useTranslations('admin.communications');
  const tTypes = useTranslations('notifications.types');

  const items = useMemo(() => {
    return NOTIFICATION_TYPES_WITH_MESSAGES.filter(type => {
      if (category === 'all') return true;
      return NOTIFICATION_CATEGORIES[type] === category;
    })
      .map(type => {
        const msg = getNotificationMessage(type, previewLocale as Locale);
        if (!msg) return null;
        const title = interpolate(msg.title, MOCK_DATA);
        const body = interpolate(msg.body, MOCK_DATA);
        const pushTitle = formatPushTitle(type, title, MOCK_DATA.sportName);
        const prefs = DEFAULT_PREFERENCES[type];
        const cat = NOTIFICATION_CATEGORIES[type];

        return { type, title: pushTitle, body, prefs, category: cat };
      })
      .filter(Boolean) as {
      type: NotificationType;
      title: string;
      body: string;
      prefs: Record<string, boolean>;
      category: string;
    }[];
  }, [previewLocale, category]);

  if (items.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-16">
        <p className="text-sm">No notification types match the selected category.</p>
      </div>
    );
  }

  return (
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
              <Badge variant="outline" className="shrink-0 text-[10px] capitalize">
                {item.category}
              </Badge>
            </CardHeader>
            <CardContent className="px-4 pb-3 space-y-2">
              {/* Push notification mockup */}
              <div className="rounded-lg border bg-muted/40 p-3 space-y-1">
                <p className="text-sm font-semibold leading-snug">{item.title}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{item.body}</p>
              </div>
              {/* Default channels */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] text-muted-foreground mr-1">
                  {t('push.defaultChannels')}:
                </span>
                {(['email', 'push', 'sms'] as const).map(ch => (
                  <Badge
                    key={ch}
                    variant={item.prefs[ch] ? 'default' : 'outline'}
                    className={
                      item.prefs[ch]
                        ? 'text-[10px] px-1.5 py-0'
                        : 'text-[10px] px-1.5 py-0 opacity-40'
                    }
                  >
                    {ch.toUpperCase()}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
