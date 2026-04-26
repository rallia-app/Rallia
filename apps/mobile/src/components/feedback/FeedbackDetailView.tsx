/**
 * FeedbackDetailView
 *
 * Read-only view of a single public feedback report. Shows subject,
 * status, category-specific metadata fields, screenshots, and an
 * optional admin note. Sticky upvote button at the bottom.
 */

import React, { useCallback, useState } from 'react';
import { Image, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ScrollView } from 'react-native-actions-sheet';

import { Text } from '@rallia/shared-components';
import {
  base,
  darkTheme,
  lightTheme,
  neutral,
  radiusPixels,
  secondary,
  spacingPixels,
} from '@rallia/design-system';
import { useTheme } from '@rallia/shared-hooks';
import { selectionHaptic } from '@rallia/shared-utils';
import type {
  BugFeedbackMetadata,
  FeatureFeedbackMetadata,
  PublicFeedback,
} from '@rallia/shared-services';

import { useTranslation, type TranslationKey } from '../../hooks';
import { getModuleIcon, getModuleLabelKey, STATUS_COLORS } from './feedbackModules';

interface FeedbackDetailViewProps {
  item: PublicFeedback;
  onBack: () => void;
  onToggleVote: () => Promise<void> | void;
}

export const FeedbackDetailView: React.FC<FeedbackDetailViewProps> = ({
  item,
  onBack,
  onToggleVote,
}) => {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const isDark = theme === 'dark';
  const themeColors = isDark ? darkTheme : lightTheme;

  const [voteBusy, setVoteBusy] = useState(false);

  const colors = {
    text: themeColors.foreground,
    muted: themeColors.mutedForeground,
    border: themeColors.border,
    card: themeColors.card,
    sectionBg: isDark ? neutral[800] : neutral[50],
  };

  const statusColors = STATUS_COLORS[item.status];
  const moduleIcon = getModuleIcon(item.module);
  const moduleLabelKey = getModuleLabelKey(item.module);

  const handleVote = useCallback(async () => {
    if (voteBusy) return;
    void selectionHaptic();
    setVoteBusy(true);
    try {
      await onToggleVote();
    } finally {
      setVoteBusy(false);
    }
  }, [onToggleVote, voteBusy]);

  const showAdminNote =
    item.admin_notes && (item.status === 'in_progress' || item.status === 'resolved');

  // Render category-specific metadata.
  const renderMetadata = () => {
    if (!item.metadata) return null;

    if (item.category === 'bug') {
      const meta = item.metadata as BugFeedbackMetadata;
      return (
        <>
          {meta.severity && (
            <DetailRow
              label={t('feedback.bug.severityLabel' as TranslationKey)}
              value={t(
                `feedback.bug.severity${meta.severity.charAt(0).toUpperCase() + meta.severity.slice(1)}` as TranslationKey
              )}
              colors={colors}
            />
          )}
          {meta.steps_to_reproduce && (
            <DetailRow
              label={t('feedback.bug.stepsLabel' as TranslationKey)}
              value={meta.steps_to_reproduce}
              colors={colors}
              multiline
            />
          )}
          {meta.expected_vs_actual && (
            <DetailRow
              label={t('feedback.bug.expectedLabel' as TranslationKey)}
              value={meta.expected_vs_actual}
              colors={colors}
              multiline
            />
          )}
        </>
      );
    }

    if (item.category === 'feature') {
      const meta = item.metadata as FeatureFeedbackMetadata;
      return (
        <>
          {meta.description && (
            <DetailRow
              label={t('feedback.feature.descriptionLabel' as TranslationKey)}
              value={meta.description}
              colors={colors}
              multiline
            />
          )}
          {meta.use_case && (
            <DetailRow
              label={t('feedback.feature.useCaseLabel' as TranslationKey)}
              value={meta.use_case}
              colors={colors}
              multiline
            />
          )}
        </>
      );
    }

    return null;
  };

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={onBack}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={22} color={colors.text} />
          <Text size="sm" weight="semibold" color={colors.text}>
            {t('feedback.browse.detail.backToList' as TranslationKey)}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Module + status row */}
        <View style={styles.metaRow}>
          <View
            style={[
              styles.modulePill,
              { backgroundColor: colors.sectionBg, borderColor: colors.border },
            ]}
          >
            <Ionicons name={moduleIcon} size={14} color={colors.muted} />
            <Text size="xs" color={colors.muted}>
              {t(moduleLabelKey as TranslationKey)}
            </Text>
          </View>
          <View style={[styles.statusPill, { backgroundColor: statusColors.bg }]}>
            <Text size="xs" weight="semibold" color={statusColors.fg}>
              {t(`feedback.browse.statusPill.${item.status}` as TranslationKey)}
            </Text>
          </View>
        </View>

        {/* Subject */}
        <Text size="lg" weight="bold" color={colors.text} style={styles.title}>
          {item.subject}
        </Text>

        {/* Submitter line */}
        <Text size="xs" color={colors.muted} style={styles.submitterLine}>
          {item.is_anonymous
            ? t('feedback.browse.anonymous' as TranslationKey)
            : t('feedback.browse.byPlayer' as TranslationKey)}
          {' · '}
          {new Date(item.created_at).toLocaleDateString()}
        </Text>

        {/* Body */}
        {item.message && item.message.trim().length > 0 && (
          <View
            style={[
              styles.messageBlock,
              { backgroundColor: colors.sectionBg, borderColor: colors.border },
            ]}
          >
            <Text size="sm" color={colors.text}>
              {item.message}
            </Text>
          </View>
        )}

        {/* Metadata */}
        {renderMetadata()}

        {/* Screenshots */}
        {item.screenshot_urls && item.screenshot_urls.length > 0 && (
          <View style={styles.screenshots}>
            <Text size="sm" weight="semibold" color={colors.muted} style={styles.sectionLabel}>
              {t('feedback.screenshotsLabel' as TranslationKey)}
            </Text>
            <View style={styles.screenshotGrid}>
              {item.screenshot_urls.map(url => (
                <Image key={url} source={{ uri: url }} style={styles.screenshot} />
              ))}
            </View>
          </View>
        )}

        {/* Admin note */}
        {showAdminNote && (
          <View
            style={[
              styles.adminNote,
              { backgroundColor: `${secondary[500]}10`, borderColor: secondary[500] },
            ]}
          >
            <View style={styles.adminNoteHeader}>
              <Ionicons name="megaphone-outline" size={16} color={secondary[500]} />
              <Text size="xs" weight="semibold" color={secondary[500]}>
                {t('feedback.browse.detail.adminNoteLabel' as TranslationKey)}
              </Text>
            </View>
            <Text size="sm" color={colors.text}>
              {item.admin_notes}
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Sticky upvote */}
      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => void handleVote()}
          disabled={voteBusy}
          style={[
            styles.voteCta,
            {
              backgroundColor: item.has_voted ? secondary[500] : 'transparent',
              borderColor: secondary[500],
            },
          ]}
        >
          <Ionicons
            name="caret-up"
            size={18}
            color={item.has_voted ? base.white : secondary[500]}
          />
          <Text size="base" weight="semibold" color={item.has_voted ? base.white : secondary[500]}>
            {item.has_voted
              ? t('feedback.browse.upvoted' as TranslationKey, { n: item.upvote_count })
              : t('feedback.browse.upvote' as TranslationKey, { n: item.upvote_count })}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

interface DetailRowProps {
  label: string;
  value: string;
  multiline?: boolean;
  colors: { text: string; muted: string; border: string; sectionBg: string };
}

const DetailRow: React.FC<DetailRowProps> = ({ label, value, multiline, colors }) => (
  <View style={styles.detailRow}>
    <Text size="xs" weight="semibold" color={colors.muted} style={styles.sectionLabel}>
      {label}
    </Text>
    <View
      style={[
        styles.detailValueBox,
        { backgroundColor: colors.sectionBg, borderColor: colors.border },
        multiline && styles.detailValueBoxMultiline,
      ]}
    >
      <Text size="sm" color={colors.text}>
        {value}
      </Text>
    </View>
  </View>
);

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    borderBottomWidth: 1,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
  },
  scroll: { flex: 1 },
  content: {
    padding: spacingPixels[4],
    paddingBottom: spacingPixels[6],
    gap: spacingPixels[3],
  },
  metaRow: {
    flexDirection: 'row',
    gap: spacingPixels[2],
    flexWrap: 'wrap',
  },
  modulePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1.5],
    paddingHorizontal: spacingPixels[2],
    paddingVertical: 4,
    borderRadius: radiusPixels.full,
    borderWidth: 1,
  },
  statusPill: {
    paddingHorizontal: spacingPixels[2],
    paddingVertical: 4,
    borderRadius: radiusPixels.full,
  },
  title: {
    marginTop: spacingPixels[1],
  },
  submitterLine: {
    marginTop: -spacingPixels[1],
  },
  messageBlock: {
    padding: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
  },
  detailRow: {
    gap: spacingPixels[1.5],
  },
  detailValueBox: {
    padding: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
  },
  detailValueBoxMultiline: {
    minHeight: 60,
  },
  sectionLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  screenshots: {
    gap: spacingPixels[2],
  },
  screenshotGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacingPixels[2],
  },
  screenshot: {
    width: 100,
    height: 100,
    borderRadius: radiusPixels.lg,
  },
  adminNote: {
    padding: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    gap: spacingPixels[1.5],
  },
  adminNoteHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
  },
  footer: {
    padding: spacingPixels[4],
    borderTopWidth: 1,
  },
  voteCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[2],
    paddingVertical: spacingPixels[3.5],
    borderRadius: radiusPixels.lg,
    borderWidth: 2,
  },
});

export default FeedbackDetailView;
