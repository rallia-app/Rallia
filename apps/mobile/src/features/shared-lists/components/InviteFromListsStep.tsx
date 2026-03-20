/**
 * InviteFromListsStep
 *
 * Reusable step for selecting contacts from shared lists and sharing a match with them.
 * Used inside PlayerInviteStep (Players | From lists tabs) and can be reused by ShareMatchModal.
 */

import React, { useState, useCallback, useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text, useToast } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import { primary, neutral } from '@rallia/design-system';
import {
  getSharedContactLists,
  getSharedContacts,
  shareMatchWithContacts,
  type SharedContactList,
  type SharedContact,
  type ShareChannel,
} from '@rallia/shared-services';
import { selectionHaptic } from '@rallia/shared-utils';
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
  const [isSharing, setIsSharing] = useState(false);
  const [showChannelPicker, setShowChannelPicker] = useState(false);

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
      setShowChannelPicker(false);
      setIsSharing(true);
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

        const { Share, Linking } = await import('react-native');

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

        toast.success(
          t('sharedLists.share.invitationShared', {
            count: selectedContacts.length,
          })
        );
        // Do not call onShareSuccess so the sheet stays open (user may also invite players)
      } catch (error) {
        console.error('Failed to share:', error);
        toast.error(t('sharedLists.share.failedToShare'));
      } finally {
        setIsSharing(false);
      }
    },
    [matchId, selectedContacts, toast, t]
  );

  const handleShareButtonPress = useCallback(() => {
    if (selectedContacts.length === 0) return;
    setShowChannelPicker(true);
  }, [selectedContacts.length]);

  const renderListItem = useCallback(
    ({ item }: { item: SharedContactList }) => {
      const isExpanded = expandedListId === item.id;
      const contacts = listContacts[item.id] || [];
      const isLoadingThisList = isLoadingContacts[item.id];
      const allSelected =
        contacts.length > 0 && contacts.every(c => selectedContacts.some(sc => sc.id === c.id));

      return (
        <View style={[styles.listItem, { borderColor: colors.border }]}>
          <TouchableOpacity style={styles.listHeader} onPress={() => handleToggleList(item.id)}>
            <View
              style={[styles.listIcon, { backgroundColor: isDark ? primary[800] : primary[100] }]}
            >
              <Ionicons
                name="people-outline"
                size={20}
                color={isDark ? primary[300] : primary[600]}
              />
            </View>
            <View style={styles.listInfo}>
              <Text weight="semibold" style={{ color: colors.text }}>
                {item.name}
              </Text>
              <Text size="sm" style={{ color: colors.textSecondary }}>
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
              color={colors.textMuted}
            />
          </TouchableOpacity>

          {isExpanded && (
            <View style={styles.contactsContainer}>
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
                      { backgroundColor: isDark ? neutral[800] : neutral[100] },
                    ]}
                    onPress={() => handleSelectAllFromList(item)}
                  >
                    <Ionicons
                      name={allSelected ? 'checkbox' : 'square-outline'}
                      size={20}
                      color={allSelected ? colors.primary : colors.textSecondary}
                    />
                    <Text size="sm" style={{ color: colors.text, marginLeft: spacingPixels[2] }}>
                      {t('common.selectAll')}
                    </Text>
                  </TouchableOpacity>
                  {contacts.map(contact => {
                    const isSelected = selectedContacts.some(sc => sc.id === contact.id);
                    return (
                      <TouchableOpacity
                        key={contact.id}
                        style={styles.contactRow}
                        onPress={() => handleToggleContact(contact, item.id)}
                      >
                        <Ionicons
                          name={isSelected ? 'checkbox' : 'square-outline'}
                          size={20}
                          color={isSelected ? colors.primary : colors.textSecondary}
                        />
                        <View style={styles.contactInfo}>
                          <Text size="sm" style={{ color: colors.text }}>
                            {contact.name}
                          </Text>
                          {contact.phone && (
                            <Text size="xs" style={{ color: colors.textMuted }}>
                              {contact.phone}
                            </Text>
                          )}
                        </View>
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

      {/* Sticky footer */}
      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        {showChannelPicker && (
          <View
            style={[
              styles.channelPickerCard,
              {
                backgroundColor: isDark ? neutral[800] : neutral[100],
                borderColor: colors.border,
              },
            ]}
          >
            <Text
              size="base"
              weight="semibold"
              style={{ color: colors.text, marginBottom: spacingPixels[3] }}
            >
              {t('sharedLists.share.howToShare')}
            </Text>
            <View style={styles.channelGrid}>
              <TouchableOpacity
                style={[
                  styles.channelOption,
                  {
                    backgroundColor: colors.cardBackground,
                    borderColor: colors.border,
                  },
                ]}
                onPress={() => handleShare('share_sheet')}
                disabled={isSharing}
                activeOpacity={0.7}
              >
                <View
                  style={[
                    styles.channelIconWrap,
                    { backgroundColor: isDark ? neutral[700] : neutral[200] },
                  ]}
                >
                  <Ionicons name="share-outline" size={22} color={colors.primary} />
                </View>
                <Text
                  size="sm"
                  weight="medium"
                  style={{ color: colors.text, marginTop: spacingPixels[1] }}
                >
                  {t('common.share')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.channelOption,
                  {
                    backgroundColor: colors.cardBackground,
                    borderColor: colors.border,
                    opacity: selectedContacts.some(c => c.phone) ? 1 : 0.5,
                  },
                ]}
                onPress={() => handleShare('sms')}
                disabled={isSharing || !selectedContacts.some(c => c.phone)}
                activeOpacity={0.7}
              >
                <View
                  style={[
                    styles.channelIconWrap,
                    { backgroundColor: isDark ? neutral[700] : neutral[200] },
                  ]}
                >
                  <Ionicons name="chatbubble-outline" size={22} color={colors.primary} />
                </View>
                <Text
                  size="sm"
                  weight="medium"
                  style={{ color: colors.text, marginTop: spacingPixels[1] }}
                >
                  SMS
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.channelOption,
                  {
                    backgroundColor: colors.cardBackground,
                    borderColor: colors.border,
                    opacity: selectedContacts.some(c => c.phone) ? 1 : 0.5,
                  },
                ]}
                onPress={() => handleShare('whatsapp')}
                disabled={isSharing || !selectedContacts.some(c => c.phone)}
                activeOpacity={0.7}
              >
                <View
                  style={[
                    styles.channelIconWrap,
                    { backgroundColor: isDark ? neutral[700] : neutral[200] },
                  ]}
                >
                  <Ionicons name="logo-whatsapp" size={22} color="#25D366" />
                </View>
                <Text
                  size="sm"
                  weight="medium"
                  style={{ color: colors.text, marginTop: spacingPixels[1] }}
                >
                  WhatsApp
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.channelOption,
                  {
                    backgroundColor: colors.cardBackground,
                    borderColor: colors.border,
                    opacity: selectedContacts.some(c => c.email) ? 1 : 0.5,
                  },
                ]}
                onPress={() => handleShare('email')}
                disabled={isSharing || !selectedContacts.some(c => c.email)}
                activeOpacity={0.7}
              >
                <View
                  style={[
                    styles.channelIconWrap,
                    { backgroundColor: isDark ? neutral[700] : neutral[200] },
                  ]}
                >
                  <Ionicons name="mail-outline" size={22} color={colors.primary} />
                </View>
                <Text
                  size="sm"
                  weight="medium"
                  style={{ color: colors.text, marginTop: spacingPixels[1] }}
                >
                  Email
                </Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[styles.cancelChannel, { borderColor: colors.border }]}
              onPress={() => setShowChannelPicker(false)}
              activeOpacity={0.7}
            >
              <Ionicons name="chevron-up" size={18} color={colors.textSecondary} />
              <Text
                size="sm"
                weight="medium"
                style={{ color: colors.textSecondary, marginLeft: spacingPixels[1] }}
              >
                {t('common.cancel')}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.footerRow}>
          <TouchableOpacity
            style={[
              styles.shareButton,
              {
                backgroundColor:
                  selectedContacts.length > 0 ? colors.buttonActive : colors.buttonInactive,
              },
            ]}
            onPress={handleShareButtonPress}
            disabled={selectedContacts.length === 0 || isSharing}
            activeOpacity={0.8}
          >
            {isSharing ? (
              <ActivityIndicator size="small" color={colors.buttonTextActive} />
            ) : (
              <Text
                size="base"
                weight="semibold"
                color={selectedContacts.length > 0 ? colors.buttonTextActive : colors.textMuted}
              >
                {selectedContacts.length > 0
                  ? t('matchCreation.invite.shareWithContacts', {
                      count: selectedContacts.length,
                    })
                  : t('matchCreation.invite.selectContactsFromLists')}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
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
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
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
  listItem: {
    borderWidth: 1,
    borderRadius: radiusPixels.lg,
    marginBottom: spacingPixels[2],
    overflow: 'hidden',
  },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacingPixels[3],
  },
  listIcon: {
    width: 40,
    height: 40,
    borderRadius: radiusPixels.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacingPixels[3],
  },
  listInfo: {
    flex: 1,
  },
  contactsContainer: {
    paddingHorizontal: spacingPixels[3],
    paddingBottom: spacingPixels[3],
  },
  selectAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacingPixels[2],
    borderRadius: radiusPixels.md,
    marginBottom: spacingPixels[2],
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacingPixels[2],
  },
  contactInfo: {
    marginLeft: spacingPixels[2],
    flex: 1,
  },
  emptyText: {
    textAlign: 'center',
    paddingVertical: spacingPixels[3],
  },
  loader: {
    marginVertical: spacingPixels[4],
  },
  channelPickerCard: {
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    marginBottom: spacingPixels[3],
  },
  channelGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacingPixels[3],
  },
  channelOption: {
    width: '47%',
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[4],
    paddingHorizontal: spacingPixels[2],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
  },
  channelIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelChannel: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacingPixels[3],
    paddingTop: spacingPixels[3],
    borderTopWidth: 1,
  },
  shareButton: {
    flex: 1,
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default InviteFromListsStep;
