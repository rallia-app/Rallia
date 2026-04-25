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
import { Text, useToast, Button } from '@rallia/shared-components';
import { selectionHaptic, lightHaptic } from '@rallia/shared-utils';
import { spacingPixels, radiusPixels, primary } from '@rallia/design-system';
import { SearchBar } from '../../../../components/SearchBar';
import { ContactRow, ContactSelectionCheck } from '../../../../components/ContactRow';
import { formatContactSubtitle } from '../../../../utils/contactDisplay';
import type { TranslationKey } from '../../../../hooks';
import { useSport } from '../../../../context';

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
  listHeader?: React.ReactNode;
}

// ============================================================================
// COMPONENT
// ============================================================================

export const InviteContactsStep: React.FC<InviteContactsStepProps> = ({
  referralLink,
  colors,
  isDark,
  t,
  listHeader,
}) => {
  const toast = useToast();
  const { selectedSport } = useSport();
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
        const sportName = selectedSport?.display_name?.toLowerCase() ?? 'sports';
        const message = t('referral.shareMessage')
          .replace('{sport}', sportName)
          .replace('{link}', referralLink);
        const isAvailable = await SMS.isAvailableAsync();
        if (isAvailable) {
          const { result } = await SMS.sendSMSAsync(phones, message);
          if (result !== 'sent') return;
        }
      }

      // Deselect all after sending and confirm
      setContacts(prev => prev.map(c => ({ ...c, selected: false })));
      setFilteredContacts(prev => prev.map(c => ({ ...c, selected: false })));
      toast.success(t('referral.contacts.invitesSent'));
    } catch (error) {
      console.error('Failed to send invites:', error);
      toast.error(t('referral.contacts.failedToSend'));
    }
  }, [contacts, referralLink, toast, t, selectedSport]);

  const renderContact = useCallback(
    ({ item, index }: { item: DeviceContact; index: number }) => {
      const subtitle = formatContactSubtitle(item.phone, item.email);
      const isLast = index === filteredContacts.length - 1;
      return (
        <View style={styles.rowWrapper}>
          <ContactRow
            name={item.name}
            subtitle={subtitle || undefined}
            avatarSeed={item.id}
            isLast={isLast}
            isDark={isDark}
            selected={item.selected}
            onPress={() => toggleContact(item.id)}
            nameColor={colors.text}
            subtitleColor={colors.textMuted}
            trailing={<ContactSelectionCheck selected={item.selected} isDark={isDark} />}
          />
        </View>
      );
    },
    [colors, isDark, toggleContact, filteredContacts.length]
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

  const listHeaderComponent = (
    <>
      {listHeader}
      {/* Search */}
      <View style={styles.searchContainer}>
        <SearchBar
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder={t('referral.contacts.search')}
          colors={colors}
        />
      </View>

      {/* List header: count + select/deselect all */}
      {filteredContacts.length > 0 &&
        (() => {
          const allSelected = filteredContacts.every(c => c.selected);
          return (
            <View style={styles.listHeaderRow}>
              <Text
                size="xs"
                weight="semibold"
                color={colors.textMuted}
                style={styles.listHeaderLabel}
              >
                {filteredContacts.length}{' '}
                {filteredContacts.length === 1
                  ? t('referral.contacts.contactSingular' as TranslationKey)
                  : t('referral.contacts.contactPlural' as TranslationKey)}
              </Text>
              <TouchableOpacity onPress={toggleSelectAll} activeOpacity={0.6} hitSlop={8}>
                <Text size="xs" weight="semibold" color={colors.buttonActive}>
                  {allSelected ? t('common.deselectAll') : t('common.selectAll')}
                </Text>
              </TouchableOpacity>
            </View>
          );
        })()}
    </>
  );

  return (
    <View style={styles.container}>
      {/* Contacts List */}
      <FlatList
        data={filteredContacts}
        keyExtractor={(item: DeviceContact) => item.id}
        renderItem={renderContact}
        ListHeaderComponent={listHeaderComponent}
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
      <View
        style={[styles.footer, { borderTopColor: colors.border, paddingBottom: spacingPixels[4] }]}
      >
        <Button
          variant="primary"
          size="lg"
          fullWidth
          disabled={selectedCount === 0}
          onPress={handleSendInvites}
          isDark={isDark}
        >
          {t('referral.contacts.sendInvites')}
          {selectedCount > 0 ? ` (${selectedCount})` : ''}
        </Button>
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
    paddingHorizontal: spacingPixels[6],
    paddingVertical: spacingPixels[3],
  },
  listHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacingPixels[6],
    paddingVertical: spacingPixels[3],
  },
  listHeaderLabel: {
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  listContent: {
    paddingBottom: spacingPixels[4],
  },
  emptyListContent: {
    flexGrow: 1,
    paddingBottom: 0,
  },
  rowWrapper: {
    paddingHorizontal: spacingPixels[6],
  },
  footer: {
    paddingHorizontal: spacingPixels[6],
    paddingTop: spacingPixels[4],
    borderTopWidth: 1,
  },
});
