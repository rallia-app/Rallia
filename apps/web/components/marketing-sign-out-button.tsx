'use client';

import { useMemo, useState } from 'react';
import { LogOut } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from './ui/button';

import { useRouter } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { useAuth } from '@rallia/shared-hooks';

type MarketingSignOutButtonProps = {
  className?: string;
  variant?: 'link' | 'outline' | 'ghost';
  onSignedOut?: () => void;
};

export function MarketingSignOutButton({
  className,
  variant = 'link',
  onSignedOut,
}: MarketingSignOutButtonProps) {
  const t = useTranslations('auth');
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { signOut } = useAuth({ client: supabase });
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await signOut();
      onSignedOut?.();
      router.refresh();
    } finally {
      setIsSigningOut(false);
    }
  };

  if (variant === 'link') {
    return (
      <button
        type="button"
        onClick={handleSignOut}
        disabled={isSigningOut}
        className={cn(
          'inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50',
          className
        )}
      >
        <LogOut className="size-3.5" />
        {t('signOut')}
      </button>
    );
  }

  return (
    <Button
      type="button"
      variant={variant}
      size="sm"
      onClick={handleSignOut}
      disabled={isSigningOut}
      className={cn('gap-1.5', className)}
    >
      <LogOut className="size-3.5" />
      {t('signOut')}
    </Button>
  );
}
