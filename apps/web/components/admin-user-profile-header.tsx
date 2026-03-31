'use client';

import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { ArrowLeft } from 'lucide-react';

interface AdminUserProfileHeaderProps {
  userName: string;
  description: string;
  backLabel: string;
  backHref: string;
}

export function AdminUserProfileHeader({
  userName,
  description,
  backLabel,
  backHref,
}: AdminUserProfileHeaderProps) {
  return (
    <div className="flex items-start justify-between">
      <div className="flex items-start gap-4">
        <Link
          href={backHref}
          className="p-2 hover:bg-muted rounded-md transition-colors mt-1 inline-flex items-center"
        >
          <ArrowLeft className="size-5" />
          <span className="sr-only">{backLabel}</span>
        </Link>
        <div>
          <h1 className="text-3xl font-bold mb-0">{userName}</h1>
          <p className="text-muted-foreground mt-2 mb-0">{description}</p>
        </div>
      </div>
    </div>
  );
}
