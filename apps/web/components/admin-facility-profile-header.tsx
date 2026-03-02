'use client';

import { FacilityDialog, type FacilityInitialData } from '@/components/facility-dialog';
import { FacilityDeleteButton } from '@/components/facility-delete-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Link, useRouter } from '@/i18n/navigation';
import { ArrowLeft, Edit, MapPin } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';

interface AdminFacilityProfileHeaderProps {
  facility: FacilityInitialData;
  facilityName: string;
  isActive: boolean;
  address: string | null;
  city: string | null;
  country: string | null;
  organizationSlug: string;
  organizationId: string;
  backLabel: string;
}

export function AdminFacilityProfileHeader({
  facility,
  facilityName,
  isActive,
  address,
  city,
  country,
  organizationSlug,
  organizationId,
  backLabel,
}: AdminFacilityProfileHeaderProps) {
  const t = useTranslations('facilities');
  const router = useRouter();
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  const handleOrganizationChanged = useCallback(() => {
    router.push(`/admin/organizations/${organizationSlug}`);
  }, [router, organizationSlug]);

  const addressParts = [address, city, country].filter(Boolean).join(', ');

  return (
    <>
      <FacilityDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        initialData={{ ...facility, organization_id: organizationId }}
        isAdminContext
        onOrganizationChanged={handleOrganizationChanged}
      />
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-4">
          <Link
            href={`/admin/organizations/${organizationSlug}`}
            className="p-2 hover:bg-muted rounded-md transition-colors mt-1 inline-flex items-center"
          >
            <ArrowLeft className="size-5" />
            <span className="sr-only">{backLabel}</span>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold m-0">{facilityName}</h1>
              <Badge variant={isActive ? 'default' : 'secondary'}>
                {isActive ? t('status.active') : t('status.inactive')}
              </Badge>
            </div>
            {addressParts && (
              <p className="text-muted-foreground mb-0 flex items-center gap-1">
                <MapPin className="size-4" />
                {addressParts}
              </p>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setEditDialogOpen(true)}>
            <Edit className="h-4 w-4 mr-2" />
            {t('detail.editButton')}
          </Button>
          <FacilityDeleteButton
            facilityId={facility.id}
            facilityName={facilityName}
            organizationSlug={organizationSlug}
          />
        </div>
      </div>
    </>
  );
}
