'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

type SkillLevel = 'beginner' | 'intermediate' | 'advanced' | 'elite';

export function BetaSignupForm() {
  const t = useTranslations('beta.form');
  const tv = useTranslations('beta.validation');
  const ts = useTranslations('beta.success');
  const te = useTranslations('beta.error');

  const [fullName, setFullName] = useState('');
  const [city, setCity] = useState('');
  const [playsTennis, setPlaysTennis] = useState(false);
  const [tennisLevel, setTennisLevel] = useState<SkillLevel | ''>('');
  const [playsPickleball, setPlaysPickleball] = useState(false);
  const [pickleballLevel, setPickleballLevel] = useState<SkillLevel | ''>('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [validationError, setValidationError] = useState<string | null>(null);

  const validateForm = (): boolean => {
    if (!playsTennis && !playsPickleball) {
      setValidationError(tv('atLeastOneSport'));
      return false;
    }
    if (playsTennis && !tennisLevel) {
      setValidationError(tv('tennisLevelRequired'));
      return false;
    }
    if (playsPickleball && !pickleballLevel) {
      setValidationError(tv('pickleballLevelRequired'));
      return false;
    }
    setValidationError(null);
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);
    setSubmitStatus('idle');

    try {
      // Capture IP address and location
      const ipResponse = await fetch('/api/get-location');
      let locationData = null;

      if (ipResponse.ok) {
        locationData = await ipResponse.json();
      }

      const formData = {
        fullName,
        city,
        playsTennis,
        tennisLevel: playsTennis ? tennisLevel : null,
        playsPickleball,
        pickleballLevel: playsPickleball ? pickleballLevel : null,
        email,
        phone: phone || undefined,
        ipAddress: locationData?.ipAddress || 'unknown',
        location: locationData?.location || 'unknown',
      };

      const response = await fetch('/api/submit-beta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Submission failed');
      }

      setSubmitStatus('success');
      setFullName('');
      setCity('');
      setPlaysTennis(false);
      setTennisLevel('');
      setPlaysPickleball(false);
      setPickleballLevel('');
      setEmail('');
      setPhone('');
    } catch (error) {
      console.error('Submission error:', error);
      setSubmitStatus('error');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (submitStatus === 'success') {
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
              <p className="text-lg font-semibold">{ts('message')}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const skillLevels: SkillLevel[] = ['beginner', 'intermediate', 'advanced', 'elite'];

  return (
    <div className="animated-border w-full max-w-lg">
      <Card className="w-full border-0 bg-card">
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            {/* Full Name */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="fullName">{t('fullNameLabel')}</Label>
              <Input
                id="fullName"
                name="fullName"
                type="text"
                placeholder={t('fullNamePlaceholder')}
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                required
              />
            </div>

            {/* City */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="city">{t('cityLabel')}</Label>
              <Input
                id="city"
                name="city"
                type="text"
                placeholder={t('cityPlaceholder')}
                value={city}
                onChange={e => setCity(e.target.value)}
                required
              />
            </div>

            {/* Sports Section - Two columns on md+ */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Tennis Section */}
              <div className="flex flex-col gap-3 p-4 rounded-lg bg-muted/50">
                <div className="flex items-center justify-between">
                  <Label htmlFor="playsTennis" className="cursor-pointer">
                    {t('playsTennisLabel')}
                  </Label>
                  <Switch
                    id="playsTennis"
                    checked={playsTennis}
                    onCheckedChange={checked => {
                      setPlaysTennis(checked);
                      if (!checked) setTennisLevel('');
                      setValidationError(null);
                    }}
                  />
                </div>
                {playsTennis && (
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="tennisLevel">{t('tennisLevelLabel')}</Label>
                    <Select
                      value={tennisLevel}
                      onValueChange={(value: SkillLevel) => {
                        setTennisLevel(value);
                        setValidationError(null);
                      }}
                    >
                      <SelectTrigger id="tennisLevel">
                        <SelectValue placeholder={t('selectLevel')} />
                      </SelectTrigger>
                      <SelectContent>
                        {skillLevels.map(level => (
                          <SelectItem key={level} value={level}>
                            {t(`levels.${level}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              {/* Pickleball Section */}
              <div className="flex flex-col gap-3 p-4 rounded-lg bg-muted/50">
                <div className="flex items-center justify-between">
                  <Label htmlFor="playsPickleball" className="cursor-pointer">
                    {t('playsPickleballLabel')}
                  </Label>
                  <Switch
                    id="playsPickleball"
                    checked={playsPickleball}
                    onCheckedChange={checked => {
                      setPlaysPickleball(checked);
                      if (!checked) setPickleballLevel('');
                      setValidationError(null);
                    }}
                  />
                </div>
                {playsPickleball && (
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="pickleballLevel">{t('pickleballLevelLabel')}</Label>
                    <Select
                      value={pickleballLevel}
                      onValueChange={(value: SkillLevel) => {
                        setPickleballLevel(value);
                        setValidationError(null);
                      }}
                    >
                      <SelectTrigger id="pickleballLevel">
                        <SelectValue placeholder={t('selectLevel')} />
                      </SelectTrigger>
                      <SelectContent>
                        {skillLevels.map(level => (
                          <SelectItem key={level} value={level}>
                            {t(`levels.${level}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </div>

            {/* Validation Error */}
            {validationError && (
              <p className="text-sm text-red-500 dark:text-red-400">{validationError}</p>
            )}

            {/* Email */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">{t('emailLabel')}</Label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder={t('emailPlaceholder')}
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
            </div>

            {/* Phone */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="phone">{t('phoneLabel')}</Label>
              <Input
                id="phone"
                name="phone"
                type="tel"
                placeholder={t('phonePlaceholder')}
                value={phone}
                onChange={e => setPhone(e.target.value)}
              />
            </div>

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
