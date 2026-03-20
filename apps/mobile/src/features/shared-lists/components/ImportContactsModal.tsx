/**
 * ImportContactsModal Component
 * Modal for importing contacts from the device phone book
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Linking,
  FlatList,
} from 'react-native';
import ActionSheet, { SheetManager, SheetProps } from 'react-native-actions-sheet';
import * as Contacts from 'expo-contacts';
import { Ionicons } from '@expo/vector-icons';
import { Text, useToast } from '@rallia/shared-components';
import { selectionHaptic, lightHaptic } from '@rallia/shared-utils';
import { useThemeStyles, useTranslation } from '../../../hooks';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import { SearchBar } from '../../../components/SearchBar';
import { primary } from '@rallia/design-system';
import { bulkCreateSharedContacts, type SharedContact } from '@rallia/shared-services';

interface DeviceContact {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  selected: boolean;
}

export function ImportContactsActionSheet({ payload }: SheetProps<'import-contacts'>) {
  const listId = payload?.listId ?? '';
  const existingContacts = payload?.existingContacts ?? [];

  const { colors, isDark } = useThemeStyles();
  const toast = useToast();
  const { t } = useTranslation();

  const [contacts, setContacts] = useState<DeviceContact[]>([]);
  const [filteredContacts, setFilteredContacts] = useState<DeviceContact[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState<Contacts.PermissionStatus | null>(null);

  // Track if contacts have been loaded to prevent multiple loads
  const hasLoadedRef = useRef(false);

  // Store existingContacts in a ref to avoid dependency issues
  const existingContactsRef = useRef(existingContacts);
  existingContactsRef.current = existingContacts;

  // Request permission and load contacts
  const loadContacts = useCallback(async () => {
    setIsLoading(true);
    try {
      const { status } = await Contacts.requestPermissionsAsync();
      setPermissionStatus(status);

      if (status !== 'granted') {
        setIsLoading(false);
        return;
      }

      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers, Contacts.Fields.Emails],
        sort: Contacts.SortTypes.FirstName,
      });

      // Get existing contact identifiers for duplicate detection
      const currentExistingContacts = existingContactsRef.current;
      const existingIdentifiers = new Set([
        ...currentExistingContacts.map(c => c.device_contact_id).filter(Boolean),
        ...currentExistingContacts.map(c => c.phone?.replace(/\D/g, '')).filter(Boolean),
        ...currentExistingContacts.map(c => c.email?.toLowerCase()).filter(Boolean),
      ]);

      // Transform and filter contacts
      const transformedContacts: DeviceContact[] = data
        .filter(contact => contact.name && (contact.phoneNumbers?.length || contact.emails?.length))
        .map(contact => {
          const phone = contact.phoneNumbers?.[0]?.number || null;
          const email = contact.emails?.[0]?.email || null;

          return {
            id: contact.id,
            name: contact.name || 'Unknown',
            phone,
            email,
            selected: false,
          };
        })
        // Filter out existing contacts
        .filter(contact => {
          const cleanPhone = contact.phone?.replace(/\D/g, '');
          return !(
            existingIdentifiers.has(contact.id) ||
            (cleanPhone && existingIdentifiers.has(cleanPhone)) ||
            (contact.email && existingIdentifiers.has(contact.email.toLowerCase()))
          );
        });

      setContacts(transformedContacts);
      setFilteredContacts(transformedContacts);
    } catch (error) {
      console.error('Failed to load contacts:', error);
      Alert.alert(t('alerts.error'), t('sharedLists.import.failedToLoadContacts'));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  // Load contacts once when sheet mounts
  useEffect(() => {
    if (!hasLoadedRef.current) {
      hasLoadedRef.current = true;
      loadContacts();
    }
  }, [loadContacts]);

  // Filter contacts by search query
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredContacts(contacts);
    } else {
      const query = searchQuery.toLowerCase();
      setFilteredContacts(
        contacts.filter(
          contact =>
            contact.name.toLowerCase().includes(query) ||
            contact.phone?.includes(query) ||
            contact.email?.toLowerCase().includes(query)
        )
      );
    }
  }, [searchQuery, contacts]);

  const handleClose = useCallback(() => {
    setSearchQuery('');
    SheetManager.hide('import-contacts');
  }, []);

  // Toggle contact selection
  const toggleContact = useCallback((contactId: string) => {
    selectionHaptic();
    setContacts(prev => prev.map(c => (c.id === contactId ? { ...c, selected: !c.selected } : c)));
    setFilteredContacts(prev =>
      prev.map(c => (c.id === contactId ? { ...c, selected: !c.selected } : c))
    );
  }, []);

  // Select/deselect all
  const toggleSelectAll = useCallback(() => {
    lightHaptic();
    const allSelected = filteredContacts.every(c => c.selected);
    const filteredIds = new Set(filteredContacts.map(c => c.id));

    setContacts(prev =>
      prev.map(c => (filteredIds.has(c.id) ? { ...c, selected: !allSelected } : c))
    );
    setFilteredContacts(prev => prev.map(c => ({ ...c, selected: !allSelected })));
  }, [filteredContacts]);

  // Get selected count
  const selectedCount = contacts.filter(c => c.selected).length;

  // Import selected contacts
  const handleImport = useCallback(async () => {
    const selectedContacts = contacts.filter(c => c.selected);
    if (selectedContacts.length === 0) {
      toast.warning(t('sharedLists.import.selectAtLeastOne'));
      return;
    }

    setIsImporting(true);
    try {
      await bulkCreateSharedContacts({
        list_id: listId,
        contacts: selectedContacts.map(c => ({
          name: c.name,
          phone: c.phone || undefined,
          email: c.email || undefined,
          source: 'phone_book',
          device_contact_id: c.id,
        })),
      });

      toast.success(
        t('sharedLists.import.importSuccess').replace('{count}', String(selectedContacts.length))
      );
      SheetManager.hide('import-contacts');
    } catch (error) {
      console.error('Failed to import contacts:', error);
      toast.error(t('sharedLists.import.failedToImport'));
    } finally {
      setIsImporting(false);
    }
  }, [contacts, listId, toast, t]);

  // Open settings for permission
  const handleOpenSettings = useCallback(() => {
    Linking.openSettings();
  }, []);

  // Get initials from contact name
  const getInitials = useCallback((name: string) => {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return name.substring(0, 2).toUpperCase();
  }, []);

  // Render contact item
  const renderContact = useCallback(
    ({ item }: { item: DeviceContact }) => (
      <TouchableOpacity
        style={[
          styles.contactItem,
          {
            backgroundColor: item.selected ? `${colors.buttonActive}15` : colors.buttonInactive,
            borderColor: item.selected ? colors.buttonActive : colors.border,
          },
        ]}
        onPress={() => toggleContact(item.id)}
        activeOpacity={0.7}
      >
        <View style={[styles.contactAvatar, { backgroundColor: isDark ? '#2C2C2E' : '#E5E5EA' }]}>
          <Text size="sm" weight="semibold" style={{ color: colors.textMuted }}>
            {getInitials(item.name)}
          </Text>
        </View>
        <View style={styles.contactInfo}>
          <Text weight="medium" style={{ color: colors.text }} numberOfLines={1}>
            {item.name}
          </Text>
          {(item.phone || item.email) && (
            <Text size="sm" style={{ color: colors.textSecondary }} numberOfLines={1}>
              {[item.phone, item.email].filter(Boolean).join(' • ')}
            </Text>
          )}
        </View>
        {item.selected && (
          <Ionicons name="checkmark-circle" size={22} color={colors.buttonActive} />
        )}
      </TouchableOpacity>
    ),
    [colors, isDark, toggleContact, getInitials]
  );

  // Render permission denied state
  const renderPermissionDenied = () => (
    <View style={styles.centerContainer}>
      <Ionicons name="lock-closed-outline" size={64} color={colors.textMuted} />
      <Text size="lg" weight="semibold" style={[styles.centerTitle, { color: colors.text }]}>
        {t('sharedLists.import.contactsAccessRequired')}
      </Text>
      <Text size="sm" style={[styles.centerDescription, { color: colors.textSecondary }]}>
        {t('sharedLists.import.grantAccessMessage')}
      </Text>
      <TouchableOpacity
        style={[styles.settingsButton, { backgroundColor: primary[500] }]}
        onPress={handleOpenSettings}
        activeOpacity={0.8}
      >
        <Ionicons name="settings-outline" size={20} color="#fff" />
        <Text size="sm" weight="semibold" style={{ color: '#fff' }}>
          {t('common.openSettings')}
        </Text>
      </TouchableOpacity>
    </View>
  );

  // Render empty state
  const renderEmpty = () => {
    if (isLoading) return null;

    return (
      <View style={styles.centerContainer}>
        <Ionicons name="people-outline" size={64} color={colors.textMuted} />
        <Text size="lg" weight="semibold" style={[styles.centerTitle, { color: colors.text }]}>
          {searchQuery
            ? t('sharedLists.import.noResults')
            : t('sharedLists.import.noContactsAvailable')}
        </Text>
        <Text size="sm" style={[styles.centerDescription, { color: colors.textSecondary }]}>
          {searchQuery
            ? t('sharedLists.import.tryDifferentSearch')
            : t('sharedLists.import.allContactsInList')}
        </Text>
      </View>
    );
  };

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={[
        styles.sheetBackground,
        styles.container,
        { backgroundColor: colors.cardBackground },
      ]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
    >
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View style={styles.headerCenter}>
          <Text weight="semibold" size="lg" style={{ color: colors.text }}>
            {t('sharedLists.contacts.importFromPhone')}
          </Text>
        </View>
        <TouchableOpacity onPress={handleClose} style={styles.closeButton} disabled={isImporting}>
          <Ionicons name="close-outline" size={24} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Content */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text size="sm" style={[styles.loadingText, { color: colors.textSecondary }]}>
            {t('sharedLists.import.loadingContacts')}
          </Text>
        </View>
      ) : permissionStatus !== 'granted' ? (
        renderPermissionDenied()
      ) : (
        <>
          {/* Search */}
          <View style={styles.searchContainer}>
            <SearchBar
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder={t('sharedLists.import.searchContacts')}
              colors={colors}
            />
          </View>

          {/* Select All */}
          {filteredContacts.length > 0 && (
            <TouchableOpacity
              style={[styles.selectAllRow, { borderBottomColor: colors.border }]}
              onPress={toggleSelectAll}
              activeOpacity={0.7}
            >
              <Ionicons
                name={
                  filteredContacts.every(c => c.selected) ? 'checkmark-circle' : 'ellipse-outline'
                }
                size={22}
                color={
                  filteredContacts.every(c => c.selected) ? colors.buttonActive : colors.textMuted
                }
              />
              <Text size="sm" weight="medium" style={{ color: colors.text }}>
                {t('sharedLists.import.selectAll')} ({filteredContacts.length})
              </Text>
            </TouchableOpacity>
          )}

          {/* Contacts List */}
          <FlatList
            data={filteredContacts}
            keyExtractor={item => item.id}
            renderItem={renderContact}
            contentContainerStyle={[
              styles.listContent,
              filteredContacts.length === 0 && styles.emptyListContent,
            ]}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={renderEmpty}
          />
        </>
      )}

      {/* Footer */}
      {permissionStatus === 'granted' && !isLoading && (
        <View style={[styles.footer, { borderTopColor: colors.border }]}>
          <TouchableOpacity
            style={[
              styles.submitButton,
              { backgroundColor: colors.primary },
              (isImporting || selectedCount === 0) && { opacity: 0.7 },
            ]}
            onPress={handleImport}
            disabled={isImporting || selectedCount === 0}
          >
            {isImporting ? (
              <ActivityIndicator size="small" color={colors.buttonTextActive} />
            ) : (
              <Text size="lg" weight="semibold" color={colors.buttonTextActive}>
                {t('sharedLists.import.import')}
                {selectedCount > 0 ? ` (${selectedCount})` : ''}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      )}
    </ActionSheet>
  );
}

const styles = StyleSheet.create({
  sheetBackground: {
    flex: 1,
    borderTopLeftRadius: radiusPixels['2xl'],
    borderTopRightRadius: radiusPixels['2xl'],
  },
  handleIndicator: {
    width: spacingPixels[10],
    height: 4,
    borderRadius: 4,
    alignSelf: 'center',
  },
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderBottomWidth: 1,
    position: 'relative',
  },
  headerCenter: {
    alignItems: 'center',
  },
  closeButton: {
    padding: 4,
    position: 'absolute',
    right: 16,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: spacingPixels[3],
  },
  searchContainer: {
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
  },
  selectAllRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    borderBottomWidth: 1,
    gap: spacingPixels[3],
  },
  listContent: {
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[3],
    paddingBottom: spacingPixels[4],
  },
  emptyListContent: {
    flex: 1,
  },
  contactItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacingPixels[3],
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: spacingPixels[2],
  },
  contactAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  contactInfo: {
    flex: 1,
    marginLeft: spacingPixels[3],
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacingPixels[8],
  },
  centerTitle: {
    marginTop: spacingPixels[4],
    textAlign: 'center',
  },
  centerDescription: {
    marginTop: spacingPixels[2],
    textAlign: 'center',
    lineHeight: 20,
  },
  settingsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacingPixels[6],
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    gap: spacingPixels[2],
  },
  footer: {
    padding: spacingPixels[4],
    borderTopWidth: 1,
    paddingBottom: spacingPixels[4],
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    gap: spacingPixels[2],
  },
});

// Keep default export for backwards compatibility during migration
export default ImportContactsActionSheet;
