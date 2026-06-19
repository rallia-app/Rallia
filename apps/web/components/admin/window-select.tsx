'use client';

import { useTranslations } from 'next-intl';

import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * Per-insight time-window picker. Each analytics insight owns its own window
 * state and renders this in its card header — there is no shared/global window.
 */
export function WindowSelect({
  value,
  onChange,
  options,
}: {
  value: number;
  onChange: (days: number) => void;
  options: readonly number[];
}) {
  const t = useTranslations('admin.analytics');
  return (
    <div className="flex items-center gap-2">
      <Label className="text-xs text-muted-foreground shrink-0">{t('utm.timeWindow')}</Label>
      <Select value={String(value)} onValueChange={v => onChange(Number(v))}>
        <SelectTrigger className="h-8 w-[120px] shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(option => (
            <SelectItem key={option} value={String(option)}>
              {t(`timeRange.${option}d`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
