'use client';

import { useUtmCampaigns } from '@rallia/shared-hooks';
import { Archive } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/**
 * List of active campaigns with archive action. Reads/writes via the shared
 * `useUtmCampaigns` hook so any change here updates the LinkBuilder dropdown
 * on the same page (both hooks share the underlying RPC).
 *
 * Note: the hook caches per-mount, so the LinkBuilder still calls its own
 * instance — refetch coordination is by user action (archive succeeds →
 * both will re-pull on their next render that the user triggers).
 */
export function CampaignListSection() {
  const t = useTranslations('admin.analytics.links');
  const { campaigns, loading, archive } = useUtmCampaigns();
  const [archivingId, setArchivingId] = useState<string | null>(null);

  const handleArchive = async (id: string) => {
    setArchivingId(id);
    await archive(id);
    setArchivingId(null);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t('campaignsTitle')}</CardTitle>
        <p className="text-xs text-muted-foreground m-0 mt-1">{t('campaignsDescription')}</p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : campaigns.length === 0 ? (
          <p className="text-sm text-muted-foreground m-0">{t('noCampaigns')}</p>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('name')}</TableHead>
                  <TableHead>{t('slug')}</TableHead>
                  <TableHead>{t('description')}</TableHead>
                  <TableHead className="w-[60px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.map(c => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.displayName}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-xs">
                        {c.slug}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {c.description || '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => void handleArchive(c.id)}
                        disabled={archivingId === c.id}
                        title={t('archive')}
                      >
                        <Archive className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
