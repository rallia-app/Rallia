/**
 * ContactPickerModal Component
 * Modal for picking contacts from the device phone book
 * Used in Add Score flow to add opponents from contacts
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Linking,
  SafeAreaView,
  Alert,
} from 'react-native';
import * as Contacts from 'expo-contacts';
import { Ionicons } from '@expo/vector-icons';
import { Text, Button } from '@rallia/shared-components';
import { useThemeStyles, useTranslation, type TranslationKey } from '../../../../hooks';
import { SearchBar } from '../../../../components/SearchBar';
import type { SelectedPlayer } from './types';

interface DeviceContact {
  id: string;
  name: string;
  firstName: string;
  lastName: string | undefined;
  phone: string | null;
  email: string | null;
}

// Empty array constant to avoid recreating on every render
const EMPTY_ARRAY: string[] = [];

interface ContactPickerModalProps {
  visible: boolean;
  onClose: () => void;
  onSelectContact: (player: SelectedPlayer) => void;
  /** Already selected player IDs to exclude */
  excludeIds?: string[];
}

export function ContactPickerModal({
  visible,
  onClose,
  onSelectContact,
  excludeIds,
}: ContactPickerModalProps) {
  // Memoize excludeIds to prevent infinite loop from array reference changes
  const stableExcludeIds = useMemo(
    () => excludeIds || EMPTY_ARRAY,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(excludeIds)]
  );
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const [contacts, setContacts] = useState<DeviceContact[]>([]);
  const [filteredContacts, setFilteredContacts] = useState<DeviceContact[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [permissionStatus, setPermissionStatus] = useState<Contacts.PermissionStatus | null>(null);
  
  // Track if we've loaded contacts for this modal session
  const hasLoadedRef = useRef(false);

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
        fields: [
          Contacts.Fields.Name,
          Contacts.Fields.FirstName,
          Contacts.Fields.LastName,
          Contacts.Fields.PhoneNumbers,
          Contacts.Fields.Emails,
        ],
        sort: Contacts.SortTypes.FirstName,
      });

      // Transform contacts
      const transformedContacts: DeviceContact[] = data
        .filter(contact => contact.name && (contact.phoneNumbers?.length || contact.emails?.length))
        .map(contact => ({
          id: contact.id,
          name: contact.name || 'Unknown',
          firstName: contact.firstName || contact.name?.split(' ')[0] || 'Unknown',
          lastName: contact.lastName || contact.name?.split(' ').slice(1).join(' ') || undefined,
          phone: contact.phoneNumbers?.[0]?.number || null,
          email: contact.emails?.[0]?.email || null,
        }))
        // Filter out already selected contacts
        .filter(contact => !stableExcludeIds.includes(`contact-${contact.id}`));

      setContacts(transformedContacts);
      setFilteredContacts(transformedContacts);
    } catch (error) {
      console.error('Failed to load contacts:', error);
      Alert.alert(t('addScore.contactPicker.error'), t('addScore.contactPicker.errorMessage'));
    } finally {
      setIsLoading(false);
    }
  }, [stableExcludeIds, t]);

  // Load contacts when modal opens
  useEffect(() => {
    if (visible && !hasLoadedRef.current) {
      hasLoadedRef.current = true;
      loadContacts();
      setSearchQuery('');
    } else if (!visible) {
      // Reset the flag when modal closes so contacts reload on next open
      hasLoadedRef.current = false;
    }
  }, [visible, loadContacts]);

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

  const handleSelectContact = useCallback(
    (contact: DeviceContact) => {
      const player: SelectedPlayer = {
        id: `contact-${contact.id}`,
        firstName: contact.firstName,
        lastName: contact.lastName,
        displayName: contact.name,
        isFromContacts: true,
        phoneNumber: contact.phone || undefined,
      };
      onSelectContact(player);
      onClose();
    },
    [onSelectContact, onClose]
  );

  const openSettings = useCallback(() => {
    Linking.openSettings();
  }, []);

  const renderContact = useCallback(
    ({ item }: { item: DeviceContact }) => (
      <TouchableOpacity
        style={[styles.contactItem, { borderBottomColor: colors.border }]}
        onPress={() => handleSelectContact(item)}
        activeOpacity={0.7}
      >
        <View style={[styles.avatar, { backgroundColor: isDark ? '#2C2C2E' : '#E5E5EA' }]}>
          <Text weight="semibold" style={{ color: colors.primary }}>
            {item.name.charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={styles.contactInfo}>
          <Text weight="medium" style={{ color: colors.text }}>
            {item.name}
          </Text>
          {item.phone && (
            <Text size="sm" style={{ color: colors.textSecondary }}>
              {item.phone}
            </Text>
          )}
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
      </TouchableOpacity>
    ),
    [colors, isDark, handleSelectContact]
  );

  const renderContent = () => {
    if (isLoading) {
      return (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            {t('addScore.contactPicker.loading')}
          </Text>
        </View>
      );
    }

    if (permissionStatus !== 'granted') {
      return (
        <View style={styles.centerContainer}>
          <Ionicons name="lock-closed-outline" size={64} color={colors.textMuted} />
          <Text weight="semibold" style={[styles.permissionTitle, { color: colors.text }]}>
            {t('addScore.contactPicker.accessRequired')}
          </Text>
          <Text style={[styles.permissionText, { color: colors.textSecondary }]}>
            {t('addScore.contactPicker.accessRequiredMessage')}
          </Text>
          <Button variant="primary" onPress={openSettings} style={styles.settingsButton}>
            {t('addScore.contactPicker.openSettings')}
          </Button>
        </View>
      );
    }

    if (filteredContacts.length === 0) {
      return (
        <View style={styles.centerContainer}>
          <Ionicons name="people-outline" size={64} color={colors.textMuted} />
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            {searchQuery
              ? t('addScore.contactPicker.noContactsMatch')
              : t('addScore.contactPicker.noContactsFound')}
          </Text>
        </View>
      );
    }

    return (
      <FlatList
        data={filteredContacts}
        keyExtractor={item => item.id}
        renderItem={renderContact}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity
            onPress={onClose}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="close-outline" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text weight="semibold" size="lg" style={{ color: colors.text }}>
            {t('addScore.contactPicker.title')}
          </Text>
          <View style={{ width: 24 }} />
        </View>

        {/* Search */}
        {permissionStatus === 'granted' && (
          <View style={styles.searchContainer}>
            <SearchBar
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder={t('addScore.contactPicker.searchPlaceholder')}
              colors={colors}
            />
          </View>
        )}

        {/* Content */}
        {renderContent()}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  searchContainer: {
    margin: 16,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  loadingText: {
    marginTop: 16,
  },
  permissionTitle: {
    marginTop: 16,
    fontSize: 18,
  },
  permissionText: {
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 22,
  },
  settingsButton: {
    marginTop: 24,
    minWidth: 160,
  },
  emptyText: {
    marginTop: 16,
    textAlign: 'center',
  },
  listContent: {
    paddingBottom: 20,
  },
  contactItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  contactInfo: {
    flex: 1,
    marginLeft: 12,
  },
});

export default ContactPickerModal;
