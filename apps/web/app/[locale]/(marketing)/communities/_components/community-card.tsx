'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { BadgeCheck, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PublicCommunity {
  id: string;
  name: string;
  description: string | null;
  cover_image_url: string | null;
  is_private: boolean;
  member_count: number;
  created_by: string;
  created_at: string;
  is_member: boolean;
  membership_status: string | null;
  membership_role: string | null;
  sport_id: string | null;
  is_certified: boolean;
}

interface CommunityCardProps {
  community: PublicCommunity;
  sportName?: string;
  onJoin: (communityId: string) => void;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function CommunityCard({ community, sportName, onJoin }: CommunityCardProps) {
  const t = useTranslations('communitiesPage');

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl border bg-card transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 h-full">
      {/* Accent strip */}
      <div className="h-1 w-full bg-gradient-to-r from-primary to-primary/60" />

      {/* Cover image */}
      {community.cover_image_url ? (
        <img
          src={community.cover_image_url}
          alt={community.name}
          className="h-36 w-full object-cover"
        />
      ) : (
        <div className="h-36 w-full bg-muted flex items-center justify-center">
          <Users className="size-10 text-muted-foreground/40" />
        </div>
      )}

      <div className="flex flex-col gap-3 p-5 flex-1">
        {/* Name + certified badge */}
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="font-semibold text-foreground truncate">{community.name}</h3>
          {community.is_certified && <BadgeCheck className="size-4 shrink-0 text-primary" />}
        </div>

        {/* Member count */}
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Users className="size-3.5 shrink-0" />
          <span>{t('members', { count: community.member_count })}</span>
        </div>

        {/* Description */}
        {community.description && (
          <p className="text-sm text-muted-foreground line-clamp-2">{community.description}</p>
        )}

        {/* Sport badge */}
        {sportName && (
          <div>
            <Badge variant="default" className="capitalize text-xs font-semibold">
              {sportName}
            </Badge>
          </div>
        )}

        <div className="flex-1" />

        {/* CTA */}
        <Button className="w-full font-semibold" size="lg" onClick={() => onJoin(community.id)}>
          {t('joinButton')}
        </Button>
      </div>
    </div>
  );
}
