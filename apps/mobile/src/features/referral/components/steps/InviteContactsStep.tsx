/**
 * InviteContactsStep - Contacts tab of Invite Players
 *
 * Device contacts picker with search, multi-select, and SMS compose.
 * Simplified: no invite tracking or existing-player checking.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  FlatList,
} from 'react-native';
import * as SMS from 'expo-sms';
import * as Contacts from 'expo-contacts';
import { Ionicons } from '@expo/vector-icons';
import { Text, useToast } from '@rallia/shared-components';
import { selectionHaptic, lightHaptic } from '@rallia/shared-utils';
import { spacingPixels, radiusPixels, primary, neutral } from '@rallia/design-system';
import { SearchBar } from '../../../../components/SearchBar';
import type { TranslationKey } from '../../../../hooks';

// ============================================================================
// TYPES
// ============================================================================

interface ThemeColors {
  background: string;
  cardBackground: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  buttonActive: string;
  buttonInactive: string;
  buttonTextActive: string;
  progressActive: string;
  progressInactive: string;
}

interface DeviceContact {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  selected: boolean;
}

interface InviteContactsStepProps {
  referralLink: string | undefined;
  colors: ThemeColors;
  isDark: boolean;
  t: (key: TranslationKey) => string;
}

// ============================================================================
// COMPONENT
// ============================================================================

export const InviteContactsStep: React.FC<InviteContactsStepProps> = ({
  referralLink,
  colors,
  isDark,
  t,
}) => {
  const toast = useToast();
  const [contacts, setContacts] = useState<DeviceContact[]>([]);
  const [filteredContacts, setFilteredContacts] = useState<DeviceContact[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [permissionStatus, setPermissionStatus] = useState<Contacts.PermissionStatus | null>(null);
  const hasLoadedRef = useRef(false);

  // Load contacts
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

      const transformedContacts: DeviceContact[] = data
        .filter(contact => contact.name && (contact.phoneNumbers?.length || contact.emails?.length))
        .map(contact => ({
          id: contact.id,
          name: contact.name || 'Unknown',
          phone: contact.phoneNumbers?.[0]?.number || null,
          email: contact.emails?.[0]?.email || null,
          selected: false,
        }));

      setContacts(transformedContacts);
      setFilteredContacts(transformedContacts);
    } catch (error) {
      console.error('Failed to load contacts:', error);
      toast.error(t('referral.contacts.failedToLoad'));
    } finally {
      setIsLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    if (!hasLoadedRef.current) {
      hasLoadedRef.current = true;
      loadContacts();
    }
  }, [loadContacts]);

  // Filter by search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredContacts(contacts);
    } else {
      const query = searchQuery.toLowerCase();
      setFilteredContacts(
        contacts.filter(
          c =>
            c.name.toLowerCase().includes(query) ||
            c.phone?.includes(query) ||
            c.email?.toLowerCase().includes(query)
        )
      );
    }
  }, [searchQuery, contacts]);

  const toggleContact = useCallback((contactId: string) => {
    selectionHaptic();
    setContacts(prev => prev.map(c => (c.id === contactId ? { ...c, selected: !c.selected } : c)));
    setFilteredContacts(prev =>
      prev.map(c => (c.id === contactId ? { ...c, selected: !c.selected } : c))
    );
  }, []);

  const toggleSelectAll = useCallback(() => {
    lightHaptic();
    const allSelected = filteredContacts.length > 0 && filteredContacts.every(c => c.selected);
    const filteredIds = new Set(filteredContacts.map(c => c.id));

    setContacts(prev =>
      prev.map(c => (filteredIds.has(c.id) ? { ...c, selected: !allSelected } : c))
    );
    setFilteredContacts(prev =>
      prev.map(c => (filteredIds.has(c.id) ? { ...c, selected: !allSelected } : c))
    );
  }, [filteredContacts]);

  const selectedCount = contacts.filter(c => c.selected).length;

  const handleSendInvites = useCallback(async () => {
    const selected = contacts.filter(c => c.selected);
    if (selected.length === 0) {
      toast.warning(t('referral.contacts.selectAtLeastOne'));
      return;
    }

    try {
      // Compose SMS via expo-sms
      const phones = selected.map(c => c.phone).filter((p): p is string => p != null);

      if (phones.length > 0 && referralLink) {
        const message = t('referral.shareMessage').replace('{link}', referralLink);
        const isAvailable = await SMS.isAvailableAsync();
        if (isAvailable) {
          await SMS.sendSMSAsync(phones, message);
        }
      }

      // Deselect all after sending
      setContacts(prev => prev.map(c => ({ ...c, selected: false })));
      setFilteredContacts(prev => prev.map(c => ({ ...c, selected: false })));
    } catch (error) {
      console.error('Failed to send invites:', error);
      toast.error(t('referral.contacts.failedToSend'));
    }
  }, [contacts, referralLink, toast, t]);

  const renderContact = useCallback(
    ({ item }: { item: DeviceContact }) => (
      <TouchableOpacity
        style={[
          styles.contactItem,
          {
            backgroundColor: item.selected ? (isDark ? primary[900] : primary[50]) : 'transparent',
          },
        ]}
        onPress={() => toggleContact(item.id)}
        activeOpacity={0.7}
      >
        <View style={[styles.checkbox, item.selected && styles.checkboxSelected]}>
          {item.selected && <Ionicons name="checkmark-outline" size={14} color="#fff" />}
        </View>
        <View style={styles.contactInfo}>
          <Text
            size="base"
            weight="medium"
            color={colors.text}
            numberOfLines={1}
            style={styles.contactName}
          >
            {item.name}
          </Text>
          <Text size="sm" color={colors.textSecondary} numberOfLines={1}>
            {[item.phone, item.email].filter(Boolean).join(' • ')}
          </Text>
        </View>
      </TouchableOpacity>
    ),
    [colors, isDark, toggleContact]
  );

  // Permission denied state
  if (!isLoading && permissionStatus !== 'granted') {
    return (
      <View style={styles.centerContainer}>
        <Ionicons name="lock-closed-outline" size={64} color={colors.textMuted} />
        <Text size="lg" weight="semibold" color={colors.text} style={styles.centerTitle}>
          {t('referral.contacts.accessRequired')}
        </Text>
        <Text size="sm" color={colors.textSecondary} style={styles.centerDescription}>
          {t('referral.contacts.grantAccess')}
        </Text>
        <TouchableOpacity
          style={[styles.settingsButton, { backgroundColor: primary[500] }]}
          onPress={() => Linking.openSettings()}
          activeOpacity={0.8}
        >
          <Ionicons name="settings-outline" size={20} color="#fff" />
          <Text size="sm" weight="semibold" color="#fff">
            {t('common.openSettings')}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={colors.buttonActive} />
        <Text size="sm" color={colors.textSecondary} style={styles.loadingText}>
          {t('referral.contacts.loading')}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Search */}
      <View style={styles.searchContainer}>
        <SearchBar
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder={t('referral.contacts.search')}
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
          <View
            style={[
              styles.checkbox,
              filteredContacts.every(c => c.selected) && styles.checkboxSelected,
            ]}
          >
            {filteredContacts.every(c => c.selected) && (
              <Ionicons name="checkmark-outline" size={14} color="#fff" />
            )}
          </View>
          <Text size="sm" weight="medium" color={colors.text}>
            {t('common.selectAll')} ({filteredContacts.length})
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
        ListEmptyComponent={
          <View style={styles.centerContainer}>
            <Ionicons name="people-outline" size={64} color={colors.textMuted} />
            <Text size="lg" weight="semibold" color={colors.text} style={styles.centerTitle}>
              {searchQuery ? t('referral.contacts.noResults') : t('referral.contacts.noContacts')}
            </Text>
            <Text size="sm" color={colors.textSecondary} style={styles.centerDescription}>
              {searchQuery
                ? t('common.tryDifferentSearch')
                : t('referral.contacts.noContactsDescription')}
            </Text>
          </View>
        }
      />

      {/* Footer */}
      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <TouchableOpacity
          style={[
            styles.sendButton,
            { backgroundColor: colors.buttonActive },
            selectedCount === 0 && { opacity: 0.5 },
          ]}
          onPress={handleSendInvites}
          disabled={selectedCount === 0}
        >
          <Text size="lg" weight="semibold" color="#FFFFFF">
            {t('referral.contacts.sendInvites')}
            {selectedCount > 0 ? ` (${selectedCount})` : ''}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
  loadingText: {
    marginTop: spacingPixels[3],
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
    paddingBottom: spacingPixels[4],
  },
  emptyListContent: {
    flex: 1,
  },
  contactItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[2],
    borderRadius: radiusPixels.md,
    marginBottom: spacingPixels[1],
    gap: spacingPixels[3],
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: neutral[400],
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: {
    backgroundColor: primary[500],
    borderColor: primary[500],
  },
  contactInfo: {
    flex: 1,
  },
  contactName: {
    flexShrink: 1,
  },
  footer: {
    padding: spacingPixels[4],
    borderTopWidth: 1,
    paddingBottom: spacingPixels[8],
  },
  sendButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    gap: spacingPixels[2],
  },
});
