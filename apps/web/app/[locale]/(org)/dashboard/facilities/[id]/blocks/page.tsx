'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Link, useRouter } from '@/i18n/navigation';
import { BackButton } from '@/components/back-button';
import { createClient } from '@/lib/supabase/client';
import { AlertTriangle, Calendar, CalendarX, Loader2, Plus, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

type BlockType = 'manual' | 'maintenance' | 'holiday' | 'weather' | 'private_event';

interface Court {
  id: string;
  name: string | null;
  court_number: number | null;
}

interface Block {
  id: string;
  court_id: string | null;
  facility_id: string;
  block_date: string;
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
  block_type: BlockType;
  created_at: string | null;
  court?: Court | null;
}

interface ConflictingBooking {
  id: string;
  booking_date: string;
  start_time: string;
  end_time: string;
  status: string;
  court_name: string | null;
  court_number: number | null;
  player_name: string | null;
}

interface OverlappingBlock {
  id: string;
  block_date: string;
  start_time: string | null;
  end_time: string | null;
  block_type: string;
  reason: string | null;
  court_name: string | null;
  court_number: number | null;
}

const BLOCK_TYPES: BlockType[] = ['manual', 'maintenance', 'holiday', 'weather', 'private_event'];

export default function BlockManagementPage() {
  const locale = useLocale();
  const t = useTranslations('blocks');
  const params = useParams();
  const router = useRouter();
  const facilityId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflictingBookings, setConflictingBookings] = useState<ConflictingBooking[]>([]);
  const [overlappingBlocks, setOverlappingBlocks] = useState<OverlappingBlock[]>([]);
  const [facilityName, setFacilityName] = useState('');
  const [courts, setCourts] = useState<Court[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [courtId, setCourtId] = useState<string>('all');
  const [blockDate, setBlockDate] = useState('');
  const [allDay, setAllDay] = useState(true);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [blockType, setBlockType] = useState<BlockType>('manual');
  const [reason, setReason] = useState('');

  const fetchData = useCallback(async () => {
    const supabase = createClient();

    // Fetch facility info
    const { data: facility, error: facilityError } = await supabase
      .from('facility')
      .select('name')
      .eq('id', facilityId)
      .single();

    if (facilityError) {
      setError('Facility not found');
      setLoading(false);
      return;
    }

    setFacilityName(facility.name);

    // Fetch courts
    const { data: courtsData } = await supabase
      .from('court')
      .select('id, name, court_number')
      .eq('facility_id', facilityId)
      .order('court_number');

    setCourts(courtsData || []);

    // Fetch existing blocks
    const { data: blocksData, error: blocksError } = await supabase
      .from('availability_block')
      .select(
        `
        id,
        court_id,
        facility_id,
        block_date,
        start_time,
        end_time,
        reason,
        block_type,
        created_at,
        court:court_id (id, name, court_number)
      `
      )
      .eq('facility_id', facilityId)
      .order('block_date', { ascending: false })
      .order('start_time');

    if (blocksError) {
      console.error('Error fetching blocks:', blocksError);
      setError('Failed to load blocks');
      setLoading(false);
      return;
    }

    setBlocks(blocksData || []);
    setLoading(false);
  }, [facilityId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const resetForm = () => {
    setCourtId('all');
    setBlockDate('');
    setAllDay(true);
    setStartTime('09:00');
    setEndTime('17:00');
    setBlockType('manual');
    setReason('');
    setShowForm(false);
    setError(null);
    setConflictingBookings([]);
    setOverlappingBlocks([]);
  };

  const handleCreate = async () => {
    if (!blockDate) {
      setError(t('form.dateRequired'));
      return;
    }

    setSaving(true);
    setError(null);
    setConflictingBookings([]);
    setOverlappingBlocks([]);

    try {
      const response = await fetch(`/api/facilities/${facilityId}/blocks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          court_id: courtId === 'all' ? null : courtId,
          block_date: blockDate,
          start_time: allDay ? null : startTime + ':00',
          end_time: allDay ? null : endTime + ':00',
          block_type: blockType,
          reason: reason || null,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        // Handle overlapping blocks error
        if (data.code === 'BLOCK_OVERLAP' && data.overlappingBlocks) {
          setOverlappingBlocks(data.overlappingBlocks);
          setError(t('form.overlapError'));
          return;
        }
        // Handle booking conflict error
        if (data.code === 'BOOKING_CONFLICT' && data.conflicts) {
          setConflictingBookings(data.conflicts);
          setError(t('form.conflictError'));
          return;
        }
        throw new Error(data.error || 'Failed to create block');
      }

      resetForm();
      await fetchData();
      router.refresh();
    } catch (err) {
      console.error('Error creating block:', err);
      setError(err instanceof Error ? err.message : t('form.error'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (blockId: string) => {
    setDeleting(blockId);

    try {
      const response = await fetch(`/api/facilities/${facilityId}/blocks?blockId=${blockId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete block');
      }

      await fetchData();
      router.refresh();
    } catch (err) {
      console.error('Error deleting block:', err);
      setError(err instanceof Error ? err.message : t('form.deleteError'));
    } finally {
      setDeleting(null);
    }
  };

  const formatBookingTime = (start: string, end: string) => {
    return `${start.substring(0, 5)} - ${end.substring(0, 5)}`;
  };

  const getBookingCourtDisplay = (booking: ConflictingBooking) => {
    if (booking.court_name) return booking.court_name;
    if (booking.court_number) return `Court ${booking.court_number}`;
    return t('list.unknownCourt');
  };

  const getCourtName = (court: Court | null | undefined) => {
    if (!court) return t('list.allCourts');
    return court.name || `Court ${court.court_number}`;
  };

  const formatTime = (start: string | null, end: string | null) => {
    if (!start || !end) return t('list.allDay');
    return `${start.substring(0, 5)} - ${end.substring(0, 5)}`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full gap-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-4">
          <BackButton className="p-2 hover:bg-muted rounded-md transition-colors mt-1" />
          <div>
            <h1 className="text-3xl font-bold mb-0">{t('title')}</h1>
            <p className="text-muted-foreground">{facilityName}</p>
          </div>
        </div>
        <Button onClick={() => setShowForm(true)}>
          <Plus className="mr-2 size-4" />
          {t('addBlock')}
        </Button>
      </div>

      {/* Create Block Modal */}
      <Dialog open={showForm} onOpenChange={open => !open && resetForm()}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('form.title')}</DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Court Selection */}
              <div className="space-y-2">
                <label className="text-sm font-medium">{t('form.courtLabel')}</label>
                <Select value={courtId} onValueChange={setCourtId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('form.courtPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('form.allCourtsOption')}</SelectItem>
                    {courts.map(court => (
                      <SelectItem key={court.id} value={court.id}>
                        {court.name || `Court ${court.court_number}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Block Type */}
              <div className="space-y-2">
                <label className="text-sm font-medium">{t('form.typeLabel')}</label>
                <Select value={blockType} onValueChange={v => setBlockType(v as BlockType)}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('form.typePlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {BLOCK_TYPES.map(type => (
                      <SelectItem key={type} value={type}>
                        {t(`types.${type}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Date */}
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('form.dateLabel')}</label>
              <Input
                type="date"
                value={blockDate}
                onChange={e => setBlockDate(e.target.value)}
                min={(() => {
                  const d = new Date();
                  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                })()}
              />
            </div>

            {/* All Day Toggle */}
            <div className="flex items-center gap-3">
              <Switch checked={allDay} onCheckedChange={setAllDay} />
              <div>
                <label className="text-sm font-medium cursor-pointer">
                  {t('form.allDayLabel')}
                </label>
                <p className="text-sm text-muted-foreground">{t('form.allDayHint')}</p>
              </div>
            </div>

            {/* Time Range (when not all day) */}
            {!allDay && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t('form.startTimeLabel')}</label>
                  <Input
                    type="time"
                    value={startTime}
                    onChange={e => setStartTime(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t('form.endTimeLabel')}</label>
                  <Input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} />
                </div>
              </div>
            )}

            {/* Reason */}
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('form.reasonLabel')}</label>
              <Input
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder={t('form.reasonPlaceholder')}
              />
            </div>

            {/* Overlapping Blocks Alert */}
            {overlappingBlocks.length > 0 && (
              <Alert variant="destructive">
                <CalendarX className="size-4" />
                <AlertTitle>{t('form.overlapTitle')}</AlertTitle>
                <AlertDescription>
                  <p className="mb-3">{t('form.overlapDescription')}</p>
                  <div className="space-y-2">
                    {overlappingBlocks.map(block => (
                      <div
                        key={block.id}
                        className="flex items-center justify-between p-2 bg-destructive/10 rounded-md"
                      >
                        <div className="flex-1">
                          <div className="text-sm font-medium">
                            {block.court_name ||
                              (block.court_number
                                ? `Court ${block.court_number}`
                                : t('list.allCourts'))}{' '}
                            •{' '}
                            {block.start_time && block.end_time
                              ? formatBookingTime(block.start_time, block.end_time)
                              : t('list.allDay')}
                          </div>
                          <div className="text-xs text-muted-foreground flex items-center gap-1">
                            <Badge variant="outline" className="text-xs">
                              {t(`types.${block.block_type}`)}
                            </Badge>
                            {block.reason && <span>• {block.reason}</span>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs mt-3 text-muted-foreground">{t('form.overlapHint')}</p>
                </AlertDescription>
              </Alert>
            )}

            {/* Conflicting Bookings Alert */}
            {conflictingBookings.length > 0 && (
              <Alert variant="destructive">
                <CalendarX className="size-4" />
                <AlertTitle>{t('form.conflictTitle')}</AlertTitle>
                <AlertDescription>
                  <p className="mb-3">{t('form.conflictDescription')}</p>
                  <div className="space-y-2">
                    {conflictingBookings.map(booking => (
                      <div
                        key={booking.id}
                        className="flex items-center justify-between p-2 bg-destructive/10 rounded-md"
                      >
                        <div className="flex-1">
                          <div className="text-sm font-medium">
                            {getBookingCourtDisplay(booking)} •{' '}
                            {formatBookingTime(booking.start_time, booking.end_time)}
                          </div>
                          <div className="text-xs text-muted-foreground flex items-center gap-1">
                            {booking.player_name || t('form.unknownPlayer')} •{' '}
                            <Badge variant="outline" className="text-xs">
                              {booking.status}
                            </Badge>
                          </div>
                        </div>
                        <Link
                          href={`/dashboard/bookings/${booking.id}`}
                          className="text-xs text-primary hover:underline ml-2"
                        >
                          {t('form.viewBooking')}
                        </Link>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs mt-3 text-muted-foreground">{t('form.conflictHint')}</p>
                </AlertDescription>
              </Alert>
            )}

            {error && !conflictingBookings.length && !overlappingBlocks.length && (
              <p className="text-sm text-red-500">{error}</p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={resetForm}>
              {t('form.cancelButton')}
            </Button>
            <Button onClick={handleCreate} disabled={saving || !blockDate}>
              {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
              {saving ? t('form.creating') : t('form.createButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Blocks List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="size-5" />
            {t('title')}
          </CardTitle>
          <CardDescription>
            {blocks.length} {blocks.length === 1 ? 'block' : 'blocks'} configured
          </CardDescription>
        </CardHeader>
        <CardContent>
          {blocks.length === 0 ? (
            <div className="text-center py-12">
              <div className="p-4 bg-muted rounded-full inline-block mb-4">
                <AlertTriangle className="size-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold mb-2">{t('emptyState.title')}</h3>
              <p className="text-muted-foreground mb-6">{t('emptyState.description')}</p>
              <Button onClick={() => setShowForm(true)}>
                <Plus className="mr-2 size-4" />
                {t('emptyState.addButton')}
              </Button>
            </div>
          ) : (
            <div className="divide-y">
              {blocks.map(block => (
                <div key={block.id} className="flex items-center justify-between py-4">
                  <div className="flex items-center gap-4">
                    <div className="p-2 bg-muted rounded-md">
                      <Calendar className="size-4 text-muted-foreground" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium mb-0">
                          {new Date(block.block_date + 'T00:00:00').toLocaleDateString(locale, {
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </p>
                        <Badge variant="outline">{t(`types.${block.block_type}`)}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mb-0">
                        {getCourtName(block.court)} • {formatTime(block.start_time, block.end_time)}
                        {block.reason && ` • ${block.reason}`}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(block.id)}
                    disabled={deleting === block.id}
                    className="text-destructive hover:text-destructive"
                  >
                    {deleting === block.id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Trash2 className="size-4" />
                    )}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
