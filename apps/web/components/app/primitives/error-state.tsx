'use client';

import { AlertTriangle, RotateCw } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ErrorStateProps {
  title?: string;
  description?: string;
  /** Wire to a query's refetch. Omitted when there is nothing sensible to retry. */
  onRetry?: () => void;
  className?: string;
}

/**
 * The house error state.
 *
 * Deliberately never surfaces the raw error: a player cannot act on a Postgres code,
 * and it leaks schema detail. Diagnostics belong in Sentry.
 */
export function ErrorState({ title, description, onRetry, className }: ErrorStateProps) {
  const t = useTranslations('errors');
  const tCommon = useTranslations('common');

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-6 py-12 text-center',
        className
      )}
      role="alert"
    >
      <div className="rounded-full bg-destructive/10 p-3">
        <AlertTriangle className="size-6 text-destructive" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <p className="font-medium text-foreground">{title ?? t('serverError')}</p>
        {description && (
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCw className="mr-2 size-4" aria-hidden="true" />
          {tCommon('retry')}
        </Button>
      )}
    </div>
  );
}
