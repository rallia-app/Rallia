'use client';

import { PlayerBottomNav } from './player-bottom-nav';
import { PlayerHeader } from './player-header';
import { PlayerSidebar } from './player-sidebar';

import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { PostHogIdentify } from '@/components/posthog-identify';
import { QueryProvider } from '@/components/query-provider';
import { SharedSupabaseSync } from '@/components/shared-supabase-sync';
import { SidebarProvider } from '@/components/sidebar-context';
import { SportProvider } from '@/components/app/sport-provider';
import type { PlayerShellData } from '@/lib/supabase/check-player';

interface PlayerShellProps {
  children: React.ReactNode;
  userId: string;
  userEmail: string;
  shellData: PlayerShellData;
  initialSportId: string | null;
  /** Onboarding renders inside the guard but without nav — there is nowhere to go yet. */
  chromeless?: boolean;
}

/**
 * The authenticated player app shell.
 *
 * Provider order matters: SharedSupabaseSync installs the cookie-aware client into the
 * shared-services singleton, and every shared hook and realtime channel below reads
 * through it. Do not hoist a data-fetching provider above it.
 */
export function PlayerShell({
  children,
  userId,
  userEmail,
  shellData,
  initialSportId,
  chromeless = false,
}: PlayerShellProps) {
  // Wired up with the overlay system; for now the action slot is inert.
  const handleAction = () => {};

  return (
    <QueryProvider>
      <SharedSupabaseSync />
      <PostHogIdentify userId={userId} email={userEmail} />
      <TooltipProvider delayDuration={100}>
        <SidebarProvider>
          <SportProvider userId={userId} initialSportId={initialSportId}>
            {chromeless ? (
              <main className="mx-auto min-h-screen w-full max-w-2xl px-4 py-8">{children}</main>
            ) : (
              <div className="flex min-h-screen">
                <PlayerSidebar onAction={handleAction} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <PlayerHeader
                    userId={userId}
                    displayName={shellData.displayName ?? shellData.firstName}
                    profilePictureUrl={shellData.profilePictureUrl}
                  />
                  {/* Bottom padding clears the fixed tab bar; it collapses at lg. */}
                  <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-24 pt-6 lg:pb-10">
                    {children}
                  </main>
                </div>
                <PlayerBottomNav onAction={handleAction} />
              </div>
            )}
            <Toaster position="top-center" richColors />
          </SportProvider>
        </SidebarProvider>
      </TooltipProvider>
    </QueryProvider>
  );
}
