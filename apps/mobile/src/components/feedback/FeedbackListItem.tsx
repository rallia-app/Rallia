/**
 * FeedbackListItem
 *
 * Single row in the browse list: module icon, subject, status pill,
 * relative time, and an upvote toggle.
 */

import React, { useCallback } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@rallia/shared-components';
import { neutral, radiusPixels, secondary, spacingPixels } from '@rallia/design-system';
import { lightHaptic, selectionHaptic } from '@rallia/shared-utils';
import type { PublicFeedback } from '@rallia/shared-services';

import { useTranslation, type TranslationKey } from '../../hooks';
import { getModuleIcon, getModuleLabelKey, STATUS_COLORS } from './feedbackModules';

interface FeedbackListItemProps {
  item: PublicFeedback;
  onPress: () => void;
  onToggleVote: () => void;
  isDark: boolean;
  textColor: string;
  mutedColor: string;
  borderColor: string;
  cardColor: string;
}

type TFn = (key: TranslationKey, options?: { [k: string]: string | number | boolean }) => string;

function formatRelativeTime(iso: string, t: TFn): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.max(0, Math.round((now - then) / 1000));
  if (diffSec < 60) return t('feedback.browse.time.now' as TranslationKey);
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return t('feedback.browse.time.min' as TranslationKey, { n: diffMin });
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return t('feedback.browse.time.hour' as TranslationKey, { n: diffH });
  const diffD = Math.round(diffH / 24);
  if (diffD < 30) return t('feedback.browse.time.day' as TranslationKey, { n: diffD });
  const diffMo = Math.round(diffD / 30);
  return t('feedback.browse.time.month' as TranslationKey, { n: diffMo });
}

export const FeedbackListItem: React.FC<FeedbackListItemProps> = ({
  item,
  onPress,
  onToggleVote,
  isDark,
  textColor,
  mutedColor,
  borderColor,
  cardColor,
}) => {
  const { t } = useTranslation();

  const handleVote = useCallback(() => {
    void selectionHaptic();
    onToggleVote();
  }, [onToggleVote]);

  const handlePress = useCallback(() => {
    void lightHaptic();
    onPress();
  }, [onPress]);

  const moduleIcon = getModuleIcon(item.module);
  const moduleLabelKey = getModuleLabelKey(item.module);
  const statusColors = STATUS_COLORS[item.status];

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={handlePress}
      style={[styles.row, { borderColor, backgroundColor: cardColor }]}
    >
      <View style={[styles.iconWrap, { backgroundColor: isDark ? neutral[800] : neutral[100] }]}>
        <Ionicons name={moduleIcon} size={18} color={mutedColor} />
      </View>

      <View style={styles.content}>
        <Text size="sm" weight="semibold" color={textColor} numberOfLines={2}>
          {item.subject || t(moduleLabelKey as TranslationKey)}
        </Text>

        <View style={styles.metaRow}>
          <View style={[styles.statusPill, { backgroundColor: statusColors.bg }]}>
            <Text size="xs" weight="semibold" color={statusColors.fg}>
              {t(`feedback.browse.statusPill.${item.status}` as TranslationKey)}
            </Text>
          </View>
          <Text size="xs" color={mutedColor}>
            ·
          </Text>
          <Text size="xs" color={mutedColor}>
            {formatRelativeTime(item.created_at, t)}
          </Text>
        </View>
      </View>

      <TouchableOpacity
        activeOpacity={0.7}
        onPress={handleVote}
        style={[
          styles.voteBtn,
          {
            backgroundColor: item.has_voted ? secondary[500] : 'transparent',
            borderColor: item.has_voted ? secondary[500] : borderColor,
          },
        ]}
        accessibilityRole="button"
        accessibilityLabel={t(
          item.has_voted
            ? ('feedback.browse.upvotedAria' as TranslationKey)
            : ('feedback.browse.upvoteAria' as TranslationKey)
        )}
      >
        <Ionicons name="caret-up" size={14} color={item.has_voted ? '#FFFFFF' : mutedColor} />
        <Text size="xs" weight="semibold" color={item.has_voted ? '#FFFFFF' : textColor}>
          {item.upvote_count}
        </Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
    padding: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    marginBottom: spacingPixels[2],
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: radiusPixels.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    gap: spacingPixels[1],
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1.5],
  },
  statusPill: {
    paddingHorizontal: spacingPixels[2],
    paddingVertical: 2,
    borderRadius: radiusPixels.full,
  },
  voteBtn: {
    minWidth: 52,
    paddingVertical: spacingPixels[1.5],
    paddingHorizontal: spacingPixels[2],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
});

export default FeedbackListItem;
