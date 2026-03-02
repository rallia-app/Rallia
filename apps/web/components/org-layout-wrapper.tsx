'use client';

import { OrgSidebar } from '@/components/org-sidebar';
import { OrganizationProvider } from '@/components/organization-context';
import { PostHogIdentify } from '@/components/posthog-identify';
import { QueryProvider } from '@/components/query-provider';
import { SidebarProvider, useSidebar } from '@/components/sidebar-context';
import { usePathname } from '@/i18n/navigation';
import { TooltipProvider } from './ui/tooltip';

function LayoutContent({
  children,
  showSidebar,
}: {
  children: React.ReactNode;
  showSidebar: boolean;
}) {
  // Sidebar context is used to re-render on collapse state changes
  useSidebar();

  return (
    <div className="flex min-h-screen">
      {showSidebar && <OrgSidebar />}
      <main
        className={`flex-1 overflow-auto ${showSidebar ? '' : 'mx-auto max-w-4xl'} relative transition-all duration-200`}
        style={{
          marginLeft: showSidebar ? 0 : undefined,
        }}
      >
        <div className={`${showSidebar ? 'max-w-7xl' : 'w-full'} mx-auto py-8 px-6`}>
          {children}
        </div>
      </main>
    </div>
  );
}

export function OrgLayoutWrapper({
  children,
  hasOrg,
  userId,
  userEmail,
}: {
  children: React.ReactNode;
  hasOrg: boolean;
  userId: string;
  userEmail: string;
}) {
  const pathname = usePathname();
  const isOnboardingPage = pathname?.includes('/onboarding');

  // Show sidebar only if user has org and is not on onboarding
  const showSidebar = hasOrg && !isOnboardingPage;

  return (
    <QueryProvider>
      <SidebarProvider>
        <OrganizationProvider>
          <PostHogIdentify userId={userId} email={userEmail} />
          <TooltipProvider delayDuration={100}>
            <LayoutContent showSidebar={showSidebar}>{children}</LayoutContent>
          </TooltipProvider>
        </OrganizationProvider>
      </SidebarProvider>
    </QueryProvider>
  );
}
