'use client';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MessageSquare } from 'lucide-react';
import { useTranslations, useLocale } from 'next-intl';
import { useState } from 'react';

interface FeedbackEntry {
  id: string;
  category: string;
  subject: string;
  message: string;
  status: string;
  app_version: string | null;
  admin_notes: string | null;
  created_at: string;
}

interface AdminUserFeedbackSectionProps {
  feedback: FeedbackEntry[];
  sectionTitle: string;
}

const categoryVariants: Record<string, 'destructive' | 'default' | 'secondary' | 'outline'> = {
  bug: 'destructive',
  feature: 'default',
  improvement: 'secondary',
  other: 'outline',
};

const statusVariants: Record<string, 'destructive' | 'default' | 'secondary' | 'outline'> = {
  new: 'default',
  reviewed: 'secondary',
  in_progress: 'outline',
  resolved: 'secondary',
  closed: 'outline',
};

export function AdminUserFeedbackSection({
  feedback,
  sectionTitle,
}: AdminUserFeedbackSectionProps) {
  const t = useTranslations('admin.users.detail.feedback');
  const locale = useLocale();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const formatDate = (dateString: string) =>
    new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(new Date(dateString));

  return (
    <Card className="overflow-hidden">
      <CardHeader className="bg-muted/30 border-b">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            {sectionTitle}
          </CardTitle>
          {feedback.length > 0 && (
            <Badge variant="secondary">{t('count', { count: feedback.length })}</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-6">
        {feedback.length === 0 ? (
          <p className="text-muted-foreground text-center py-4 m-0">{t('empty')}</p>
        ) : (
          <div className="space-y-3">
            {feedback.map(entry => {
              const isExpanded = expandedId === entry.id;
              return (
                <div
                  key={entry.id}
                  className="border rounded-lg p-4 hover:bg-muted/30 transition-colors cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <Badge
                          variant={categoryVariants[entry.category] ?? 'outline'}
                          className="text-xs"
                        >
                          {t(`category.${entry.category}`)}
                        </Badge>
                        <Badge
                          variant={statusVariants[entry.status] ?? 'outline'}
                          className="text-xs"
                        >
                          {t(`status.${entry.status}`)}
                        </Badge>
                      </div>
                      <p className="font-medium text-sm m-0">{entry.subject}</p>
                      {!isExpanded && (
                        <p className="text-sm text-muted-foreground m-0 mt-1 line-clamp-2">
                          {entry.message}
                        </p>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDate(entry.created_at)}
                    </span>
                  </div>

                  {isExpanded && (
                    <div className="mt-3 space-y-3">
                      <div className="bg-muted/20 rounded-lg p-3">
                        <p className="text-sm m-0 whitespace-pre-wrap">{entry.message}</p>
                      </div>

                      {entry.admin_notes && (
                        <div className="bg-primary/5 rounded-lg p-3">
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide m-0 mb-1">
                            {t('adminNotes')}
                          </p>
                          <p className="text-sm m-0">{entry.admin_notes}</p>
                        </div>
                      )}

                      {entry.app_version && (
                        <p className="text-xs text-muted-foreground m-0">
                          {t('appVersion')}: {entry.app_version}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
