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
import { createClient } from '@/lib/supabase/client';
import { Loader2, Plus, Save } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { useState, useEffect } from 'react';

interface Sport {
  id: string;
  name: string;
  slug: string;
}

type ContactType = 'general' | 'reservation' | 'maintenance' | 'other';

export interface ContactInitialData {
  id: string;
  contact_type: ContactType;
  phone: string | null;
  email: string | null;
  website: string | null;
  is_primary: boolean;
  sport_id: string | null;
  notes: string | null;
}

interface ContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  facilityId: string;
  initialData?: ContactInitialData;
}

export function ContactDialog({ open, onOpenChange, facilityId, initialData }: ContactDialogProps) {
  const t = useTranslations('facilities.contacts');
  const router = useRouter();
  const isEditMode = !!initialData;

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sports state
  const [sports, setSports] = useState<Sport[]>([]);
  const [loadingSports, setLoadingSports] = useState(true);

  // Form state
  const [contactType, setContactType] = useState<ContactType>('general');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [isPrimary, setIsPrimary] = useState(false);
  const [sportId, setSportId] = useState<string>('');
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
      setContactType(initialData.contact_type);
      setPhone(initialData.phone || '');
      setEmail(initialData.email || '');
      setWebsite(initialData.website || '');
      setIsPrimary(initialData.is_primary);
      setSportId(initialData.sport_id || '');
      setNotes(initialData.notes || '');
      setError(null);
    }
  }, [open, initialData]);

  const resetForm = () => {
    setContactType('general');
    setPhone('');
    setEmail('');
    setWebsite('');
    setIsPrimary(false);
    setSportId('');
    setNotes('');
    setError(null);
  };

  const handleClose = () => {
    if (!saving) {
      if (!isEditMode) resetForm();
      setError(null);
      onOpenChange(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    // Validation: at least one of phone or email required
    if (!phone.trim() && !email.trim()) {
      setError(t('validation.phoneOrEmailRequired'));
      setSaving(false);
      return;
    }

    try {
      const supabase = createClient();

      if (isEditMode) {
        // Update mode
        const { error: updateError } = await supabase
          .from('facility_contact')
          .update({
            contact_type: contactType,
            phone: phone.trim() || null,
            email: email.trim() || null,
            website: website.trim() || null,
            is_primary: isPrimary,
            sport_id: sportId || null,
            notes: notes.trim() || null,
          })
          .eq('id', initialData!.id);

        if (updateError) throw updateError;

        onOpenChange(false);
        router.refresh();
      } else {
        // Create mode
        const { error: insertError } = await supabase.from('facility_contact').insert({
          facility_id: facilityId,
          contact_type: contactType,
          phone: phone.trim() || null,
          email: email.trim() || null,
          website: website.trim() || null,
          is_primary: isPrimary,
          sport_id: sportId || null,
          notes: notes.trim() || null,
        });

        if (insertError) throw insertError;

        resetForm();
        onOpenChange(false);
        router.refresh();
      }
    } catch (err) {
      console.error(`Error ${isEditMode ? 'updating' : 'creating'} contact:`, err);
      setError(t('error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditMode ? t('editContact') : t('addContact')}</DialogTitle>
          <DialogDescription>
            {isEditMode ? t('editDescription') : t('addDescription')}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="contact-type">
              {t('contactType')} <span className="text-red-500">*</span>
            </Label>
            <select
              id="contact-type"
              value={contactType}
              onChange={e => setContactType(e.target.value as ContactType)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={saving}
            >
              <option value="general">{t('types.general')}</option>
              <option value="reservation">{t('types.reservation')}</option>
              <option value="maintenance">{t('types.maintenance')}</option>
              <option value="other">{t('types.other')}</option>
            </select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="contact-phone">{t('phone')}</Label>
              <Input
                id="contact-phone"
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder={t('phonePlaceholder')}
                disabled={saving}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="contact-email">{t('email')}</Label>
              <Input
                id="contact-email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder={t('emailPlaceholder')}
                disabled={saving}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="contact-website">{t('website')}</Label>
            <Input
              id="contact-website"
              type="url"
              value={website}
              onChange={e => setWebsite(e.target.value)}
              placeholder={t('websitePlaceholder')}
              disabled={saving}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="contact-sportId">{t('sport')}</Label>
            {loadingSports ? (
              <div className="flex items-center gap-2 py-2">
                <Loader2 className="size-4 animate-spin" />
                <span className="text-sm text-muted-foreground">{t('loadingSports')}</span>
              </div>
            ) : (
              <select
                id="contact-sportId"
                value={sportId}
                onChange={e => setSportId(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={saving}
              >
                <option value="">{t('selectSport')}</option>
                {sports.map(sport => (
                  <option key={sport.id} value={sport.id}>
                    {sport.name}
                  </option>
                ))}
              </select>
            )}
            <p className="text-xs text-muted-foreground">{t('sportHint')}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="contact-notes">{t('notes')}</Label>
            <textarea
              id="contact-notes"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder={t('notesPlaceholder')}
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={saving}
            />
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="contact-isPrimary"
              checked={isPrimary}
              onChange={e => setIsPrimary(e.target.checked)}
              className="size-4 rounded border-gray-300"
              disabled={saving}
            />
            <div>
              <Label htmlFor="contact-isPrimary" className="cursor-pointer">
                {t('isPrimary')}
              </Label>
              <p className="text-sm text-muted-foreground">{t('isPrimaryHint')}</p>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose} disabled={saving}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={saving || (!phone.trim() && !email.trim())}>
              {saving ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  {isEditMode ? t('saving') : t('creating')}
                </>
              ) : (
                <>
                  {isEditMode ? <Save className="mr-2 size-4" /> : <Plus className="mr-2 size-4" />}
                  {isEditMode ? t('saveButton') : t('createButton')}
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
