'use client';

import { CourtDialog, CourtInitialData } from '@/components/court-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { createClient } from '@/lib/supabase/client';
import { Link, useRouter } from '@/i18n/navigation';
import { Building2, ChevronRight, Lightbulb, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
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
  is_active: boolean | null;
  court_sport?: Array<{
    sport_id: string;
    sport?: {
      id: string;
      name: string;
    } | null;
  }>;
}

interface FacilityCourtsSectionProps {
  facilityId: string;
  courts: Court[];
  canEdit: boolean;
  disableCourtLinks?: boolean;
}

export function FacilityCourtsSection({
  facilityId,
  courts,
  canEdit,
  disableCourtLinks,
}: FacilityCourtsSectionProps) {
  const t = useTranslations('facilities');
  const tCourts = useTranslations('courts');
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editCourt, setEditCourt] = useState<CourtInitialData | null>(null);
  const [deleteCourt, setDeleteCourt] = useState<Court | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!deleteCourt) return;
    setDeleting(true);
    try {
      const supabase = createClient();

      // Delete court_sport records first
      const { error: sportError } = await supabase
        .from('court_sport')
        .delete()
        .eq('court_id', deleteCourt.id);
      if (sportError) throw sportError;

      // Delete the court
      const { error: courtError } = await supabase.from('court').delete().eq('id', deleteCourt.id);
      if (courtError) throw courtError;

      setDeleteCourt(null);
      router.refresh();
    } catch (err) {
      console.error('Error deleting court:', err);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      {canEdit && (
        <>
          <CourtDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            facilityId={facilityId}
            existingCourtNumbers={courts
              .filter(c => c.court_number != null)
              .map(c => c.court_number as number)}
          />
          <CourtDialog
            open={!!editCourt}
            onOpenChange={open => {
              if (!open) setEditCourt(null);
            }}
            facilityId={facilityId}
            initialData={editCourt ?? undefined}
          />
          <Dialog
            open={!!deleteCourt}
            onOpenChange={open => {
              if (!open) setDeleteCourt(null);
            }}
          >
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{tCourts('delete.title')}</DialogTitle>
                <DialogDescription>
                  {tCourts('delete.description', {
                    name: deleteCourt?.name || `Court ${deleteCourt?.court_number}`,
                  })}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDeleteCourt(null)} disabled={deleting}>
                  {tCourts('delete.cancel')}
                </Button>
                <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
                  {deleting ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      {tCourts('delete.deleting')}
                    </>
                  ) : (
                    <>
                      <Trash2 className="mr-2 size-4" />
                      {tCourts('delete.confirm')}
                    </>
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg">{t('detail.courtsSection')}</CardTitle>
            <CardDescription>{t('detail.courtsSummary', { count: courts.length })}</CardDescription>
          </div>
          {canEdit && (
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              <Plus className="mr-1.5 size-4" />
              {tCourts('addCourt')}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {courts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Building2 className="size-8 mx-auto mb-2 opacity-50" />
              <p className="mb-4">{tCourts('emptyState.description')}</p>
              {canEdit && (
                <Button variant="outline" onClick={() => setDialogOpen(true)}>
                  <Plus className="mr-2 size-4" />
                  {tCourts('emptyState.addButton')}
                </Button>
              )}
            </div>
          ) : (
            <div className="divide-y">
              {courts.map(court => {
                const courtContent = (
                  <>
                    <div className="flex items-center gap-2.5 flex-1 min-w-0">
                      <div
                        className={`size-2.5 rounded-full shrink-0 ${
                          court.availability_status === 'available'
                            ? 'bg-green-500'
                            : court.availability_status === 'maintenance'
                              ? 'bg-yellow-500'
                              : 'bg-gray-400'
                        }`}
                      />
                      <span className="font-semibold text-sm shrink-0">
                        {court.name || `Court ${court.court_number}`}
                      </span>
                      {court.court_number != null && (
                        <span className="text-xs text-muted-foreground shrink-0">
                          #{court.court_number}
                        </span>
                      )}
                      <div className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
                        {court.surface_type && (
                          <span>{tCourts(`surface.${court.surface_type}`)}</span>
                        )}
                        {court.indoor !== undefined && court.indoor !== null && (
                          <span>
                            • {court.indoor ? tCourts('type.indoor') : tCourts('type.outdoor')}
                          </span>
                        )}
                        {court.lighting && (
                          <span className="flex items-center gap-1">
                            <Lightbulb className="size-2.5" />
                            {tCourts('detail.lighting')}
                          </span>
                        )}
                      </div>
                      {court.court_sport && court.court_sport.length > 0 && (
                        <div className="flex items-center gap-1 flex-wrap">
                          {court.court_sport.map(cs => (
                            <Badge key={cs.sport_id} variant="outline" className="text-xs">
                              {cs.sport?.name || cs.sport_id}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge
                        variant={
                          court.availability_status === 'available' ? 'default' : 'secondary'
                        }
                        className="text-xs"
                      >
                        {tCourts(`status.${court.availability_status}`)}
                      </Badge>
                      {canEdit && (
                        <>
                          <button
                            type="button"
                            onClick={e => {
                              e.preventDefault();
                              e.stopPropagation();
                              setEditCourt(court);
                            }}
                            className="p-1 rounded hover:bg-muted transition-colors"
                          >
                            <Pencil className="size-3.5 text-muted-foreground" />
                          </button>
                          <button
                            type="button"
                            onClick={e => {
                              e.preventDefault();
                              e.stopPropagation();
                              setDeleteCourt(court);
                            }}
                            className="p-1 rounded hover:bg-destructive/10 transition-colors"
                          >
                            <Trash2 className="size-3.5 text-destructive" />
                          </button>
                        </>
                      )}
                      {!disableCourtLinks && (
                        <ChevronRight className="size-4 text-muted-foreground" />
                      )}
                    </div>
                  </>
                );

                if (disableCourtLinks) {
                  return (
                    <div
                      key={court.id}
                      className="flex items-center justify-between py-2.5 -mx-2 px-2 rounded"
                    >
                      {courtContent}
                    </div>
                  );
                }

                return (
                  <Link
                    key={court.id}
                    href={`/dashboard/facilities/${facilityId}/courts/${court.id}`}
                    className="flex items-center justify-between py-2.5 hover:bg-muted/50 -mx-2 px-2 rounded transition-colors"
                  >
                    {courtContent}
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
