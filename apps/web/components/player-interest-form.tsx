'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';

// ============================================
// Types
// ============================================

interface RatingScore {
  id: string;
  score_value: number;
  display_label: string;
  description: string;
  skill_level: string | null;
}

interface FacilityResult {
  id: string;
  name: string;
  city: string | null;
  address: string | null;
}

interface AvailabilitySlot {
  day: string;
  period: string;
}

const DAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;
const PERIODS = ['morning', 'afternoon', 'evening'] as const;
const POSTAL_CODE_REGEX = /^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/;

// ============================================
// Sub-components
// ============================================

function RatingGrid({
  ratings,
  selectedId,
  onSelect,
  isLoading,
}: {
  ratings: RatingScore[];
  selectedId: string;
  onSelect: (id: string) => void;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="size-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      {ratings.map(rating => {
        const isSelected = selectedId === rating.id;
        return (
          <button
            key={rating.id}
            type="button"
            onClick={() => onSelect(rating.id)}
            className={cn(
              'rounded-xl border-2 p-3 text-left transition-all',
              isSelected
                ? 'border-[var(--primary-500)] bg-[var(--primary-50)] dark:bg-[var(--primary-500)]/15'
                : 'border-border bg-background hover:border-muted-foreground/50'
            )}
          >
            <p
              className={cn(
                'text-sm font-semibold',
                isSelected ? 'text-[var(--primary-700)] dark:text-[var(--primary-500)]' : ''
              )}
            >
              {rating.display_label}
            </p>
            <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{rating.description}</p>
          </button>
        );
      })}
    </div>
  );
}

function FacilityCombobox({
  sport,
  value,
  facilityId,
  onChange,
  placeholder,
}: {
  sport: string;
  value: string;
  facilityId: string;
  onChange: (value: string, facilityId: string) => void;
  placeholder: string;
}) {
  const t = useTranslations('playerInterest.form');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<FacilityResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const search = useCallback(
    (query: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (query.length < 2) {
        setResults([]);
        return;
      }
      setIsSearching(true);
      debounceRef.current = setTimeout(async () => {
        try {
          const res = await fetch(
            `/api/public/facilities/search?query=${encodeURIComponent(query)}&sport=${sport}`
          );
          if (res.ok) {
            const data = await res.json();
            setResults(data.facilities);
          }
        } catch {
          // silently fail search
        } finally {
          setIsSearching(false);
        }
      }, 300);
    },
    [sport]
  );

  const handleInputChange = (inputValue: string) => {
    onChange(inputValue, '');
    search(inputValue);
    if (inputValue.length >= 2) {
      setOpen(true);
    }
  };

  const handleSelect = (facility: FacilityResult) => {
    onChange(facility.name, facility.id);
    setOpen(false);
    setResults([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' || e.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Input
            ref={inputRef}
            type="text"
            value={value}
            onChange={e => handleInputChange(e.target.value)}
            onFocus={() => {
              if (value.length >= 2 && !facilityId) setOpen(true);
            }}
            onBlur={() => {
              // Delay close to allow click on result
              setTimeout(() => setOpen(false), 200);
            }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
          />
        </PopoverTrigger>
        {open && (
          <PopoverContent
            className="w-[var(--radix-popover-trigger-width)] p-0"
            align="start"
            sideOffset={4}
            onOpenAutoFocus={e => e.preventDefault()}
          >
            <div className="max-h-48 overflow-y-auto">
              {isSearching && (
                <div className="flex items-center justify-center py-3">
                  <div className="size-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                </div>
              )}
              {!isSearching && results.length === 0 && value.length >= 2 && (
                <p className="px-3 py-2 text-xs text-muted-foreground">{t('facilityNoResults')}</p>
              )}
              {results.map(facility => (
                <button
                  key={facility.id}
                  type="button"
                  className="w-full px-3 py-2 text-left text-sm hover:bg-muted transition-colors"
                  onMouseDown={e => {
                    e.preventDefault();
                    handleSelect(facility);
                  }}
                >
                  <span className="font-medium">{facility.name}</span>
                  {facility.city && (
                    <span className="text-muted-foreground"> — {facility.city}</span>
                  )}
                </button>
              ))}
            </div>
          </PopoverContent>
        )}
      </Popover>
      {!facilityId && value.length >= 2 && (
        <p className="mt-1 text-xs text-muted-foreground">{t('facilityCustomHint')}</p>
      )}
    </div>
  );
}

function AvailabilityGrid({
  selectedSlots,
  onToggle,
}: {
  selectedSlots: AvailabilitySlot[];
  onToggle: (day: string, period: string) => void;
}) {
  const t = useTranslations('playerInterest.form');

  const isSelected = (day: string, period: string) =>
    selectedSlots.some(s => s.day === day && s.period === period);

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto -mx-2 px-2">
        <table className="w-full border-collapse min-w-[320px]">
          <thead>
            <tr>
              <th className="w-14 sm:w-16" />
              {DAYS.map(day => (
                <th key={day} className="px-0.5 py-1.5 sm:py-2 text-center">
                  <span className="block text-[10px] sm:text-xs font-medium">
                    {t(`days.${day}`)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERIODS.map(period => (
              <tr key={period}>
                <td className="py-0.5 sm:py-1 pr-1 sm:pr-2 text-right text-[10px] sm:text-xs font-medium whitespace-nowrap">
                  {t(`periods.${period}`)}
                </td>
                {DAYS.map(day => {
                  const selected = isSelected(day, period);
                  return (
                    <td key={day} className="px-0.5 py-0.5 sm:py-1 text-center">
                      <button
                        type="button"
                        onClick={() => onToggle(day, period)}
                        className={cn(
                          'size-7 sm:size-8 rounded-lg transition-all',
                          selected
                            ? 'bg-[var(--primary-500)] hover:bg-[var(--primary-600)] shadow-sm'
                            : 'bg-muted hover:bg-muted-foreground/20'
                        )}
                        aria-label={`${t(`days.${day}`)} ${t(`periods.${period}`)}`}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p
        className={cn(
          'text-xs text-right',
          selectedSlots.length >= 3
            ? 'text-[var(--primary-600)] dark:text-[var(--primary-500)]'
            : 'text-muted-foreground'
        )}
      >
        {t('availabilityCount', { count: selectedSlots.length })}
      </p>
    </div>
  );
}

// ============================================
// Main Form
// ============================================

export function PlayerInterestForm() {
  const t = useTranslations('playerInterest.form');
  const tv = useTranslations('playerInterest.validation');
  const ts = useTranslations('playerInterest.success');
  const te = useTranslations('playerInterest.error');
  const ta = useTranslations('playerInterest.alreadySubmitted');

  // Personal info
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [postalCode, setPostalCode] = useState('');

  // Tennis
  const [playsTennis, setPlaysTennis] = useState(false);
  const [tennisRatings, setTennisRatings] = useState<RatingScore[]>([]);
  const [tennisRatingId, setTennisRatingId] = useState('');
  const [tennisFacilityName, setTennisFacilityName] = useState('');
  const [tennisFacilityId, setTennisFacilityId] = useState('');
  const [tennisRatingsLoading, setTennisRatingsLoading] = useState(false);

  // Pickleball
  const [playsPickleball, setPlaysPickleball] = useState(false);
  const [pickleballRatings, setPickleballRatings] = useState<RatingScore[]>([]);
  const [pickleballRatingId, setPickleballRatingId] = useState('');
  const [pickleballFacilityName, setPickleballFacilityName] = useState('');
  const [pickleballFacilityId, setPickleballFacilityId] = useState('');
  const [pickleballRatingsLoading, setPickleballRatingsLoading] = useState(false);

  // Availability
  const [availabilitySlots, setAvailabilitySlots] = useState<AvailabilitySlot[]>([]);

  // Form state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error' | 'duplicate'>(
    'idle'
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  // Fetch ratings when sport is toggled on
  useEffect(() => {
    if (playsTennis && tennisRatings.length === 0) {
      setTennisRatingsLoading(true);
      fetch('/api/public/ratings?sport=tennis&system=ntrp')
        .then(res => res.json())
        .then(data => setTennisRatings(data.ratings ?? []))
        .catch(() => {})
        .finally(() => setTennisRatingsLoading(false));
    }
  }, [playsTennis, tennisRatings.length]);

  useEffect(() => {
    if (playsPickleball && pickleballRatings.length === 0) {
      setPickleballRatingsLoading(true);
      fetch('/api/public/ratings?sport=pickleball&system=dupr')
        .then(res => res.json())
        .then(data => setPickleballRatings(data.ratings ?? []))
        .catch(() => {})
        .finally(() => setPickleballRatingsLoading(false));
    }
  }, [playsPickleball, pickleballRatings.length]);

  const handleAvailabilityToggle = (day: string, period: string) => {
    setAvailabilitySlots(prev => {
      const exists = prev.some(s => s.day === day && s.period === period);
      if (exists) {
        return prev.filter(s => !(s.day === day && s.period === period));
      }
      return [...prev, { day, period }];
    });
    setValidationError(null);
  };

  const validateForm = (): boolean => {
    if (!playsTennis && !playsPickleball) {
      setValidationError(tv('atLeastOneSport'));
      return false;
    }
    if (playsTennis && !tennisRatingId) {
      setValidationError(tv('tennisRatingRequired'));
      return false;
    }
    if (playsTennis && !tennisFacilityId && !tennisFacilityName.trim()) {
      setValidationError(tv('tennisFacilityRequired'));
      return false;
    }
    if (playsPickleball && !pickleballRatingId) {
      setValidationError(tv('pickleballRatingRequired'));
      return false;
    }
    if (playsPickleball && !pickleballFacilityId && !pickleballFacilityName.trim()) {
      setValidationError(tv('pickleballFacilityRequired'));
      return false;
    }
    if (!POSTAL_CODE_REGEX.test(postalCode.trim())) {
      setValidationError(tv('postalCodeInvalid'));
      return false;
    }
    if (availabilitySlots.length < 3) {
      setValidationError(tv('availabilityMinimum'));
      return false;
    }
    setValidationError(null);
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    setIsSubmitting(true);
    setSubmitStatus('idle');

    try {
      // Capture IP / location
      const ipResponse = await fetch('/api/get-location');
      let locationData = null;
      if (ipResponse.ok) {
        locationData = await ipResponse.json();
      }

      const formData = {
        firstName,
        lastName,
        email,
        postalCode: postalCode.trim().toUpperCase(),
        playsTennis,
        tennisRatingScoreId: playsTennis ? tennisRatingId : null,
        favoriteTennisFacilityId: playsTennis && tennisFacilityId ? tennisFacilityId : null,
        favoriteTennisFacilityCustom:
          playsTennis && !tennisFacilityId ? tennisFacilityName.trim() : null,
        playsPickleball,
        pickleballRatingScoreId: playsPickleball ? pickleballRatingId : null,
        favoritePickleballFacilityId:
          playsPickleball && pickleballFacilityId ? pickleballFacilityId : null,
        favoritePickleballFacilityCustom:
          playsPickleball && !pickleballFacilityId ? pickleballFacilityName.trim() : null,
        weeklyAvailability: availabilitySlots,
        ipAddress: locationData?.ipAddress || 'unknown',
        location: locationData?.location || 'unknown',
      };

      const response = await fetch('/api/submit-player-interest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (response.status === 409) {
        setSubmitStatus('duplicate');
        return;
      }

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Submission failed');
      }

      setSubmitStatus('success');
    } catch (error) {
      console.error('Submission error:', error);
      setSubmitStatus('error');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (submitStatus === 'success' || submitStatus === 'duplicate') {
    const message = submitStatus === 'success' ? ts('message') : ta('message');
    return (
      <div className="animated-border w-full max-w-lg">
        <Card className="w-full border-0 bg-card">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="size-16 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center">
                <svg
                  className="size-8 text-green-600 dark:text-green-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <p className="text-lg font-semibold">{message}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="animated-border w-full max-w-2xl">
      <Card className="w-full border-0 bg-card">
        <CardContent className="p-4 sm:pt-6 sm:px-6">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4 sm:gap-5">
            {/* Name */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="firstName">{t('firstNameLabel')}</Label>
                <Input
                  id="firstName"
                  type="text"
                  placeholder={t('firstNamePlaceholder')}
                  value={firstName}
                  onChange={e => setFirstName(e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lastName">{t('lastNameLabel')}</Label>
                <Input
                  id="lastName"
                  type="text"
                  placeholder={t('lastNamePlaceholder')}
                  value={lastName}
                  onChange={e => setLastName(e.target.value)}
                  required
                />
              </div>
            </div>

            {/* Email & Postal Code */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">{t('emailLabel')}</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder={t('emailPlaceholder')}
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="postalCode">{t('postalCodeLabel')}</Label>
                <Input
                  id="postalCode"
                  type="text"
                  placeholder={t('postalCodePlaceholder')}
                  value={postalCode}
                  onChange={e => setPostalCode(e.target.value)}
                  required
                  maxLength={7}
                />
              </div>
            </div>

            <Separator />

            {/* Sports Section */}
            <div className="flex flex-col gap-4">
              {/* Tennis */}
              <div className="flex flex-col gap-3 p-3 sm:p-4 rounded-lg bg-muted/50">
                <div className="flex items-center justify-between">
                  <Label htmlFor="playsTennis" className="cursor-pointer">
                    {t('playsTennisLabel')}
                  </Label>
                  <Switch
                    id="playsTennis"
                    checked={playsTennis}
                    onCheckedChange={checked => {
                      setPlaysTennis(checked);
                      if (!checked) {
                        setTennisRatingId('');
                        setTennisFacilityName('');
                        setTennisFacilityId('');
                      }
                      setValidationError(null);
                    }}
                  />
                </div>
                {playsTennis && (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <Label className="text-sm">{t('ntrpRatingLabel')}</Label>
                      <RatingGrid
                        ratings={tennisRatings}
                        selectedId={tennisRatingId}
                        onSelect={id => {
                          setTennisRatingId(id);
                          setValidationError(null);
                        }}
                        isLoading={tennisRatingsLoading}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label className="text-sm">{t('favoriteTennisFacilityLabel')}</Label>
                      <FacilityCombobox
                        sport="tennis"
                        value={tennisFacilityName}
                        facilityId={tennisFacilityId}
                        onChange={(name, id) => {
                          setTennisFacilityName(name);
                          setTennisFacilityId(id);
                          setValidationError(null);
                        }}
                        placeholder={t('favoriteTennisFacilityPlaceholder')}
                      />
                    </div>
                  </>
                )}
              </div>

              {/* Pickleball */}
              <div className="flex flex-col gap-3 p-3 sm:p-4 rounded-lg bg-muted/50">
                <div className="flex items-center justify-between">
                  <Label htmlFor="playsPickleball" className="cursor-pointer">
                    {t('playsPickleballLabel')}
                  </Label>
                  <Switch
                    id="playsPickleball"
                    checked={playsPickleball}
                    onCheckedChange={checked => {
                      setPlaysPickleball(checked);
                      if (!checked) {
                        setPickleballRatingId('');
                        setPickleballFacilityName('');
                        setPickleballFacilityId('');
                      }
                      setValidationError(null);
                    }}
                  />
                </div>
                {playsPickleball && (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <Label className="text-sm">{t('duprRatingLabel')}</Label>
                      <RatingGrid
                        ratings={pickleballRatings}
                        selectedId={pickleballRatingId}
                        onSelect={id => {
                          setPickleballRatingId(id);
                          setValidationError(null);
                        }}
                        isLoading={pickleballRatingsLoading}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label className="text-sm">{t('favoritePickleballFacilityLabel')}</Label>
                      <FacilityCombobox
                        sport="pickleball"
                        value={pickleballFacilityName}
                        facilityId={pickleballFacilityId}
                        onChange={(name, id) => {
                          setPickleballFacilityName(name);
                          setPickleballFacilityId(id);
                          setValidationError(null);
                        }}
                        placeholder={t('favoritePickleballFacilityPlaceholder')}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>

            <Separator />

            {/* Weekly Availability */}
            <div className="flex flex-col gap-2">
              <div>
                <Label className="text-sm sm:text-base font-semibold">
                  {t('availabilityTitle')}
                </Label>
                <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                  {t('availabilityDescription')}
                </p>
              </div>
              <AvailabilityGrid
                selectedSlots={availabilitySlots}
                onToggle={handleAvailabilityToggle}
              />
            </div>

            {/* Validation Error */}
            {validationError && (
              <p className="text-sm text-red-500 dark:text-red-400">{validationError}</p>
            )}

            {/* Submit Error */}
            {submitStatus === 'error' && (
              <p className="text-sm text-red-500 dark:text-red-400">{te('message')}</p>
            )}

            {/* Submit Button */}
            <Button
              type="submit"
              size="lg"
              disabled={isSubmitting}
              className="button-scale w-full bg-[var(--secondary-500)] hover:bg-[var(--secondary-600)] dark:bg-[var(--secondary-500)] dark:hover:bg-[var(--secondary-600)]"
            >
              {isSubmitting ? t('submitting') : t('submitButton')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
