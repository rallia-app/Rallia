'use client';

import { AdminSidebar } from '@/components/admin-sidebar';
import { SidebarProvider, useSidebar } from '@/components/sidebar-context';
import { TooltipProvider } from '@/components/ui/tooltip';

function AdminLayoutContent({ children }: { children: React.ReactNode }) {
  // Subscribe to sidebar context so main content re-renders on collapse state changes
  useSidebar();

  return (
    <div className="flex min-h-screen">
      <AdminSidebar />
      <main className="flex-1 overflow-auto relative transition-all duration-200">
        <div className="max-w-7xl mx-auto py-8 px-6 h-full">{children}</div>
      </main>
    </div>
  );
}

export function AdminLayoutWrapper({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <TooltipProvider delayDuration={100}>
        <AdminLayoutContent>{children}</AdminLayoutContent>
      </TooltipProvider>
    </SidebarProvider>
  );
}
