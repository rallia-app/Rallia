/**
 * BoardKit — shared visual kit for the Classements boards
 *
 * Header, list rows and the caller's gradient standing card, shared by the
 * monthly challenge and Points Rallia tabs so both boards feel like one
 * polished surface. Deliberately no podium/medal treatment — every rank
 * renders as a uniform row (participation-first philosophy). Purely
 * presentational — data shaping stays in the screens.
 */

import React from 'react';
import { View, StyleSheet, Image, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, primary, shadowsNative } from '@rallia/design-system';

export interface BoardEntry {
  id: string;
  rank: number;
  name: string;
  avatarUrl: string | null;
  /** Big number shown for the entry (games or points). */
  value: number;
  /** Optional small line under the name (e.g. "3 tournaments"). */
  subtitle?: string;
  isMe: boolean;
}

interface ThemeBits {
  isDark: boolean;
  cardColor: string;
  borderColor: string;
  textColor: string;
  mutedColor: string;
  inputColor: string;
}

/** List row — every rank renders the same way. */
export function BoardRow({
  entry,
  valueLabel,
  theme,
  onPress,
}: {
  entry: BoardEntry;
  valueLabel: string;
  theme: ThemeBits;
  onPress?: (entry: BoardEntry) => void;
}) {
  const accentColor = theme.isDark ? primary[300] : primary[600];
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPress ? () => onPress(entry) : undefined}
      style={[
        styles.row,
        { backgroundColor: theme.cardColor, borderColor: theme.borderColor },
        entry.isMe
          ? {
              backgroundColor: theme.isDark ? `${primary[700]}33` : primary[50],
              borderColor: primary[400],
            }
          : null,
      ]}
    >
      <View style={styles.rankBadge}>
        <Text
          size="sm"
          weight={entry.rank <= 10 ? 'semibold' : 'medium'}
          color={entry.rank <= 10 ? accentColor : theme.mutedColor}
        >
          {entry.rank}
        </Text>
      </View>

      {entry.avatarUrl ? (
        <Image source={{ uri: entry.avatarUrl }} style={styles.avatar} />
      ) : (
        <View
          style={[
            styles.avatar,
            styles.avatarFallback,
            { backgroundColor: theme.isDark ? theme.inputColor : theme.borderColor },
          ]}
        >
          <Ionicons name="person" size={18} color={theme.mutedColor} />
        </View>
      )}

      <View style={styles.nameCol}>
        <Text size="base" weight="semibold" color={theme.textColor} numberOfLines={1}>
          {entry.name}
        </Text>
        {entry.subtitle ? (
          <Text size="xs" color={theme.mutedColor} numberOfLines={1}>
            {entry.subtitle}
          </Text>
        ) : null}
      </View>

      <View style={styles.valueCol}>
        <Text size="xl" weight="bold" color={accentColor}>
          {entry.value.toLocaleString()}
        </Text>
        <Text size="xs" color={theme.mutedColor} style={styles.valueLabel}>
          {valueLabel}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

/** The caller's own standing — teal gradient hero card. */
export function MyStandingCard({
  rank,
  title,
  subtitle,
  value,
  valueLabel,
}: {
  rank: number;
  title: string;
  subtitle: string;
  value: number;
  valueLabel: string;
}) {
  return (
    <View style={styles.standingShadow}>
      <LinearGradient
        colors={[primary[600], primary[700], primary[800]]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.standingCard}
      >
        <Ionicons
          name="podium"
          size={64}
          color="rgba(255,255,255,0.10)"
          style={styles.standingWatermark}
        />
        <View style={styles.standingBadge}>
          <Text size="base" weight="bold" color="#ffffff">
            {`#${rank}`}
          </Text>
        </View>
        <View style={styles.standingTextCol}>
          <Text size="base" weight="bold" color="#ffffff" numberOfLines={1}>
            {title}
          </Text>
          <Text size="sm" color="rgba(255,255,255,0.78)" numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
        <View style={styles.valueCol}>
          <Text size="xl" weight="bold" color="#ffffff">
            {value.toLocaleString()}
          </Text>
          <Text size="xs" color="rgba(255,255,255,0.78)" style={styles.valueLabel}>
            {valueLabel}
          </Text>
        </View>
      </LinearGradient>
    </View>
  );
}

/** Imposing board header — gradient icon badge, big title, season/scope line. */
export function BoardHeader({
  icon,
  title,
  subtitle,
  note,
  onNotePress,
  noteCtaLabel,
  theme,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  note: string;
  /** When set (with noteCtaLabel), renders a tappable CTA pill under the note. */
  onNotePress?: () => void;
  /** Label for the CTA pill, e.g. "How it works". */
  noteCtaLabel?: string;
  theme: ThemeBits;
}) {
  const accentColor = theme.isDark ? primary[300] : primary[600];
  return (
    <View style={styles.headerBlock}>
      <View style={styles.headerRow}>
        <View style={styles.headerIconShadow}>
          <LinearGradient
            colors={[primary[500], primary[700]]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.headerIcon}
          >
            <Ionicons name={icon} size={24} color="#ffffff" />
          </LinearGradient>
        </View>
        <View style={styles.headerTextCol}>
          <Text size={22} weight="bold" color={theme.textColor} numberOfLines={1}>
            {title}
          </Text>
          <Text size="sm" weight="semibold" color={accentColor} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
      </View>
      <Text size="sm" color={theme.mutedColor} style={styles.headerNote}>
        {note}
      </Text>
      {onNotePress && noteCtaLabel ? (
        <TouchableOpacity
          onPress={onNotePress}
          activeOpacity={0.7}
          accessibilityRole="button"
          style={styles.headerCta}
        >
          <Ionicons name="information-circle" size={16} color={accentColor} />
          <Text size="sm" weight="bold" color={accentColor} style={styles.headerCtaText}>
            {noteCtaLabel}
          </Text>
          <Ionicons name="arrow-forward" size={15} color={accentColor} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

/** Friendly empty state with a tinted icon disc. */
export function BoardEmptyState({
  icon,
  title,
  description,
  theme,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  theme: ThemeBits;
}) {
  const accentColor = theme.isDark ? primary[300] : primary[600];
  return (
    <View style={styles.emptyWrap}>
      <View
        style={[
          styles.emptyDisc,
          { backgroundColor: theme.isDark ? `${primary[700]}44` : primary[50] },
        ]}
      >
        <Ionicons name={icon} size={34} color={accentColor} />
      </View>
      <Text size="base" weight="semibold" color={theme.textColor}>
        {title}
      </Text>
      <Text size="sm" color={theme.mutedColor} style={styles.emptyText}>
        {description}
      </Text>
    </View>
  );
}

export type { ThemeBits };

const styles = StyleSheet.create({
  // Rows
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    marginBottom: spacingPixels[2],
    ...shadowsNative.sm,
  },
  rankBadge: {
    width: 30,
    height: 26,
    borderRadius: radiusPixels.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: radiusPixels.full,
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameCol: {
    flex: 1,
    gap: 2,
  },
  valueCol: {
    alignItems: 'flex-end',
    minWidth: 52,
  },
  valueLabel: {
    marginTop: -2,
  },

  // Standing card
  standingShadow: {
    borderRadius: radiusPixels.xl,
    marginTop: spacingPixels[2],
    shadowColor: primary[700],
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
  },
  standingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
    padding: spacingPixels[4],
    borderRadius: radiusPixels.xl,
    overflow: 'hidden',
  },
  standingWatermark: {
    position: 'absolute',
    right: -6,
    bottom: -12,
  },
  standingBadge: {
    minWidth: 46,
    height: 46,
    paddingHorizontal: spacingPixels[2],
    borderRadius: radiusPixels.lg,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  standingTextCol: {
    flex: 1,
    gap: 2,
  },

  // Header
  headerBlock: {
    gap: spacingPixels[2],
    marginBottom: spacingPixels[1],
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
  },
  headerIconShadow: {
    borderRadius: radiusPixels.xl,
    shadowColor: primary[700],
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  headerIcon: {
    width: 48,
    height: 48,
    borderRadius: radiusPixels.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextCol: {
    flex: 1,
    gap: 2,
  },
  headerNote: {
    lineHeight: 19,
  },
  headerCta: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacingPixels[1],
    marginTop: spacingPixels[2],
  },
  headerCtaText: {
    textDecorationLine: 'underline',
  },

  // Empty
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacingPixels[6],
    gap: spacingPixels[2],
  },
  emptyDisc: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacingPixels[1],
  },
  emptyText: {
    textAlign: 'center',
  },
});
