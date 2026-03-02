'use client';

import { Button } from '@/components/ui/button';
import { FacilityDialog, type FacilityInitialData } from '@/components/facility-dialog';
import { Edit } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

interface FacilityEditButtonProps {
  facility: FacilityInitialData;
}

export function FacilityEditButton({ facility }: FacilityEditButtonProps) {
  const t = useTranslations('facilities');
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      <Button variant="outline" onClick={() => setDialogOpen(true)}>
        <Edit className="mr-2 size-4" />
        {t('detail.editButton')}
      </Button>
      <FacilityDialog open={dialogOpen} onOpenChange={setDialogOpen} initialData={facility} />
    </>
  );
}
