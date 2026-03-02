'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CourtDialog } from '@/components/court-dialog';
import { Link } from '@/i18n/navigation';
import { ArrowLeft, Edit } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

interface Court {
  id: string;
  name: string | null;
  court_number: number | null;
  surface_type: string | null;
  indoor: boolean | null;
  lighting: boolean | null;
  lines_marked_for_multiple_sports: boolean | null;
  availability_status: string | null;
  notes: string | null;
  court_sport?: Array<{ sport_id: string; sport?: { id: string; name: string } | null }>;
}

interface CourtDetailHeaderProps {
  facilityId: string;
  facilityName: string;
  court: Court;
  canEdit: boolean;
}

export function CourtDetailHeader({
  facilityId,
  facilityName,
  court,
  canEdit,
}: CourtDetailHeaderProps) {
  const t = useTranslations('courts');
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  const courtName = court.name || `Court ${court.court_number}`;

  return (
    <>
      {canEdit && (
        <CourtDialog
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          facilityId={facilityId}
          initialData={court}
        />
      )}

      <div className="flex items-start justify-between">
        <div className="flex items-start gap-4">
          <Link
            href={`/dashboard/facilities/${facilityId}`}
            className="p-2 hover:bg-muted rounded-md transition-colors mt-1"
          >
            <ArrowLeft className="size-5" />
          </Link>
          <div>
            <p className="text-sm text-muted-foreground mb-1">{facilityName}</p>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold m-0">{courtName}</h1>
              <Badge
                variant={
                  court.availability_status === 'available'
                    ? 'default'
                    : court.availability_status === 'maintenance'
                      ? 'outline'
                      : 'secondary'
                }
              >
                {t(`status.${court.availability_status}`)}
              </Badge>
            </div>
            {court.court_number && court.name && (
              <p className="text-muted-foreground mt-2 mb-0">Court #{court.court_number}</p>
            )}
          </div>
        </div>
        {canEdit && (
          <Button variant="outline" onClick={() => setEditDialogOpen(true)}>
            <Edit className="mr-2 size-4" />
            {t('detail.editButton')}
          </Button>
        )}
      </div>
    </>
  );
}
