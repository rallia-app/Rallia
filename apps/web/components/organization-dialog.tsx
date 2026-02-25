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
import { useRouter } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/client';
import { Edit, Loader2, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

export interface OrganizationInitialData {
  slug: string;
  name: string;
  nature: 'public' | 'private';
  type: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  description: string | null;
  is_active: boolean;
  data_provider_id: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  postal_code: string | null;
}

interface OrganizationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialData?: OrganizationInitialData;
}

interface DataProvider {
  id: string;
  name: string;
  provider_type: string;
}

export function OrganizationDialog({ open, onOpenChange, initialData }: OrganizationDialogProps) {
  const t = useTranslations('admin.organizations.createDialog');
  const router = useRouter();
  const isEditMode = !!initialData;

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [nature, setNature] = useState<'public' | 'private'>('public');
  const [type, setType] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [website, setWebsite] = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [dataProviderId, setDataProviderId] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('');
  const [postalCode, setPostalCode] = useState('');

  // Data providers
  const [dataProviders, setDataProviders] = useState<DataProvider[]>([]);

  // Populate form when initialData changes or dialog opens
  useEffect(() => {
    if (open && initialData) {
      setName(initialData.name);
      setNature(initialData.nature);
      setType(initialData.type || '');
      setEmail(initialData.email || '');
      setPhone(initialData.phone || '');
      setWebsite(initialData.website || '');
      setDescription(initialData.description || '');
      setIsActive(initialData.is_active);
      setDataProviderId(initialData.data_provider_id || '');
      setAddress(initialData.address || '');
      setCity(initialData.city || '');
      setCountry(initialData.country || '');
      setPostalCode(initialData.postal_code || '');
    }
  }, [open, initialData]);

  // Fetch data providers on mount
  useEffect(() => {
    if (open) {
      fetch('/api/data-providers')
        .then(res => res.json())
        .then(data => setDataProviders(data.dataProviders || []))
        .catch(() => setDataProviders([]));
    }
  }, [open]);

  const resetForm = () => {
    setName('');
    setNature('public');
    setType('');
    setEmail('');
    setPhone('');
    setWebsite('');
    setDescription('');
    setIsActive(true);
    setDataProviderId('');
    setAddress('');
    setCity('');
    setCountry('');
    setPostalCode('');
    setError(null);
  };

  const handleClose = () => {
    if (!saving) {
      if (!isEditMode) {
        resetForm();
      }
      setError(null);
      onOpenChange(false);
    }
  };

  const generateSlug = (name: string) => {
    return (
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .substring(0, 50) +
      '-' +
      Date.now().toString(36)
    );
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
          .from('organization')
          .update({
            name,
            nature,
            type: (type as 'club' | 'municipality' | 'city' | 'association') || null,
            email: email || null,
            phone: phone || null,
            website: website || null,
            description: description || null,
            is_active: isActive,
            data_provider_id: dataProviderId || null,
            address: address || null,
            city: city || null,
            country: (country as 'Canada' | 'United States') || null,
            postal_code: postalCode || null,
          })
          .eq('slug', initialData!.slug);

        if (updateError) throw updateError;

        onOpenChange(false);
        router.refresh();
      } else {
        // Create mode
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) throw new Error('Not authenticated');

        const slug = generateSlug(name);

        const { error: insertError } = await supabase
          .from('organization')
          .insert({
            name,
            slug,
            nature,
            type: (type as 'club' | 'municipality' | 'city' | 'association') || null,
            email: email || null,
            phone: phone || null,
            website: website || null,
            description: description || null,
            is_active: isActive,
            data_provider_id: dataProviderId || null,
            address: address || null,
            city: city || null,
            country: (country as 'Canada' | 'United States') || null,
            postal_code: postalCode || null,
            owner_id: user.id,
          })
          .select('id')
          .single();

        if (insertError) throw insertError;

        resetForm();
        onOpenChange(false);
        router.push(`/admin/organizations/${slug}`);
        router.refresh();
      }
    } catch (err) {
      console.error(`Error ${isEditMode ? 'updating' : 'creating'} organization:`, err);
      setError(isEditMode ? t('updateError') : t('error'));
    } finally {
      setSaving(false);
    }
  };

  const isValid = name.trim() && nature;

  const selectClassName =
    'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditMode ? t('editTitle') : t('title')}</DialogTitle>
          <DialogDescription>
            {isEditMode ? t('editDescription') : t('description')}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="org-name">
              {t('fields.name')} <span className="text-red-500">*</span>
            </Label>
            <Input
              id="org-name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t('fields.namePlaceholder')}
              disabled={saving}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="org-nature">
                {t('fields.nature')} <span className="text-red-500">*</span>
              </Label>
              <select
                id="org-nature"
                value={nature}
                onChange={e => setNature(e.target.value as 'public' | 'private')}
                className={selectClassName}
                disabled={saving}
              >
                <option value="public">{t('natures.public')}</option>
                <option value="private">{t('natures.private')}</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="org-type">{t('fields.type')}</Label>
              <select
                id="org-type"
                value={type}
                onChange={e => setType(e.target.value)}
                className={selectClassName}
                disabled={saving}
              >
                <option value="">{t('fields.selectType')}</option>
                <option value="club">{t('types.club')}</option>
                <option value="municipality">{t('types.municipality')}</option>
                <option value="city">{t('types.city')}</option>
                <option value="association">{t('types.association')}</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="org-email">{t('fields.email')}</Label>
              <Input
                id="org-email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder={t('fields.emailPlaceholder')}
                disabled={saving}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="org-phone">{t('fields.phone')}</Label>
              <Input
                id="org-phone"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder={t('fields.phonePlaceholder')}
                disabled={saving}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="org-website">{t('fields.website')}</Label>
            <Input
              id="org-website"
              value={website}
              onChange={e => setWebsite(e.target.value)}
              placeholder={t('fields.websitePlaceholder')}
              disabled={saving}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="org-description">{t('fields.description')}</Label>
            <textarea
              id="org-description"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder={t('fields.descriptionPlaceholder')}
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={saving}
            />
          </div>

          {/* Address fields */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="org-address">{t('fields.address')}</Label>
              <Input
                id="org-address"
                value={address}
                onChange={e => setAddress(e.target.value)}
                placeholder={t('fields.addressPlaceholder')}
                disabled={saving}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="org-city">{t('fields.city')}</Label>
              <Input
                id="org-city"
                value={city}
                onChange={e => setCity(e.target.value)}
                placeholder={t('fields.cityPlaceholder')}
                disabled={saving}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="org-country">{t('fields.country')}</Label>
              <select
                id="org-country"
                value={country}
                onChange={e => setCountry(e.target.value)}
                className={selectClassName}
                disabled={saving}
              >
                <option value="">{t('fields.selectCountry')}</option>
                <option value="Canada">Canada</option>
                <option value="United States">United States</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="org-postal-code">{t('fields.postalCode')}</Label>
              <Input
                id="org-postal-code"
                value={postalCode}
                onChange={e => setPostalCode(e.target.value)}
                placeholder={t('fields.postalCodePlaceholder')}
                disabled={saving}
              />
            </div>
          </div>

          {/* Data Provider */}
          <div className="space-y-2">
            <Label htmlFor="org-data-provider">{t('fields.dataProvider')}</Label>
            <select
              id="org-data-provider"
              value={dataProviderId}
              onChange={e => setDataProviderId(e.target.value)}
              className={selectClassName}
              disabled={saving}
            >
              <option value="">{t('fields.selectDataProvider')}</option>
              {dataProviders.map(dp => (
                <option key={dp.id} value={dp.id}>
                  {dp.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">{t('fields.dataProviderHint')}</p>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="org-is-active"
              checked={isActive}
              onChange={e => setIsActive(e.target.checked)}
              className="size-4 rounded border-gray-300"
              disabled={saving}
            />
            <div>
              <Label htmlFor="org-is-active" className="cursor-pointer">
                {t('fields.isActive')}
              </Label>
              <p className="text-sm text-muted-foreground">{t('fields.isActiveHint')}</p>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose} disabled={saving}>
              {t('actions.cancel')}
            </Button>
            <Button type="submit" disabled={saving || !isValid}>
              {saving ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  {isEditMode ? t('actions.updating') : t('actions.creating')}
                </>
              ) : (
                <>
                  {isEditMode ? <Edit className="mr-2 size-4" /> : <Plus className="mr-2 size-4" />}
                  {isEditMode ? t('actions.update') : t('actions.create')}
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
