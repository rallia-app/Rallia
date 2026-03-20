/**
 * ContactCard Component
 * Displays a contact with edit/delete actions
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text, Button } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import { primary, neutral, status } from '@rallia/design-system';
import type { SharedContact } from '@rallia/shared-services';
import { useTranslation, type TranslationKey } from '../../../hooks';

interface ThemeColors {
  background: string;
  cardBackground: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  primary: string;
}

interface ContactCardProps {
  contact: SharedContact;
  colors: ThemeColors;
  isDark: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

const ContactCard: React.FC<ContactCardProps> = ({ contact, colors, isDark, onEdit, onDelete }) => {
  const { t } = useTranslation();

  // Get initials from name
  const getInitials = (name: string) => {
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.cardBackground,
          borderColor: colors.border,
          shadowColor: isDark ? 'transparent' : '#000',
        },
      ]}
    >
      {/* Top row: avatar + name + source badge */}
      <View style={styles.topRow}>
        <View style={[styles.avatar, { backgroundColor: isDark ? primary[900] : primary[100] }]}>
          <Text size="sm" weight="semibold" color={primary[500]}>
            {getInitials(contact.name)}
          </Text>
        </View>
        <Text
          size="base"
          weight="semibold"
          color={colors.text}
          style={styles.cardTitle}
          numberOfLines={1}
        >
          {contact.name}
        </Text>
        <View
          style={[styles.sourceBadge, { backgroundColor: isDark ? neutral[700] : neutral[100] }]}
        >
          <Ionicons
            name={contact.source === 'phone_book' ? 'phone-portrait-outline' : 'create-outline'}
            size={12}
            color={colors.textMuted}
          />
          <Text size="xs" color={colors.textMuted}>
            {contact.source === 'phone_book'
              ? t('sharedLists.contact.fromContacts')
              : t('sharedLists.contact.manual')}
          </Text>
        </View>
      </View>

      {/* Info rows */}
      {contact.phone ? (
        <View style={styles.infoRow}>
          <Ionicons name="call-outline" size={14} color={colors.textMuted} />
          <Text size="sm" color={colors.textMuted} style={styles.infoText} numberOfLines={1}>
            {contact.phone}
          </Text>
        </View>
      ) : null}

      {contact.email ? (
        <View style={styles.infoRow}>
          <Ionicons name="mail-outline" size={14} color={colors.textMuted} />
          <Text size="sm" color={colors.textMuted} style={styles.infoText} numberOfLines={1}>
            {contact.email}
          </Text>
        </View>
      ) : null}

      {contact.notes ? (
        <View style={styles.infoRow}>
          <Ionicons name="document-text-outline" size={14} color={colors.textMuted} />
          <Text
            size="sm"
            color={colors.textMuted}
            style={[styles.infoText, styles.notesText]}
            numberOfLines={1}
          >
            {contact.notes}
          </Text>
        </View>
      ) : null}

      {/* Action buttons row */}
      <View style={[styles.actionRow, { borderTopColor: colors.border }]}>
        <Button
          variant="ghost"
          size="xs"
          style={styles.actionButton}
          onPress={onEdit}
          leftIcon={<Ionicons name="create-outline" size={14} color={colors.textMuted} />}
          isDark={isDark}
          textStyle={{ color: colors.textMuted }}
        >
          {t('common.edit' as TranslationKey)}
        </Button>
        <Button
          variant="ghost"
          size="xs"
          style={styles.actionButton}
          destructive
          onPress={onDelete}
          leftIcon={<Ionicons name="trash-outline" size={14} color={status.error.DEFAULT} />}
          isDark={isDark}
        >
          {t('common.delete' as TranslationKey)}
        </Button>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: radiusPixels.lg,
    padding: spacingPixels[4],
    marginBottom: spacingPixels[3],
    borderWidth: 1,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    marginBottom: spacingPixels[2],
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    flex: 1,
    flexShrink: 1,
  },
  sourceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[0.5],
    borderRadius: radiusPixels.full,
    gap: spacingPixels[1],
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacingPixels[1],
  },
  infoText: {
    marginLeft: spacingPixels[2],
  },
  notesText: {
    fontStyle: 'italic',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacingPixels[2],
    paddingTop: spacingPixels[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'transparent',
  },
  actionButton: {
    flex: 1,
  },
});

export default ContactCard;
