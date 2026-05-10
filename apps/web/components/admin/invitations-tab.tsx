'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { InvitationsReferralsSection } from '@/components/admin/invitations-referrals-section';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const DAY_OPTIONS = [7, 30, 90] as const;
type DaysWindow = (typeof DAY_OPTIONS)[number];

/**
 * Standalone Invitations & Referrals tab. Owns its own time-window state —
 * unlike the Acquisition tab, no UTM polling/auto-refresh applies here, so
 * a single Select is enough.
 */
export function InvitationsTab() {
  const t = useTranslations('admin.analytics');
  const [days, setDays] = useState<DaysWindow>(30);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 rounded-md border bg-muted/30 px-3 py-2">
        <Label className="text-xs text-muted-foreground">{t('utm.timeWindow')}</Label>
        <Select value={String(days)} onValueChange={v => setDays(Number(v) as DaysWindow)}>
          <SelectTrigger className="h-8 w-[110px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DAY_OPTIONS.map(option => (
              <SelectItem key={option} value={String(option)}>
                {t(`timeRange.${option}d`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <InvitationsReferralsSection days={days} />
    </div>
  );
}
