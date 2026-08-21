'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useOrganization } from '@/components/organization-context';
import { Link, useRouter } from '@/i18n/navigation';
import { BackButton } from '@/components/back-button';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { CalendarCheck, Loader2, Repeat } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface Facility {
  id: string;
  name: string;
}

interface Court {
  id: string;
  name: string | null;
  court_number: number | null;
  facility_id: string;
}

interface TimeSlot {
  start_time: string;
  end_time: string;
  price_cents: number;
}

export default function NewBookingPage() {
  const locale = useLocale();
  const t = useTranslations('bookings');
  const router = useRouter();
  const searchParams = useSearchParams();
  const { selectedOrganization, isLoading: orgLoading } = useOrganization();

  // Pre-filled values from calendar
  const prefilledCourtId = searchParams.get('courtId');
  const prefilledDate = searchParams.get('date');
  const prefilledStartTime = searchParams.get('startTime');

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [courts, setCourts] = useState<Court[]>([]);
  const [availableSlots, setAvailableSlots] = useState<TimeSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);

  // Form state
  const [selectedFacility, setSelectedFacility] = useState<string>('');
  const [selectedCourt, setSelectedCourt] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedSlot, setSelectedSlot] = useState<string>('');
  // Guest booking fields (staff booking for registered players not yet implemented)
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card'>('cash');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Track previous values to detect user-initiated changes vs. prefilled values
  const prevFacilityRef = useRef<string | null>(null);
  const prevCourtRef = useRef<string | null>(null);
  const prevDateRef = useRef<string | null>(null);

  // Recurring booking state
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurringPattern, setRecurringPattern] = useState<'weekly' | 'biweekly' | 'monthly'>(
    'weekly'
  );
  const [endType, setEndType] = useState<'occurrences' | 'date'>('occurrences');
  const [occurrenceCount, setOccurrenceCount] = useState(4);
  const [recurringEndDate, setRecurringEndDate] = useState('');

  const fetchInitialData = useCallback(async () => {
    if (!selectedOrganization) {
      return;
    }

    const supabase = createClient();

    // Fetch facilities
    const { data: facilitiesData } = await supabase
      .from('facility')
      .select('id, name')
      .eq('organization_id', selectedOrganization.id)
      .is('archived_at', null)
      .order('name');

    setFacilities(facilitiesData || []);

    // Fetch all courts for this org
    if (facilitiesData && facilitiesData.length > 0) {
      const facilityIds = facilitiesData.map(f => f.id);
      const { data: courtsData } = await supabase
        .from('court')
        .select('id, name, court_number, facility_id')
        .in('facility_id', facilityIds)
        .eq('is_active', true)
        .order('court_number');

      setCourts(courtsData || []);

      // Apply prefilled values if provided
      if (prefilledCourtId && courtsData) {
        const court = courtsData.find(c => c.id === prefilledCourtId);
        if (court) {
          setSelectedFacility(court.facility_id);
          setSelectedCourt(prefilledCourtId);
        }
      }
    }

    if (prefilledDate) {
      setSelectedDate(prefilledDate);
    }

    setLoading(false);
  }, [selectedOrganization, prefilledCourtId, prefilledDate]);

  const fetchAvailableSlots = useCallback(async () => {
    if (!selectedCourt || !selectedDate) {
      setAvailableSlots([]);
      return;
    }

    setSlotsLoading(true);
    const supabase = createClient();

    try {
      const { data: slots, error } = await supabase.rpc('get_available_slots', {
        p_court_id: selectedCourt,
        p_date: selectedDate,
      });

      if (error) {
        console.error('Error fetching slots:', error);
        setAvailableSlots([]);
      } else {
        const fetchedSlots = slots || [];
        setAvailableSlots(fetchedSlots);

        // Pre-select slot if startTime was provided from calendar
        if (prefilledStartTime && fetchedSlots.length > 0) {
          // Find the slot that matches the prefilled start time
          const matchingSlot = fetchedSlots.find(
            (slot: TimeSlot) =>
              slot.start_time === prefilledStartTime ||
              slot.start_time.startsWith(prefilledStartTime)
          );
          if (matchingSlot) {
            setSelectedSlot(`${matchingSlot.start_time}-${matchingSlot.end_time}`);
          }
        }
      }
    } catch (err) {
      console.error('Error:', err);
      setAvailableSlots([]);
    } finally {
      setSlotsLoading(false);
    }
  }, [selectedCourt, selectedDate, prefilledStartTime]);

  useEffect(() => {
    if (!orgLoading) {
      fetchInitialData();
    }
  }, [fetchInitialData, orgLoading]);

  useEffect(() => {
    fetchAvailableSlots();
  }, [fetchAvailableSlots]);

  // Reset court when facility changes (but not during initial load with prefilled values)
  useEffect(() => {
    // Only reset if facility changed from a non-empty previous value (user interaction)
    // Don't reset if previous was empty/null (initial load with prefilled values)
    if (prevFacilityRef.current && prevFacilityRef.current !== selectedFacility) {
      setSelectedCourt('');
      setSelectedSlot('');
    }
    prevFacilityRef.current = selectedFacility;
  }, [selectedFacility]);

  // Reset slot when court or date changes (but not during initial load with prefilled values)
  useEffect(() => {
    // Only reset if court/date changed from non-empty previous values (user interaction)
    const courtChanged = prevCourtRef.current && prevCourtRef.current !== selectedCourt;
    const dateChanged = prevDateRef.current && prevDateRef.current !== selectedDate;

    if (courtChanged || dateChanged) {
      setSelectedSlot('');
    }

    prevCourtRef.current = selectedCourt;
    prevDateRef.current = selectedDate;
  }, [selectedCourt, selectedDate]);

  const formatTime = (time: string): string => {
    const [hours, minutes] = time.split(':');
    const hour = parseInt(hours, 10);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour % 12 || 12;
    return `${hour12}:${minutes} ${ampm}`;
  };

  const formatPrice = (cents: number): string => {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD',
    }).format(cents / 100);
  };

  // Generate recurring dates
  const recurringDates = useMemo(() => {
    if (!isRecurring || !selectedDate) return [];

    const dates: string[] = [selectedDate];
    const startDate = new Date(selectedDate + 'T00:00:00');
    let count = 1;

    const maxDates = endType === 'occurrences' ? occurrenceCount : 52; // Max 1 year
    const endDateObj =
      endType === 'date' && recurringEndDate ? new Date(recurringEndDate + 'T00:00:00') : null;

    while (count < maxDates) {
      const nextDate = new Date(startDate);

      switch (recurringPattern) {
        case 'weekly':
          nextDate.setDate(startDate.getDate() + count * 7);
          break;
        case 'biweekly':
          nextDate.setDate(startDate.getDate() + count * 14);
          break;
        case 'monthly':
          nextDate.setMonth(startDate.getMonth() + count);
          break;
      }

      if (endDateObj && nextDate > endDateObj) break;

      const year = nextDate.getFullYear();
      const month = String(nextDate.getMonth() + 1).padStart(2, '0');
      const day = String(nextDate.getDate()).padStart(2, '0');
      dates.push(`${year}-${month}-${day}`);
      count++;
    }

    return dates;
  }, [isRecurring, selectedDate, recurringPattern, endType, occurrenceCount, recurringEndDate]);

  const formatDateDisplay = (dateStr: string): string => {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString(locale, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!selectedCourt || !selectedDate || !selectedSlot) {
      setError('Please select court, date, and time slot');
      return;
    }

    if (!guestName) {
      setError('Please enter guest name');
      return;
    }

    const [startTime, endTime] = selectedSlot.split('-');
    const datesToBook = isRecurring ? recurringDates : [selectedDate];

    setSubmitting(true);
    try {
      // Create bookings for all dates
      const results = await Promise.allSettled(
        datesToBook.map(bookingDate =>
          fetch('/api/bookings/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              courtId: selectedCourt,
              bookingDate,
              startTime,
              endTime,
              skipPayment: true, // Manual bookings are paid in person
              guestName,
              guestEmail: guestEmail || undefined,
              guestPhone: guestPhone || undefined,
              notes: notes || undefined,
            }),
          }).then(async res => {
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            return data;
          })
        )
      );

      const successCount = results.filter(r => r.status === 'fulfilled').length;
      const failCount = results.filter(r => r.status === 'rejected').length;

      if (failCount > 0 && successCount === 0) {
        throw new Error(`Failed to create bookings`);
      }

      if (failCount > 0) {
        setError(`${successCount} bookings created, ${failCount} failed`);
      }

      // Redirect to first successful booking or bookings list
      const firstSuccess = results.find(r => r.status === 'fulfilled') as
        | PromiseFulfilledResult<{ bookingId: string }>
        | undefined;
      if (firstSuccess) {
        router.push(
          isRecurring
            ? '/dashboard/bookings'
            : `/dashboard/bookings/${firstSuccess.value.bookingId}`
        );
      } else {
        router.push('/dashboard/bookings');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create booking');
    } finally {
      setSubmitting(false);
    }
  };

  const filteredCourts = selectedFacility
    ? courts.filter(c => c.facility_id === selectedFacility)
    : courts;

  // Format date in local timezone to avoid UTC conversion issues
  const today = (() => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  })();

  if (loading || orgLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full gap-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4">
        <BackButton className="p-2 hover:bg-muted rounded-md transition-colors" />
        <div>
          <h1 className="text-3xl font-bold mb-0">{t('manual.title')}</h1>
          <p className="text-muted-foreground">{t('manual.description')}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="space-y-6">
          {/* Court Selection */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarCheck className="size-5" />
                {t('manual.courtLabel')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Facility Filter */}
              <div className="space-y-2">
                <Label>{t('filters.allFacilities')}</Label>
                <Select value={selectedFacility} onValueChange={setSelectedFacility}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('filters.allFacilities')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('filters.allFacilities')}</SelectItem>
                    {facilities.map(facility => (
                      <SelectItem key={facility.id} value={facility.id}>
                        {facility.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Court Select */}
              <div className="space-y-2">
                <Label>{t('manual.courtLabel')} *</Label>
                <Select value={selectedCourt} onValueChange={setSelectedCourt}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('manual.courtPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredCourts.map(court => (
                      <SelectItem key={court.id} value={court.id}>
                        {court.name || `Court ${court.court_number}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Date */}
              <div className="space-y-2">
                <Label>{t('manual.dateLabel')} *</Label>
                <Input
                  type="date"
                  value={selectedDate}
                  onChange={e => setSelectedDate(e.target.value)}
                  min={today}
                />
              </div>

              {/* Time Slot */}
              <div className="space-y-2">
                <Label>{t('manual.timeLabel')} *</Label>
                {!selectedCourt && (
                  <p className="text-sm text-muted-foreground">{t('manual.selectCourtFirst')}</p>
                )}
                {selectedCourt && !selectedDate && (
                  <p className="text-sm text-muted-foreground">{t('manual.selectDateFirst')}</p>
                )}
                {selectedCourt && selectedDate && slotsLoading && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    <span className="text-sm">Loading slots...</span>
                  </div>
                )}
                {selectedCourt && selectedDate && !slotsLoading && availableSlots.length === 0 && (
                  <p className="text-sm text-muted-foreground">{t('manual.noSlotsAvailable')}</p>
                )}
                {selectedCourt && selectedDate && !slotsLoading && availableSlots.length > 0 && (
                  <Select value={selectedSlot} onValueChange={setSelectedSlot}>
                    <SelectTrigger>
                      <SelectValue placeholder={t('manual.timePlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {availableSlots.map(slot => (
                        <SelectItem
                          key={`${slot.start_time}-${slot.end_time}`}
                          value={`${slot.start_time}-${slot.end_time}`}
                        >
                          {formatTime(slot.start_time)} - {formatTime(slot.end_time)} (
                          {formatPrice(slot.price_cents)})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Guest Information */}
          <Card>
            <CardHeader>
              <CardTitle>{t('manual.playerLabel')}</CardTitle>
              <CardDescription>{t('manual.guestPlayer')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="guestName">{t('manual.guestNameLabel')} *</Label>
                <Input
                  id="guestName"
                  placeholder={t('manual.guestNamePlaceholder')}
                  value={guestName}
                  onChange={e => setGuestName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="guestEmail">{t('manual.guestEmailLabel')}</Label>
                <Input
                  id="guestEmail"
                  type="email"
                  placeholder={t('manual.guestEmailPlaceholder')}
                  value={guestEmail}
                  onChange={e => setGuestEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="guestPhone">{t('manual.guestPhoneLabel')}</Label>
                <Input
                  id="guestPhone"
                  type="tel"
                  placeholder={t('manual.guestPhonePlaceholder')}
                  value={guestPhone}
                  onChange={e => setGuestPhone(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          {/* Payment Method */}
          <Card>
            <CardHeader>
              <CardTitle>{t('manual.paymentMethod')}</CardTitle>
            </CardHeader>
            <CardContent>
              <RadioGroup
                value={paymentMethod}
                onValueChange={v => setPaymentMethod(v as 'cash' | 'card')}
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="cash" id="cash" />
                  <Label htmlFor="cash">{t('manual.paidInCash')}</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="card" id="card" />
                  <Label htmlFor="card">{t('manual.paidByCard')}</Label>
                </div>
              </RadioGroup>
            </CardContent>
          </Card>

          {/* Recurring Booking */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Repeat className="size-5" />
                {t('manual.recurring.title')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="recurring"
                  checked={isRecurring}
                  onCheckedChange={(checked: boolean | 'indeterminate') =>
                    setIsRecurring(checked === true)
                  }
                />
                <Label htmlFor="recurring" className="cursor-pointer">
                  {t('manual.recurring.enable')}
                </Label>
              </div>

              {isRecurring && (
                <div className="space-y-4 pt-2 border-t">
                  {/* Pattern */}
                  <div className="space-y-2">
                    <Label>{t('manual.recurring.pattern')}</Label>
                    <Select
                      value={recurringPattern}
                      onValueChange={v => setRecurringPattern(v as typeof recurringPattern)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="weekly">{t('manual.recurring.weekly')}</SelectItem>
                        <SelectItem value="biweekly">{t('manual.recurring.biweekly')}</SelectItem>
                        <SelectItem value="monthly">{t('manual.recurring.monthly')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* End Type */}
                  <div className="space-y-2">
                    <Label>{t('manual.recurring.endType')}</Label>
                    <RadioGroup
                      value={endType}
                      onValueChange={v => setEndType(v as typeof endType)}
                    >
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="occurrences" id="occurrences" />
                        <Label htmlFor="occurrences">
                          {t('manual.recurring.afterOccurrences')}
                        </Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="date" id="date" />
                        <Label htmlFor="date">{t('manual.recurring.onDate')}</Label>
                      </div>
                    </RadioGroup>
                  </div>

                  {endType === 'occurrences' ? (
                    <div className="space-y-2">
                      <Label>{t('manual.recurring.occurrences')}</Label>
                      <Input
                        type="number"
                        min={2}
                        max={52}
                        value={occurrenceCount}
                        onChange={e =>
                          setOccurrenceCount(
                            Math.min(52, Math.max(2, parseInt(e.target.value) || 2))
                          )
                        }
                      />
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Label>{t('manual.recurring.endDate')}</Label>
                      <Input
                        type="date"
                        value={recurringEndDate}
                        onChange={e => setRecurringEndDate(e.target.value)}
                        min={selectedDate || today}
                      />
                    </div>
                  )}

                  {/* Preview */}
                  {recurringDates.length > 0 && (
                    <div className="space-y-2 pt-2 border-t">
                      <Label>{t('manual.recurring.preview')}</Label>
                      <p className="text-sm text-muted-foreground">
                        {t('manual.recurring.previewDesc', { count: recurringDates.length })}
                      </p>
                      <div className="flex flex-wrap gap-2 max-h-[150px] overflow-y-auto">
                        {recurringDates.map((date, idx) => (
                          <Badge
                            key={date}
                            variant="outline"
                            className={cn(idx === 0 && 'border-primary')}
                          >
                            {formatDateDisplay(date)}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Notes */}
          <Card>
            <CardHeader>
              <CardTitle>{t('manual.notesLabel')}</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                placeholder={t('manual.notesPlaceholder')}
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={3}
              />
            </CardContent>
          </Card>

          {/* Error */}
          {error && (
            <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-md text-sm">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-4">
            <Button type="button" variant="outline" asChild>
              <Link href="/dashboard/bookings">{t('manual.cancelButton')}</Link>
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="mr-2 size-4 animate-spin" />}
              {submitting ? t('manual.creating') : t('manual.createButton')}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
