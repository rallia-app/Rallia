/**
 * InviteFromListsStep
 *
 * Reusable step for selecting contacts from shared lists and sharing a match with them.
 * Used inside PlayerInviteStep (Players | From lists tabs) and can be reused by ShareMatchModal.
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Share,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text, useToast } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import { primary, neutral, base } from '@rallia/design-system';
import {
  getSharedContactLists,
  getSharedContacts,
  shareMatchWithContacts,
  type SharedContactList,
  type SharedContact,
  type ShareChannel,
} from '@rallia/shared-services';
import { selectionHaptic, lightHaptic } from '@rallia/shared-utils';
import type { TranslationKey, TranslationOptions } from '../../../hooks/useTranslation';

// =============================================================================
// TYPES
// =============================================================================

export interface SelectedContactForShare {
  id: string;
  listId?: string;
  name: string;
  phone?: string;
  email?: string;
}

export interface InviteFromListsStepColors {
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  primary: string;
  cardBackground: string;
  background: string;
  buttonActive: string;
  buttonInactive: string;
  buttonTextActive: string;
}

interface InviteFromListsStepProps {
  matchId: string;
  colors: InviteFromListsStepColors;
  t: (key: TranslationKey, options?: TranslationOptions) => string;
  isDark: boolean;
  /** Called after a successful share (e.g. to close sheet or refresh) */
  onShareSuccess?: () => void;
}

// =============================================================================
// COMPONENT
// =============================================================================

export function InviteFromListsStep({
  matchId,
  colors,
  t,
  isDark,
  onShareSuccess,
}: InviteFromListsStepProps) {
  const toast = useToast();

  const [lists, setLists] = useState<SharedContactList[]>([]);
  const [expandedListId, setExpandedListId] = useState<string | null>(null);
  const [listContacts, setListContacts] = useState<Record<string, SharedContact[]>>({});
  const [selectedContacts, setSelectedContacts] = useState<SelectedContactForShare[]>([]);
  const [isLoadingLists, setIsLoadingLists] = useState(false);
  const [isLoadingContacts, setIsLoadingContacts] = useState<Record<string, boolean>>({});

  const fetchLists = useCallback(async () => {
    setIsLoadingLists(true);
    try {
      const data = await getSharedContactLists();
      setLists(data);
    } catch (error) {
      console.error('Failed to fetch lists:', error);
    } finally {
      setIsLoadingLists(false);
    }
  }, []);

  const fetchListContacts = useCallback(
    async (listId: string) => {
      if (listContacts[listId]) return;
      setIsLoadingContacts(prev => ({ ...prev, [listId]: true }));
      try {
        const contacts = await getSharedContacts(listId);
        setListContacts(prev => ({ ...prev, [listId]: contacts }));
      } catch (error) {
        console.error('Failed to fetch contacts:', error);
      } finally {
        setIsLoadingContacts(prev => ({ ...prev, [listId]: false }));
      }
    },
    [listContacts]
  );

  useEffect(() => {
    fetchLists();
  }, [fetchLists]);

  const handleToggleList = useCallback(
    (listId: string) => {
      selectionHaptic();
      if (expandedListId === listId) {
        setExpandedListId(null);
      } else {
        setExpandedListId(listId);
        fetchListContacts(listId);
      }
    },
    [expandedListId, fetchListContacts]
  );

  const handleToggleContact = useCallback((contact: SharedContact, listId: string) => {
    selectionHaptic();
    setSelectedContacts(prev => {
      const existing = prev.find(c => c.id === contact.id);
      if (existing) {
        return prev.filter(c => c.id !== contact.id);
      }
      return [
        ...prev,
        {
          id: contact.id,
          listId,
          name: contact.name,
          phone: contact.phone || undefined,
          email: contact.email || undefined,
        },
      ];
    });
  }, []);

  const handleSelectAllFromList = useCallback(
    (list: SharedContactList) => {
      selectionHaptic();
      const contacts = listContacts[list.id] || [];
      const allSelected = contacts.every(c => selectedContacts.some(sc => sc.id === c.id));
      if (allSelected) {
        setSelectedContacts(prev => prev.filter(sc => sc.listId !== list.id));
      } else {
        const newContacts = contacts
          .filter(c => !selectedContacts.some(sc => sc.id === c.id))
          .map(c => ({
            id: c.id,
            listId: list.id,
            name: c.name,
            phone: c.phone || undefined,
            email: c.email || undefined,
          }));
        setSelectedContacts(prev => [...prev, ...newContacts]);
      }
    },
    [listContacts, selectedContacts]
  );

  const handleShare = useCallback(
    async (channel: ShareChannel) => {
      if (selectedContacts.length === 0) return;

      try {
        const result = await shareMatchWithContacts({
          matchId,
          channel,
          contacts: selectedContacts.map(c => ({
            contactId: c.id,
            listId: c.listId,
            name: c.name,
            phone: c.phone,
            email: c.email,
          })),
        });

        if (channel === 'share_sheet' || channel === 'copy_link') {
          await Share.share({
            message: result.shareMessage,
            title: t('sharedLists.share.shareGame'),
          });
        } else if (channel === 'sms') {
          const phones = selectedContacts
            .filter(c => c.phone)
            .map(c => c.phone)
            .join(',');
          if (phones) {
            const smsUrl = `sms:${phones}?body=${encodeURIComponent(result.shareMessage)}`;
            await Linking.openURL(smsUrl);
          }
        } else if (channel === 'whatsapp') {
          const firstPhone = selectedContacts.find(c => c.phone)?.phone;
          if (firstPhone) {
            const cleanPhone = firstPhone.replace(/\D/g, '');
            const waUrl = `whatsapp://send?phone=${cleanPhone}&text=${encodeURIComponent(result.shareMessage)}`;
            await Linking.openURL(waUrl);
          }
        } else if (channel === 'email') {
          const emails = selectedContacts
            .filter(c => c.email)
            .map(c => c.email)
            .join(',');
          if (emails) {
            const subject = encodeURIComponent(t('sharedLists.share.gameInvitation'));
            const body = encodeURIComponent(result.shareMessage);
            const mailUrl = `mailto:${emails}?subject=${subject}&body=${body}`;
            await Linking.openURL(mailUrl);
          }
        }
      } catch (error) {
        console.error('Failed to share:', error);
        toast.error(t('sharedLists.share.failedToShare'));
      }
    },
    [matchId, selectedContacts, toast, t]
  );

  const renderListItem = useCallback(
    ({ item }: { item: SharedContactList }) => {
      const isExpanded = expandedListId === item.id;
      const contacts = listContacts[item.id] || [];
      const isLoadingThisList = isLoadingContacts[item.id];
      const allSelected =
        contacts.length > 0 && contacts.every(c => selectedContacts.some(sc => sc.id === c.id));
      const someSelected =
        contacts.length > 0 && contacts.some(c => selectedContacts.some(sc => sc.id === c.id));

      return (
        <View>
          <TouchableOpacity
            style={[
              styles.listCard,
              {
                backgroundColor: someSelected ? `${colors.buttonActive}15` : colors.buttonInactive,
                borderColor: someSelected ? colors.buttonActive : colors.border,
                borderBottomLeftRadius: isExpanded ? 0 : radiusPixels.xl,
                borderBottomRightRadius: isExpanded ? 0 : radiusPixels.xl,
                marginBottom: isExpanded ? 0 : spacingPixels[3],
              },
            ]}
            onPress={() => {
              lightHaptic();
              handleToggleList(item.id);
            }}
            activeOpacity={0.7}
          >
            <View
              style={[
                styles.listIconCircle,
                { backgroundColor: someSelected ? colors.buttonActive : colors.border },
              ]}
            >
              <Ionicons
                name="people-outline"
                size={24}
                color={someSelected ? colors.buttonTextActive : colors.textMuted}
              />
            </View>
            <View style={styles.listInfo}>
              <Text
                size="base"
                weight={someSelected ? 'semibold' : 'regular'}
                color={someSelected ? colors.buttonActive : colors.text}
              >
                {item.name}
              </Text>
              <Text size="xs" color={colors.textMuted}>
                {item.contact_count === 1
                  ? t('sharedLists.contacts.contactCountSingular', {
                      count: item.contact_count,
                    })
                  : t('sharedLists.contacts.contactCount', {
                      count: item.contact_count,
                    })}
              </Text>
            </View>
            <Ionicons
              name={isExpanded ? 'chevron-up' : 'chevron-down'}
              size={20}
              color={someSelected ? colors.buttonActive : colors.textMuted}
            />
          </TouchableOpacity>

          {isExpanded && (
            <View
              style={[
                styles.contactsContainer,
                {
                  backgroundColor: someSelected
                    ? `${colors.buttonActive}08`
                    : colors.buttonInactive,
                  borderColor: someSelected ? colors.buttonActive : colors.border,
                  borderWidth: 1,
                  borderTopWidth: 0,
                  borderBottomLeftRadius: radiusPixels.xl,
                  borderBottomRightRadius: radiusPixels.xl,
                  marginBottom: spacingPixels[3],
                },
              ]}
            >
              {isLoadingThisList ? (
                <ActivityIndicator size="small" color={colors.primary} style={styles.loader} />
              ) : contacts.length === 0 ? (
                <Text size="sm" style={[styles.emptyText, { color: colors.textMuted }]}>
                  {t('sharedLists.contacts.noContactsInList')}
                </Text>
              ) : (
                <>
                  <TouchableOpacity
                    style={[
                      styles.selectAllButton,
                      {
                        borderBottomColor: isDark ? neutral[700] : neutral[200],
                      },
                    ]}
                    onPress={() => handleSelectAllFromList(item)}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name={allSelected ? 'checkmark-circle' : 'ellipse-outline'}
                      size={22}
                      color={allSelected ? colors.primary : colors.textMuted}
                    />
                    <Text
                      size="sm"
                      weight="semibold"
                      color={allSelected ? colors.primary : colors.text}
                    >
                      {t('common.selectAll')}
                    </Text>
                  </TouchableOpacity>
                  {contacts.map((contact, index) => {
                    const isSelected = selectedContacts.some(sc => sc.id === contact.id);
                    const isLast = index === contacts.length - 1;
                    const initials = contact.name
                      .split(' ')
                      .map(n => n[0])
                      .join('')
                      .substring(0, 2)
                      .toUpperCase();
                    return (
                      <TouchableOpacity
                        key={contact.id}
                        style={[
                          styles.contactRow,
                          !isLast && {
                            borderBottomWidth: 1,
                            borderBottomColor: isDark ? neutral[700] : neutral[200],
                          },
                        ]}
                        onPress={() => handleToggleContact(contact, item.id)}
                        activeOpacity={0.7}
                      >
                        <View
                          style={[
                            styles.contactAvatar,
                            {
                              backgroundColor: isSelected
                                ? isDark
                                  ? primary[800]
                                  : primary[100]
                                : isDark
                                  ? neutral[700]
                                  : neutral[200],
                            },
                          ]}
                        >
                          <Text
                            size="xs"
                            weight="bold"
                            color={
                              isSelected ? (isDark ? primary[300] : primary[600]) : colors.textMuted
                            }
                          >
                            {initials}
                          </Text>
                        </View>
                        <View style={styles.contactInfo}>
                          <Text
                            size="sm"
                            weight={isSelected ? 'semibold' : 'regular'}
                            color={colors.text}
                          >
                            {contact.name}
                          </Text>
                          {contact.phone && (
                            <Text size="xs" color={colors.textMuted}>
                              {contact.phone}
                            </Text>
                          )}
                        </View>
                        <Ionicons
                          name={isSelected ? 'checkmark-circle' : 'ellipse-outline'}
                          size={22}
                          color={isSelected ? colors.primary : colors.textMuted}
                        />
                      </TouchableOpacity>
                    );
                  })}
                </>
              )}
            </View>
          )}
        </View>
      );
    },
    [
      expandedListId,
      listContacts,
      isLoadingContacts,
      selectedContacts,
      colors,
      isDark,
      handleToggleList,
      handleToggleContact,
      handleSelectAllFromList,
      t,
    ]
  );

  const renderListContent = () => {
    if (isLoadingLists) {
      return (
        <View style={styles.listLoading}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text size="sm" color={colors.textMuted} style={styles.loadingText}>
            {t('sharedLists.import.loadingContacts')}
          </Text>
        </View>
      );
    }
    if (lists.length === 0) {
      return (
        <View style={styles.emptyState}>
          <Ionicons name="people-outline" size={48} color={colors.textMuted} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            {t('sharedLists.share.noSharedLists')}
          </Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
            {t('sharedLists.share.createListFirst')}
          </Text>
        </View>
      );
    }
    return (
      <FlatList
        data={lists}
        renderItem={renderListItem}
        keyExtractor={item => item.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
      />
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Scrollable content */}
      <View style={styles.listArea}>
        {selectedContacts.length > 0 && !isLoadingLists && (
          <View
            style={[styles.selectedBadge, { backgroundColor: isDark ? primary[900] : primary[50] }]}
          >
            <Text size="sm" style={{ color: colors.primary }}>
              {t('sharedLists.share.contactsSelected', {
                count: selectedContacts.length,
              })}
            </Text>
          </View>
        )}

        {renderListContent()}
      </View>

      {/* Sticky footer with share buttons */}
      {selectedContacts.length > 0 && (
        <View style={[styles.footer, { borderTopColor: colors.border }]}>
          <View style={styles.shareOptions}>
            <TouchableOpacity
              style={[styles.shareOption, { backgroundColor: colors.buttonActive }]}
              onPress={() => handleShare('share_sheet')}
              activeOpacity={0.7}
            >
              <Ionicons name="share-outline" size={20} color={colors.buttonTextActive} />
              <Text size="sm" weight="semibold" color={colors.buttonTextActive}>
                {t('common.share')}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.shareOption,
                {
                  backgroundColor: selectedContacts.some(c => c.phone)
                    ? colors.buttonActive
                    : colors.border,
                },
              ]}
              onPress={() => handleShare('sms')}
              disabled={!selectedContacts.some(c => c.phone)}
              activeOpacity={0.7}
            >
              <Ionicons
                name="chatbubble-outline"
                size={20}
                color={
                  selectedContacts.some(c => c.phone) ? colors.buttonTextActive : colors.textMuted
                }
              />
              <Text
                size="sm"
                weight="semibold"
                color={
                  selectedContacts.some(c => c.phone) ? colors.buttonTextActive : colors.textMuted
                }
              >
                SMS
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.shareOption,
                {
                  backgroundColor: selectedContacts.some(c => c.phone) ? '#25D366' : colors.border,
                },
              ]}
              onPress={() => handleShare('whatsapp')}
              disabled={!selectedContacts.some(c => c.phone)}
              activeOpacity={0.7}
            >
              <Ionicons
                name="logo-whatsapp"
                size={20}
                color={selectedContacts.some(c => c.phone) ? base.white : colors.textMuted}
              />
              <Text
                size="sm"
                weight="semibold"
                color={selectedContacts.some(c => c.phone) ? base.white : colors.textMuted}
              >
                WhatsApp
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.shareOption,
                {
                  backgroundColor: selectedContacts.some(c => c.email)
                    ? colors.buttonActive
                    : colors.border,
                },
              ]}
              onPress={() => handleShare('email')}
              disabled={!selectedContacts.some(c => c.email)}
              activeOpacity={0.7}
            >
              <Ionicons
                name="mail-outline"
                size={20}
                color={
                  selectedContacts.some(c => c.email) ? colors.buttonTextActive : colors.textMuted
                }
              />
              <Text
                size="sm"
                weight="semibold"
                color={
                  selectedContacts.some(c => c.email) ? colors.buttonTextActive : colors.textMuted
                }
              >
                Email
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listArea: {
    flex: 1,
  },
  listLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[8],
  },
  loadingText: {
    marginTop: spacingPixels[2],
  },
  footer: {
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[4],
    borderTopWidth: 1,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[8],
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: spacingPixels[3],
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: spacingPixels[2],
    paddingHorizontal: spacingPixels[4],
  },
  selectedBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.full,
    marginHorizontal: spacingPixels[4],
    marginBottom: spacingPixels[3],
  },
  listContent: {
    paddingHorizontal: spacingPixels[4],
    paddingBottom: spacingPixels[4],
    flexGrow: 1,
  },
  listCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacingPixels[4],
    borderRadius: radiusPixels.xl,
    borderWidth: 1,
    gap: spacingPixels[3],
  },
  listIconCircle: {
    width: 44,
    height: 44,
    borderRadius: radiusPixels.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listInfo: {
    flex: 1,
  },
  contactsContainer: {
    paddingHorizontal: spacingPixels[4],
    paddingBottom: spacingPixels[3],
  },
  selectAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacingPixels[2.5],
    paddingHorizontal: spacingPixels[1],
    gap: spacingPixels[2.5],
    borderBottomWidth: 1,
    marginBottom: spacingPixels[1],
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacingPixels[2.5],
    paddingHorizontal: spacingPixels[1],
    gap: spacingPixels[3],
  },
  contactAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactInfo: {
    flex: 1,
  },
  emptyText: {
    textAlign: 'center',
    paddingVertical: spacingPixels[3],
  },
  loader: {
    marginVertical: spacingPixels[4],
  },
  shareOptions: {
    flexDirection: 'column',
    gap: spacingPixels[2],
  },
  shareOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[3.5],
    paddingHorizontal: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    gap: spacingPixels[2],
  },
});

export default InviteFromListsStep;
