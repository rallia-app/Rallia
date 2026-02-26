'use client';

import { OrganizationDialog, OrganizationInitialData } from '@/components/organization-dialog';
import { OrganizationDeleteButton } from '@/components/organization-delete-button';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { ArrowLeft, Edit } from 'lucide-react';
import { useState } from 'react';

interface AdminOrgProfileHeaderProps {
  slug: string;
  organizationName: string;
  title: string;
  description: string;
  updateButtonLabel: string;
  backLabel: string;
  initialData: OrganizationInitialData;
}

export function AdminOrgProfileHeader({
  slug,
  organizationName,
  title,
  description,
  updateButtonLabel,
  backLabel,
  initialData,
}: AdminOrgProfileHeaderProps) {
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  return (
    <>
      <OrganizationDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        initialData={initialData}
      />
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-4">
          <Link
            href="/admin/organizations"
            className="p-2 hover:bg-muted rounded-md transition-colors mt-1 inline-flex items-center"
          >
            <ArrowLeft className="size-5" />
            <span className="sr-only">{backLabel}</span>
          </Link>
          <div>
            <h1 className="text-3xl font-bold mb-0">{title}</h1>
            <p className="text-muted-foreground mt-2 mb-0">{description}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setEditDialogOpen(true)}>
            <Edit className="h-4 w-4 mr-2" />
            {updateButtonLabel}
          </Button>
          <OrganizationDeleteButton organizationSlug={slug} organizationName={organizationName} />
        </div>
      </div>
    </>
  );
}
