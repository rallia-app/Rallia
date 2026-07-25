'use client';

import { getProfilePictureUrl } from '@rallia/shared-utils';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

const SIZE_CLASSES = {
  sm: 'size-8 text-xs',
  md: 'size-10 text-sm',
  lg: 'size-16 text-lg',
  xl: 'size-24 text-2xl',
} as const;

export type PlayerAvatarSize = keyof typeof SIZE_CLASSES;

interface PlayerAvatarProps {
  name?: string | null;
  /** Raw `profile.profile_picture_url` — resolved to a full URL here, not by callers. */
  profilePictureUrl?: string | null;
  size?: PlayerAvatarSize;
  className?: string;
}

/**
 * Derives up to two initials from a display or full name.
 * Falls back to "?" so the avatar never renders empty.
 */
function initialsFrom(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/**
 * Player avatar with an initials fallback.
 *
 * Note it passes the storage path straight to <AvatarImage> rather than through an
 * image-transformation helper: avatars are served raw on purpose, since routing them
 * through transformation is billed per image.
 */
export function PlayerAvatar({
  name,
  profilePictureUrl,
  size = 'md',
  className,
}: PlayerAvatarProps) {
  const src = getProfilePictureUrl(profilePictureUrl) ?? undefined;

  return (
    <Avatar className={cn(SIZE_CLASSES[size], className)}>
      <AvatarImage src={src} alt={name ?? ''} />
      <AvatarFallback className="bg-muted font-medium text-muted-foreground">
        {initialsFrom(name)}
      </AvatarFallback>
    </Avatar>
  );
}
