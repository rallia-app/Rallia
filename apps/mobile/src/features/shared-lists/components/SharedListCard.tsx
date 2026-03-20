/**
 * SharedListCard Component
 * Displays a shared contact list with actions
 */

import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text, Button } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import { primary, neutral, status } from '@rallia/design-system';
import type { SharedContactList } from '@rallia/shared-services';
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

interface SharedListCardProps {
  list: SharedContactList;
  colors: ThemeColors;
  isDark: boolean;
  onPress: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

const SharedListCard: React.FC<SharedListCardProps> = ({
  list,
  colors,
  isDark,
  onPress,
  onEdit,
  onDelete,
}) => {
  const { t } = useTranslation();

  return (
    <TouchableOpacity
      style={[
        styles.card,
        {
          backgroundColor: colors.cardBackground,
          borderColor: colors.border,
          shadowColor: isDark ? 'transparent' : '#000',
        },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {/* Top row: icon + title + chevron */}
      <View style={styles.topRow}>
        <View
          style={[styles.iconContainer, { backgroundColor: isDark ? primary[900] : primary[50] }]}
        >
          <Ionicons name="people-outline" size={20} color={primary[500]} />
        </View>
        <Text
          size="base"
          weight="semibold"
          color={colors.text}
          style={styles.cardTitle}
          numberOfLines={1}
        >
          {list.name}
        </Text>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </View>

      {/* Info rows */}
      {list.description ? (
        <View style={styles.infoRow}>
          <Ionicons name="document-text-outline" size={14} color={colors.textMuted} />
          <Text size="sm" color={colors.textMuted} style={styles.infoText} numberOfLines={1}>
            {list.description}
          </Text>
        </View>
      ) : null}

      <View style={styles.infoRow}>
        <Ionicons name="person-outline" size={14} color={colors.textMuted} />
        <Text size="sm" color={colors.textMuted} style={styles.infoText}>
          {list.contact_count === 1
            ? t('sharedLists.contacts.contactCountSingular', {
                count: list.contact_count,
              })
            : t('sharedLists.contacts.contactCount', {
                count: list.contact_count,
              })}
        </Text>
      </View>

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
    </TouchableOpacity>
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
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: radiusPixels.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    flex: 1,
    flexShrink: 1,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacingPixels[1],
  },
  infoText: {
    marginLeft: spacingPixels[2],
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

export default SharedListCard;
