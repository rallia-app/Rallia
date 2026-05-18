'use client';

import { ExternalLink, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

export type WindowOption = '24h' | '7d' | '30d' | '90d';

const WINDOW_OPTIONS: WindowOption[] = ['24h', '7d', '30d', '90d'];

export interface UtmFilterBarProps {
  window: WindowOption;
  onWindowChange: (next: WindowOption) => void;
  autoRefresh: boolean;
  onAutoRefreshChange: (next: boolean) => void;
  /** Epoch ms of the most recent successful fetch — null until first fetch lands. */
  lastFetchedAt: number | null;
  onRefresh?: () => void;
  posthogUrl?: string;
  /** Dev-only toggle for synthetic landings. Hidden when undefined. */
  demo?: boolean;
  onDemoChange?: (next: boolean) => void;
}

export function UtmFilterBar({
  window,
  onWindowChange,
  autoRefresh,
  onAutoRefreshChange,
  lastFetchedAt,
  onRefresh,
  posthogUrl,
  demo,
  onDemoChange,
}: UtmFilterBarProps) {
  const t = useTranslations('admin.analytics');
  const showDemoToggle = onDemoChange != null;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/30 px-3 py-2">
      <div className="flex items-center gap-2">
        <Label className="text-xs text-muted-foreground">{t('utm.timeWindow')}</Label>
        <Select value={window} onValueChange={value => onWindowChange(value as WindowOption)}>
          <SelectTrigger className="h-8 w-[100px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WINDOW_OPTIONS.map(option => (
              <SelectItem key={option} value={option}>
                {t(`utm.windows.${option}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        <Switch id="utm-auto-refresh" checked={autoRefresh} onCheckedChange={onAutoRefreshChange} />
        <Label htmlFor="utm-auto-refresh" className="text-xs text-muted-foreground">
          {t('utm.autoRefresh')}
        </Label>
      </div>

      {showDemoToggle && (
        <div className="flex items-center gap-2">
          <Switch id="utm-demo" checked={demo ?? false} onCheckedChange={onDemoChange} />
          <Label htmlFor="utm-demo" className="text-xs text-muted-foreground">
            {t('utm.demoMode')}
          </Label>
        </div>
      )}

      {onRefresh && (
        <Button variant="outline" size="sm" className="h-8" onClick={onRefresh}>
          <RefreshCw className="size-3.5 mr-1.5" />
          {t('utm.refreshNow')}
        </Button>
      )}

      <span className="ml-auto text-xs text-muted-foreground">
        {lastFetchedAt
          ? t('utm.lastRefreshed', { time: new Date(lastFetchedAt).toLocaleTimeString() })
          : t('utm.notYetLoaded')}
      </span>

      {posthogUrl && (
        <Button variant="ghost" size="sm" className="h-8" asChild>
          <a href={posthogUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="size-3.5 mr-1.5" />
            {t('viewInPostHog')}
          </a>
        </Button>
      )}
    </div>
  );
}
