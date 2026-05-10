'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Link } from '@/i18n/navigation';
import { BackButton } from '@/components/back-button';
import { GraduationCap, Loader2, Plus, Star, Trash2, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { getStorageImageUrl } from '@rallia/shared-utils';

interface Instructor {
  id: string;
  display_name: string;
  email: string | null;
  avatar_url: string | null;
  is_active: boolean;
  specializations: string[] | null;
}

interface ProgramInstructor {
  id: string;
  is_primary: boolean;
  instructor: Instructor | null;
}

export default function ProgramInstructorsPage() {
  const params = useParams();
  const t = useTranslations('programs.manageInstructors');
  const tCommon = useTranslations('common');
  const programId = params.id as string;

  const [assignedInstructors, setAssignedInstructors] = useState<ProgramInstructor[]>([]);
  const [availableInstructors, setAvailableInstructors] = useState<Instructor[]>([]);
  const [loading, setLoading] = useState(true);
  const [program, setProgram] = useState<{ name: string; status: string } | null>(null);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [selectedInstructors, setSelectedInstructors] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch program details
      const programRes = await fetch(`/api/programs/${programId}`);
      if (programRes.ok) {
        const programData = await programRes.json();
        setProgram({ name: programData.name, status: programData.status });
      }

      // Fetch assigned instructors
      const assignedRes = await fetch(`/api/programs/${programId}/instructors`);
      if (assignedRes.ok) {
        const assignedData = await assignedRes.json();
        setAssignedInstructors(assignedData);
      }

      // Fetch all available instructors
      const allRes = await fetch('/api/instructors?isActive=true');
      if (allRes.ok) {
        const allData = await allRes.json();
        // API returns { data: [...], count: n } for paginated results
        setAvailableInstructors(allData.data || allData || []);
      }
    } catch (err) {
      console.error('Error fetching data:', err);
      setError(t('errors.failedToLoad'));
    } finally {
      setLoading(false);
    }
  }, [programId, t]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const assignedIds = assignedInstructors.map(pi => pi.instructor?.id).filter(Boolean) as string[];

  const unassignedInstructors = availableInstructors.filter(i => !assignedIds.includes(i.id));

  const primaryInstructorId = assignedInstructors.find(pi => pi.is_primary)?.instructor?.id;

  async function handleAddInstructors() {
    if (selectedInstructors.length === 0) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const newIds = [...assignedIds, ...selectedInstructors];
      const response = await fetch(`/api/programs/${programId}/instructors`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instructorIds: newIds,
          primaryInstructorId: primaryInstructorId || newIds[0],
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || t('errors.failedToAdd'));
      }

      const updatedAssignments = await response.json();
      setAssignedInstructors(updatedAssignments);
      setSelectedInstructors([]);
      setIsAddDialogOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.failedToAdd'));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRemoveInstructor(instructorId: string) {
    setIsSubmitting(true);
    setError(null);

    try {
      const newIds = assignedIds.filter(id => id !== instructorId);
      const newPrimary = instructorId === primaryInstructorId ? newIds[0] : primaryInstructorId;

      const response = await fetch(`/api/programs/${programId}/instructors`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instructorIds: newIds,
          primaryInstructorId: newPrimary,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || t('errors.failedToRemove'));
      }

      const updatedAssignments = await response.json();
      setAssignedInstructors(updatedAssignments);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.failedToRemove'));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSetPrimary(instructorId: string) {
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/programs/${programId}/instructors`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instructorIds: assignedIds,
          primaryInstructorId: instructorId,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || t('errors.failedToUpdate'));
      }

      const updatedAssignments = await response.json();
      setAssignedInstructors(updatedAssignments);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.failedToUpdate'));
    } finally {
      setIsSubmitting(false);
    }
  }

  function toggleInstructorSelection(instructorId: string) {
    setSelectedInstructors(prev =>
      prev.includes(instructorId) ? prev.filter(id => id !== instructorId) : [...prev, instructorId]
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isReadOnly = program?.status === 'completed' || program?.status === 'cancelled';

  return (
    <div className="flex flex-col w-full gap-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <BackButton className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4">
            {t('backToProgram')}
          </BackButton>
          <h1 className="text-3xl font-bold mb-0">{t('title')}</h1>
          {program && <p className="text-muted-foreground mb-0">{program.name}</p>}
        </div>
        {!isReadOnly && (
          <Button onClick={() => setIsAddDialogOpen(true)}>
            <Plus className="mr-2 size-4" />
            {t('addInstructor')}
          </Button>
        )}
      </div>

      {error && (
        <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
          {error}
        </div>
      )}

      {isReadOnly && (
        <div className="p-4 bg-muted border rounded-lg text-muted-foreground text-sm">
          {t('readOnlyNotice')}
        </div>
      )}

      {/* Assigned Instructors */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GraduationCap className="size-5" />
            {t('assignedInstructors')}
          </CardTitle>
          <CardDescription>
            {assignedInstructors.length === 0
              ? t('noInstructorsAssigned')
              : t('instructorCount', { count: assignedInstructors.length })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {assignedInstructors.length === 0 ? (
            <div className="text-center py-8">
              <UserPlus className="size-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <p className="text-muted-foreground mb-4">{t('noInstructorsAssigned')}</p>
              {!isReadOnly && (
                <Button variant="outline" onClick={() => setIsAddDialogOpen(true)}>
                  <Plus className="mr-2 size-4" />
                  {t('addFirst')}
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {assignedInstructors.map(pi => (
                <div
                  key={pi.id}
                  className="flex items-center justify-between p-4 rounded-lg border"
                >
                  <div className="flex items-center gap-4">
                    <div className="size-12 rounded-full bg-primary/10 flex items-center justify-center">
                      {pi.instructor?.avatar_url ? (
                        <img
                          src={
                            getStorageImageUrl(pi.instructor.avatar_url, {
                              width: 96,
                              height: 96,
                              quality: 70,
                            }) ?? ''
                          }
                          alt={pi.instructor.display_name}
                          className="size-12 rounded-full object-cover"
                        />
                      ) : (
                        <GraduationCap className="size-6 text-primary" />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold mb-0">{pi.instructor?.display_name}</p>
                        {pi.is_primary && (
                          <Badge variant="default" className="text-xs">
                            <Star className="size-3 mr-1" />
                            {t('primary')}
                          </Badge>
                        )}
                      </div>
                      {pi.instructor?.email && (
                        <p className="text-sm text-muted-foreground mb-2">{pi.instructor.email}</p>
                      )}
                      {pi.instructor?.specializations &&
                        pi.instructor.specializations.length > 0 && (
                          <div className="flex gap-1 mt-1">
                            {pi.instructor.specializations.slice(0, 3).map((spec, i) => (
                              <Badge key={i} variant="secondary" className="text-xs">
                                {spec}
                              </Badge>
                            ))}
                          </div>
                        )}
                    </div>
                  </div>
                  {!isReadOnly && (
                    <div className="flex items-center gap-2">
                      {!pi.is_primary && assignedInstructors.length > 1 && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleSetPrimary(pi.instructor!.id)}
                          disabled={isSubmitting}
                        >
                          <Star className="size-4" />
                          <span className="sr-only">{t('setPrimary')}</span>
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleRemoveInstructor(pi.instructor!.id)}
                        disabled={isSubmitting}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="size-4" />
                        <span className="sr-only">{t('remove')}</span>
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Instructor Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="mb-0">{t('addInstructorDialog.title')}</DialogTitle>
            <DialogDescription className="mb-0">
              {t('addInstructorDialog.description')}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            {unassignedInstructors.length === 0 ? (
              <div className="text-center py-8">
                <GraduationCap className="size-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                <p className="text-muted-foreground mb-4">{t('addInstructorDialog.noAvailable')}</p>
                <Button variant="outline" asChild>
                  <Link href="/dashboard/programs/instructors/new">
                    <Plus className="mr-2 size-4" />
                    {t('addInstructorDialog.createNew')}
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {unassignedInstructors.map(instructor => (
                  <label
                    key={instructor.id}
                    className="flex items-center gap-4 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors"
                  >
                    <Checkbox
                      checked={selectedInstructors.includes(instructor.id)}
                      onCheckedChange={() => toggleInstructorSelection(instructor.id)}
                    />
                    <div className="size-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      {instructor.avatar_url ? (
                        <img
                          src={
                            getStorageImageUrl(instructor.avatar_url, {
                              width: 80,
                              height: 80,
                              quality: 70,
                            }) ?? ''
                          }
                          alt={instructor.display_name}
                          className="size-10 rounded-full object-cover"
                        />
                      ) : (
                        <GraduationCap className="size-5 text-primary" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium mb-0">{instructor.display_name}</p>
                      {instructor.email && (
                        <p className="text-sm text-muted-foreground truncate mb-0">
                          {instructor.email}
                        </p>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setSelectedInstructors([]);
                setIsAddDialogOpen(false);
              }}
            >
              {tCommon('cancel')}
            </Button>
            <Button
              onClick={handleAddInstructors}
              disabled={selectedInstructors.length === 0 || isSubmitting}
            >
              {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
              {t('addInstructorDialog.add', { count: selectedInstructors.length })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
