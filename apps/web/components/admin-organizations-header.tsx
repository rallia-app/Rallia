'use client';

import { OrganizationDialog } from '@/components/organization-dialog';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { useState } from 'react';

interface AdminOrganizationsHeaderProps {
  title: string;
  description: string;
  createButtonLabel: string;
}

export function AdminOrganizationsHeader({
  title,
  description,
  createButtonLabel,
}: AdminOrganizationsHeaderProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      <OrganizationDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-0">{title}</h1>
          <p className="text-muted-foreground mt-2 mb-0">{description}</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4" />
          {createButtonLabel}
        </Button>
      </div>
    </>
  );
}
