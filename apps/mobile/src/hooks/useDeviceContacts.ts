import { useCallback, useState } from 'react';
import * as Contacts from 'expo-contacts';

export interface DeviceContact {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  selected: boolean;
}

export interface UseDeviceContactsResult {
  permissionStatus: Contacts.PermissionStatus | null;
  isLoading: boolean;
  contacts: DeviceContact[];
  selectedCount: number;
  requestAndLoad: () => Promise<Contacts.PermissionStatus>;
  toggle: (contactId: string) => void;
  toggleAllInIds: (ids: Set<string>) => void;
  clearSelection: () => void;
}

export function useDeviceContacts(): UseDeviceContactsResult {
  const [permissionStatus, setPermissionStatus] = useState<Contacts.PermissionStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [contacts, setContacts] = useState<DeviceContact[]>([]);

  const requestAndLoad = useCallback(async () => {
    setIsLoading(true);
    try {
      const { status } = await Contacts.requestPermissionsAsync();
      setPermissionStatus(status);

      if (status !== 'granted') {
        return status;
      }

      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers, Contacts.Fields.Emails],
        sort: Contacts.SortTypes.FirstName,
      });

      const transformed: DeviceContact[] = data
        .filter(c => c.name && (c.phoneNumbers?.length || c.emails?.length))
        .map(c => ({
          id: c.id,
          name: c.name || 'Unknown',
          phone: c.phoneNumbers?.[0]?.number ?? null,
          email: c.emails?.[0]?.email ?? null,
          selected: false,
        }));

      setContacts(transformed);
      return status;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const toggle = useCallback((contactId: string) => {
    setContacts(prev => prev.map(c => (c.id === contactId ? { ...c, selected: !c.selected } : c)));
  }, []);

  const toggleAllInIds = useCallback((ids: Set<string>) => {
    setContacts(prev => {
      const allSelected = prev.filter(c => ids.has(c.id)).every(c => c.selected);
      return prev.map(c => (ids.has(c.id) ? { ...c, selected: !allSelected } : c));
    });
  }, []);

  const clearSelection = useCallback(() => {
    setContacts(prev => prev.map(c => ({ ...c, selected: false })));
  }, []);

  const selectedCount = contacts.filter(c => c.selected).length;

  return {
    permissionStatus,
    isLoading,
    contacts,
    selectedCount,
    requestAndLoad,
    toggle,
    toggleAllInIds,
    clearSelection,
  };
}
