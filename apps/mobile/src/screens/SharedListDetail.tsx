/**
 * SharedListDetail Screen
 *
 * Displays and manages contacts within a shared contact list.
 * Features:
 * - View all contacts in the list
 * - Add contacts from phone book
 * - Add contacts manually
 * - Edit/Delete contacts
 * - Search contacts
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, useNavigation } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { SheetManager } from 'react-native-actions-sheet';
import { Text, Button } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, fontSizePixels } from '@rallia/design-system';
import { primary, neutral } from '@rallia/design-system';
import {
  useSharedContacts,
  useDeleteSharedContact,
  useSharedContactsRealtime,
  type SharedContact,
} from '@rallia/shared-hooks';
import { useThemeStyles, useTranslation, type TranslationKey } from '../hooks';
import type { CommunityStackParamList } from '../navigation/types';
import { ContactCard } from '../features/shared-lists';
import { SearchBar } from '../components/SearchBar';

type RouteParams = {
  SharedListDetail: {
    listId: string;
    listName: string;
  };
};

const SharedListDetail: React.FC = () => {
  const route = useRoute<RouteProp<RouteParams, 'SharedListDetail'>>();
  const navigation = useNavigation<NativeStackNavigationProp<CommunityStackParamList>>();
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const { listId, listName } = route.params;

  // State
  const [searchQuery, setSearchQuery] = useState('');

  // Queries and mutations
  const { data: contacts = [], isLoading, isRefetching, refetch } = useSharedContacts(listId);
  const deleteContactMutation = useDeleteSharedContact();

  // Filter contacts based on search query
  const filteredContacts = useMemo(() => {
    if (!searchQuery.trim()) return contacts;
    const query = searchQuery.toLowerCase().trim();
    return contacts.filter(contact => {
      const name = contact.name?.toLowerCase() || '';
      const phone = contact.phone?.toLowerCase() || '';
      const email = contact.email?.toLowerCase() || '';
      return name.includes(query) || phone.includes(query) || email.includes(query);
    });
  }, [contacts, searchQuery]);

  // Subscribe to real-time updates for this list's contacts
  useSharedContactsRealtime(listId);

  // Set header title
  useEffect(() => {
    navigation.setOptions({
      title: listName,
    });
  }, [navigation, listName]);

  // Refresh handler
  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  // Add contact manually
  const handleAddManually = useCallback(() => {
    SheetManager.show('add-contact', { payload: { listId, editingContact: null } });
  }, [listId]);

  // Import from phone book
  const handleImportFromPhoneBook = useCallback(() => {
    SheetManager.show('import-contacts', { payload: { listId, existingContacts: contacts } });
  }, [listId, contacts]);

  // Edit contact
  const handleEditContact = useCallback(
    (contact: SharedContact) => {
      SheetManager.show('add-contact', { payload: { listId, editingContact: contact } });
    },
    [listId]
  );

  // Delete contact
  const handleDeleteContact = useCallback(
    (contact: SharedContact) => {
      Alert.alert(
        t('sharedLists.deleteContact'),
        t('sharedLists.deleteContactConfirm', { name: contact.name }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.delete'),
            style: 'destructive',
            onPress: async () => {
              try {
                await deleteContactMutation.mutateAsync({ contactId: contact.id, listId });
              } catch (error) {
                console.error('Failed to delete contact:', error);
                Alert.alert(t('common.error'), t('sharedLists.failedToDeleteContact'));
              }
            },
          },
        ]
      );
    },
    [deleteContactMutation, listId, t]
  );

  // Render contact item
  const renderContactItem = useCallback(
    ({ item }: { item: SharedContact }) => (
      <ContactCard
        contact={item}
        colors={colors}
        isDark={isDark}
        onEdit={() => handleEditContact(item)}
        onDelete={() => handleDeleteContact(item)}
      />
    ),
    [colors, isDark, handleEditContact, handleDeleteContact]
  );

  // Render empty state
  const renderEmpty = () => {
    if (isLoading) return null;

    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="person-add-outline" size={64} color={colors.textMuted} />
        <Text size="lg" weight="semibold" color={colors.textMuted} style={styles.emptyTitle}>
          {t('sharedLists.emptyState.noContacts')}
        </Text>
        <Text size="sm" color={colors.textMuted} style={styles.emptyDescription}>
          {t('sharedLists.emptyState.addContacts')}
        </Text>

        <View style={styles.emptyButtons}>
          <Button
            variant="primary"
            size="md"
            rounded
            fullWidth
            onPress={handleImportFromPhoneBook}
            leftIcon={<Ionicons name="phone-portrait-outline" size={20} color="#fff" />}
            isDark={isDark}
          >
            {t('sharedLists.importFromPhone')}
          </Button>

          <Button
            variant="outline"
            size="md"
            rounded
            fullWidth
            onPress={handleAddManually}
            leftIcon={<Ionicons name="add-outline" size={20} color={colors.text} />}
            isDark={isDark}
          >
            {t('sharedLists.addManually')}
          </Button>
        </View>
      </View>
    );
  };

  // Loading state
  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={[]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={[]}>
      {/* Header with Search and Add Buttons */}
      {contacts.length > 0 && (
        <View style={styles.header}>
          {/* Search Bar */}
          <SearchBar
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={t('sharedLists.searchContacts')}
          />

          {/* Count and Buttons Row */}
          <View style={styles.headerRow}>
            <Text size="sm" color={colors.textSecondary}>
              {t('sharedLists.contactCount', { count: filteredContacts.length })}
              {searchQuery &&
                contacts.length !== filteredContacts.length &&
                ` (${t('sharedLists.ofTotal', { total: contacts.length })})`}
            </Text>
            <View style={styles.headerButtons}>
              <TouchableOpacity
                style={[
                  styles.headerButton,
                  { backgroundColor: isDark ? neutral[700] : neutral[100] },
                ]}
                onPress={handleImportFromPhoneBook}
                activeOpacity={0.8}
              >
                <Ionicons name="phone-portrait-outline" size={18} color={colors.text} />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.headerButton, { backgroundColor: primary[500] }]}
                onPress={handleAddManually}
                activeOpacity={0.8}
              >
                <Ionicons name="add-outline" size={20} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* Contacts List */}
      <FlatList
        data={filteredContacts}
        keyExtractor={item => item.id}
        renderItem={renderContactItem}
        contentContainerStyle={[
          styles.listContent,
          filteredContacts.length === 0 && styles.emptyListContent,
        ]}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={renderEmpty}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
          />
        }
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    gap: spacingPixels[3],
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  headerButton: {
    width: 36,
    height: 36,
    borderRadius: radiusPixels.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingHorizontal: spacingPixels[4],
    paddingBottom: spacingPixels[4],
  },
  emptyListContent: {
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacingPixels[8],
  },
  emptyTitle: {
    marginTop: spacingPixels[4],
    textAlign: 'center',
  },
  emptyDescription: {
    marginTop: spacingPixels[2],
    textAlign: 'center',
    lineHeight: 20,
  },
  emptyButtons: {
    marginTop: spacingPixels[6],
    gap: spacingPixels[3],
    width: '100%',
    maxWidth: 280,
  },
});

export default SharedListDetail;
