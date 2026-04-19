'use client';

import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { ReferralContestDialog } from './referral-contests-data-table';

interface AdminReferralContestsHeaderProps {
  title: string;
  description: string;
  createButtonLabel: string;
  canCreate?: boolean;
}

export function AdminReferralContestsHeader({
  title,
  description,
  createButtonLabel,
  canCreate = true,
}: AdminReferralContestsHeaderProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      {canCreate && <ReferralContestDialog open={dialogOpen} onOpenChange={setDialogOpen} />}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-0">{title}</h1>
          <p className="text-muted-foreground mt-2 mb-0">{description}</p>
        </div>
        {canCreate && (
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4" />
            {createButtonLabel}
          </Button>
        )}
      </div>
    </>
  );
}
