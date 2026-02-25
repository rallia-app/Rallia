'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { Loader2, Plus, Save } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { useEffect, useRef, useState } from 'react';

// These must match the surface_type_enum in the database
const SURFACE_TYPES = [
  'hard',
  'clay',
  'grass',
  'synthetic',
  'carpet',
  'concrete',
  'asphalt',
] as const;

// These must match the availability_enum in the database
const AVAILABILITY_STATUSES = ['available', 'maintenance', 'closed', 'reserved'] as const;

type SurfaceType = (typeof SURFACE_TYPES)[number];
type AvailabilityStatus = (typeof AVAILABILITY_STATUSES)[number];

export interface CourtInitialData {
  id: string;
  name: string | null;
  court_number: number | null;
  surface_type: string | null;
  indoor: boolean | null;
  lighting: boolean | null;
  lines_marked_for_multiple_sports: boolean | null;
  availability_status: string | null;
  notes: string | null;
  court_sport?: Array<{ sport_id: string }>;
}

interface CourtDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  facilityId: string;
  initialData?: CourtInitialData;
}

export function CourtDialog({ open, onOpenChange, facilityId, initialData }: CourtDialogProps) {
  const t = useTranslations('courts');
  const router = useRouter();
  const isEditMode = !!initialData;

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sports state
  const [sports, setSports] = useState<Array<{ id: string; name: string; slug: string }>>([]);
  const [loadingSports, setLoadingSports] = useState(true);
  const [selectedSports, setSelectedSports] = useState<string[]>([]);
  const originalSportsRef = useRef<string[]>([]);

  // Form state
  const [name, setName] = useState('');
  const [courtNumber, setCourtNumber] = useState<number | ''>('');
  const [surfaceType, setSurfaceType] = useState<SurfaceType | ''>('');
  const [indoor, setIndoor] = useState(false);
  const [lighting, setLighting] = useState(false);
  const [multiSport, setMultiSport] = useState(false);
  const [availabilityStatus, setAvailabilityStatus] = useState<AvailabilityStatus>('available');
  const [notes, setNotes] = useState('');

  // Fetch sports on mount
  useEffect(() => {
    const fetchSports = async () => {
      try {
        const response = await fetch('/api/sports');
        if (response.ok) {
          const data = await response.json();
          setSports(data.sports || []);
        }
      } catch (err) {
        console.error('Error fetching sports:', err);
      } finally {
        setLoadingSports(false);
      }
    };

    if (open) {
      fetchSports();
    }
  }, [open]);

  // Populate form when initialData changes or dialog opens
  useEffect(() => {
    if (open && initialData) {
      setName(initialData.name || '');
      setCourtNumber(initialData.court_number || '');
      setSurfaceType((initialData.surface_type as SurfaceType) || '');
      setIndoor(initialData.indoor ?? false);
      setLighting(initialData.lighting ?? false);
      setMultiSport(initialData.lines_marked_for_multiple_sports ?? false);
      setAvailabilityStatus((initialData.availability_status as AvailabilityStatus) || 'available');
      setNotes(initialData.notes || '');

      const courtSports = initialData.court_sport?.map(cs => cs.sport_id) || [];
      setSelectedSports(courtSports);
      originalSportsRef.current = courtSports;

      setError(null);
    }
  }, [open, initialData]);

  const toggleSport = (sportId: string) => {
    setSelectedSports(prev =>
      prev.includes(sportId) ? prev.filter(id => id !== sportId) : [...prev, sportId]
    );
  };

  const resetForm = () => {
    setName('');
    setCourtNumber('');
    setSurfaceType('');
    setIndoor(false);
    setLighting(false);
    setMultiSport(false);
    setAvailabilityStatus('available');
    setNotes('');
    setSelectedSports([]);
    setError(null);
  };

  const handleClose = () => {
    if (!saving) {
      if (!isEditMode) resetForm();
      onOpenChange(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const supabase = createClient();

      if (isEditMode) {
        // Update mode
        const { error: updateError } = await supabase
          .from('court')
          .update({
            name: name || null,
            court_number: courtNumber || null,
            surface_type: surfaceType || null,
            indoor,
            lighting,
            lines_marked_for_multiple_sports: multiSport,
            availability_status: availabilityStatus,
            notes: notes || null,
          })
          .eq('id', initialData!.id);

        if (updateError) throw updateError;

        // Sync court_sport records
        const originalSports = originalSportsRef.current;
        const sportsToAdd = selectedSports.filter(id => !originalSports.includes(id));
        const sportsToRemove = originalSports.filter(id => !selectedSports.includes(id));

        if (sportsToRemove.length > 0) {
          const { error: deleteError } = await supabase
            .from('court_sport')
            .delete()
            .eq('court_id', initialData!.id)
            .in('sport_id', sportsToRemove);

          if (deleteError) throw deleteError;
        }

        if (sportsToAdd.length > 0) {
          const newRecords = sportsToAdd.map(sportId => ({
            court_id: initialData!.id,
            sport_id: sportId,
          }));

          const { error: insertError } = await supabase.from('court_sport').insert(newRecords);
          if (insertError) throw insertError;
        }

        onOpenChange(false);
        router.refresh();
      } else {
        // Create mode
        const { data: court, error: insertError } = await supabase
          .from('court')
          .insert({
            facility_id: facilityId,
            name: name || null,
            court_number: courtNumber || null,
            surface_type: surfaceType || null,
            indoor,
            lighting,
            lines_marked_for_multiple_sports: multiSport,
            notes: notes || null,
            availability_status: 'available' as const,
            is_active: true,
          })
          .select('id')
          .single();

        if (insertError) throw insertError;

        // Insert court_sport records
        if (selectedSports.length > 0 && court) {
          const courtSportRecords = selectedSports.map(sportId => ({
            court_id: court.id,
            sport_id: sportId,
          }));

          const { error: sportError } = await supabase
            .from('court_sport')
            .insert(courtSportRecords);

          if (sportError) throw sportError;
        }

        resetForm();
        onOpenChange(false);
        router.refresh();
      }
    } catch (err) {
      console.error(`Error ${isEditMode ? 'updating' : 'adding'} court:`, err);
      setError(isEditMode ? t('edit.error') : t('add.error'));
    } finally {
      setSaving(false);
    }
  };

  const isValid = name.trim() || courtNumber;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditMode ? t('edit.title') : t('add.title')}</DialogTitle>
          <DialogDescription>
            {isEditMode
              ? initialData!.name || `Court ${initialData!.court_number}`
              : t('add.description')}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="court-name">{t('add.nameLabel')}</Label>
              <Input
                id="court-name"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={t('add.namePlaceholder')}
                disabled={saving}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="court-number">{t('add.numberLabel')}</Label>
              <Input
                id="court-number"
                type="number"
                min="1"
                value={courtNumber}
                onChange={e => setCourtNumber(e.target.value ? parseInt(e.target.value) : '')}
                placeholder={t('add.numberPlaceholder')}
                disabled={saving}
              />
            </div>
          </div>

          <div className={isEditMode ? 'grid grid-cols-2 gap-4' : ''}>
            <div className="space-y-2">
              <Label htmlFor="court-surfaceType">{t('add.surfaceLabel')}</Label>
              <select
                id="court-surfaceType"
                value={surfaceType}
                onChange={e => setSurfaceType(e.target.value as SurfaceType | '')}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={saving}
              >
                <option value="">{t('add.surfacePlaceholder')}</option>
                {SURFACE_TYPES.map(type => (
                  <option key={type} value={type}>
                    {t(`surface.${type}`)}
                  </option>
                ))}
              </select>
            </div>

            {isEditMode && (
              <div className="space-y-2">
                <Label htmlFor="court-status">{t('table.status')}</Label>
                <select
                  id="court-status"
                  value={availabilityStatus}
                  onChange={e => setAvailabilityStatus(e.target.value as AvailabilityStatus)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={saving}
                >
                  {AVAILABILITY_STATUSES.map(status => (
                    <option key={status} value={status}>
                      {t(`status.${status}`)}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="court-indoor"
                checked={indoor}
                onChange={e => setIndoor(e.target.checked)}
                className="size-4 rounded border-gray-300"
                disabled={saving}
              />
              <div>
                <Label htmlFor="court-indoor" className="cursor-pointer">
                  {t('add.indoorLabel')}
                </Label>
                <p className="text-sm text-muted-foreground">{t('add.indoorHint')}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="court-lighting"
                checked={lighting}
                onChange={e => setLighting(e.target.checked)}
                className="size-4 rounded border-gray-300"
                disabled={saving}
              />
              <div>
                <Label htmlFor="court-lighting" className="cursor-pointer">
                  {t('add.lightingLabel')}
                </Label>
                <p className="text-sm text-muted-foreground">{t('add.lightingHint')}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="court-multiSport"
                checked={multiSport}
                onChange={e => setMultiSport(e.target.checked)}
                className="size-4 rounded border-gray-300"
                disabled={saving}
              />
              <div>
                <Label htmlFor="court-multiSport" className="cursor-pointer">
                  {t('add.multiSportLabel')}
                </Label>
                <p className="text-sm text-muted-foreground">{t('add.multiSportHint')}</p>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="court-notes">{t('add.notesLabel')}</Label>
            <textarea
              id="court-notes"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder={t('add.notesPlaceholder')}
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={saving}
            />
          </div>

          {/* Sports Selection */}
          <div className="space-y-2">
            <Label>{t('add.sportsLabel')}</Label>
            {loadingSports ? (
              <div className="flex items-center gap-2 py-4">
                <Loader2 className="size-4 animate-spin" />
                <span className="text-sm text-muted-foreground">{t('add.loadingSports')}</span>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2 p-3 border rounded-lg bg-muted/20">
                {sports.map(sport => {
                  const isSelected = selectedSports.includes(sport.id);
                  return (
                    <button
                      key={sport.id}
                      type="button"
                      onClick={() => toggleSport(sport.id)}
                      disabled={saving}
                      className="focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 rounded-full"
                    >
                      <Badge
                        variant={isSelected ? 'default' : 'outline'}
                        className={cn(
                          'px-3 py-1.5 text-sm font-medium transition-all cursor-pointer hover:scale-105',
                          isSelected
                            ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                            : 'hover:bg-accent hover:text-accent-foreground'
                        )}
                      >
                        {sport.name
                          .split(' ')
                          .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                          .join(' ')}
                      </Badge>
                    </button>
                  );
                })}
              </div>
            )}
            <p className="text-xs text-muted-foreground">{t('add.sportsHint')}</p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose} disabled={saving}>
              {t('add.cancel')}
            </Button>
            <Button type="submit" disabled={saving || !isValid}>
              {saving ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  {isEditMode ? t('edit.saving') : t('add.adding')}
                </>
              ) : (
                <>
                  {isEditMode ? <Save className="mr-2 size-4" /> : <Plus className="mr-2 size-4" />}
                  {isEditMode ? t('edit.saveButton') : t('add.addButton')}
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
