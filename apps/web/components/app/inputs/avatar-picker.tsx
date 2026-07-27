'use client';

import { useRef, useState } from 'react';
import { Camera, Loader2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { PlayerAvatar } from '@/components/app/primitives/player-avatar';
import { Button } from '@/components/ui/button';
import { uploadProfileImage, type ImageUploadError } from '@/lib/uploads/image-upload';

/**
 * Optional profile photo, uploaded as soon as it is chosen.
 *
 * Uploading immediately (rather than deferring to submit) matches mobile and lets the
 * player see the cropped result before committing. The cost is an orphaned object if
 * they abandon onboarding — the same trade mobile already makes, and cheap at 320px.
 */
export function AvatarPicker({
  userId,
  name,
  value,
  onChange,
}: {
  userId: string;
  name: string | null;
  /** Public URL of the uploaded image, or null. */
  value: string | null;
  onChange: (url: string | null) => void;
}) {
  const t = useTranslations('profile');
  const tChat = useTranslations('chat');
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<ImageUploadError | null>(null);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setIsUploading(true);
    setError(null);

    const result = await uploadProfileImage(file, userId);
    if (result.url) onChange(result.url);
    else setError(result.error);

    setIsUploading(false);
    // Clear the input so re-picking the same file still fires a change event.
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="flex items-center gap-4">
      <div className="relative">
        <PlayerAvatar name={name} profilePictureUrl={value} size="lg" />
        {isUploading && (
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-background/70">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </span>
        )}
      </div>

      <div className="min-w-0 space-y-1">
        <p className="text-sm font-medium text-foreground">{t('profilePicture')}</p>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isUploading}
            onClick={() => inputRef.current?.click()}
          >
            <Camera className="size-4" aria-hidden="true" />
            {/* chat.addPhoto is the only "Add Photo" string in either locale; the
                heading above already carries the profile framing. */}
            {value ? t('changePhoto') : tChat('addPhoto')}
          </Button>

          {value && !isUploading && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
              <X className="size-4" aria-hidden="true" />
              {t('removePhoto')}
            </Button>
          )}
        </div>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {/* Not onboarding.validation.failedToUploadPicture: that one is phrased as a
                question ("Continue without updating picture?") because mobile shows it in
                a confirm dialog. Inline, with the photo optional anyway, a plain retry
                message is the honest read. */}
            {t('ratingProofs.upload.error')}
          </p>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        // HEIC is offered explicitly: it is the iPhone default, and the upload path
        // re-encodes it to JPEG rather than letting the bucket reject it.
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        className="sr-only"
        onChange={event => void handleFile(event.target.files?.[0])}
      />
    </div>
  );
}
