'use client';

import type { AdminRole } from '@rallia/shared-hooks';
import { createContext, useContext } from 'react';

const AdminRoleContext = createContext<AdminRole | null>(null);

export function AdminRoleProvider({
  role,
  children,
}: {
  role: AdminRole;
  children: React.ReactNode;
}) {
  return <AdminRoleContext.Provider value={role}>{children}</AdminRoleContext.Provider>;
}

export function useAdminRole(): AdminRole {
  const role = useContext(AdminRoleContext);
  if (!role) throw new Error('useAdminRole must be used within AdminRoleProvider');
  return role;
}
