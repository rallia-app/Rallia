/**
 * TournamentListScaffold
 *
 * Shared presentational layer for the tournament list screens (public
 * discovery + my tournaments): status pill, tournament card, section headers,
 * and the loading / error / empty / list states around a FlatList.
 * Screens own data fetching and section grouping; this owns rendering.
 */

import React, { useMemo, useCallback, useState } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, RefreshControl, Image } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text, Skeleton } from '@rallia/shared-components';
import { getProfilePictureUrl, getTournamentLogoUrl } from '@rallia/shared-utils';
import {
  lightTheme,
  darkTheme,
  spacingPixels,
  radiusPixels,
  primary,
  secondary,
  accent,
  neutral,
  base,
} from '@rallia/design-system';
import { useTheme } from '@rallia/shared-hooks';
import type { TournamentListItem } from '@rallia/shared-services';
import type { Enums } from '@rallia/shared-types';

import { useTranslation, type TranslationKey } from '../../../hooks';

type Status = Enums<'tournament_status'>;

const STATUS_TONE: Record<Status, 'neutral' | 'positive' | 'active' | 'muted'> = {
  draft: 'neutral',
  registration_open: 'positive',
  registration_closed: 'neutral',
  in_progress: 'active',
  completed: 'muted',
  cancelled: 'muted',
  archived: 'muted',
};

const ENTRY_FORMAT_KEYS: Record<Enums<'entry_format'>, string> = {
  singles: 'tournamentDetail.values.singles',
  doubles: 'tournamentDetail.values.doubles',
  mixed_doubles: 'tournamentDetail.values.mixedDoubles',
};

const MATCH_FORMAT_KEYS: Record<Enums<'match_format'>, string> = {
  one_set: 'tournamentDetail.values.oneSet',
  two_of_three: 'tournamentDetail.values.twoOfThree',
  three_of_five: 'tournamentDetail.values.threeOfFive',
  pickleball_to_11: 'tournamentDetail.values.pickleballTo11',
  pickleball_to_15: 'tournamentDetail.values.pickleballTo15',
  pickleball_to_21: 'tournamentDetail.values.pickleballTo21',
};

export interface TournamentListColors {
  background: string;
  cardBackground: string;
  cardBorder: string;
  text: string;
  textMuted: string;
  border: string;
  primary: string;
  avatarPlaceholder: string;
  avatarPlaceholderIcon: string;
  positiveBg: string;
  positiveText: string;
  activeBg: string;
  activeText: string;
  neutralBg: string;
  neutralText: string;
  mutedBg: string;
  mutedText: string;
  chipPrimaryBg: string;
  chipPrimaryText: string;
  chipSecondaryBg: string;
  chipSecondaryText: string;
  chipAccentBg: string;
  chipAccentText: string;
}

export function useTournamentListColors(): TournamentListColors {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const themeColors = isDark ? darkTheme : lightTheme;
  return useMemo<TournamentListColors>(() => {
    // MatchCard's color language: tinted primary card + translucent chips
    const chipAlpha = isDark ? '30' : '15';
    const chipPrimary = isDark ? primary[400] : primary[500];
    const chipSecondary = isDark ? secondary[400] : secondary[500];
    const chipAccent = isDark ? accent[400] : accent[500];
    return {
      background: themeColors.background,
      cardBackground: isDark ? primary[950] : primary[50],
      cardBorder: isDark ? `${primary[400]}40` : `${primary[500]}20`,
      text: themeColors.foreground,
      textMuted: themeColors.mutedForeground,
      border: themeColors.border,
      primary: isDark ? primary[400] : primary[500],
      avatarPlaceholder: isDark ? neutral[700] : neutral[200],
      avatarPlaceholderIcon: isDark ? neutral[400] : neutral[500],
      positiveBg: isDark ? '#16a34a30' : '#dcfce7',
      positiveText: isDark ? '#86efac' : '#15803d',
      activeBg: isDark ? `${primary[500]}30` : `${primary[600]}20`,
      activeText: isDark ? primary[300] : primary[700],
      neutralBg: isDark ? neutral[700] : neutral[200],
      neutralText: isDark ? neutral[100] : neutral[700],
      mutedBg: isDark ? neutral[800] : neutral[100],
      mutedText: isDark ? neutral[400] : neutral[500],
      chipPrimaryBg: `${chipPrimary}${chipAlpha}`,
      chipPrimaryText: chipPrimary,
      chipSecondaryBg: `${chipSecondary}${chipAlpha}`,
      chipSecondaryText: chipSecondary,
      chipAccentBg: `${chipAccent}${chipAlpha}`,
      chipAccentText: chipAccent,
    };
  }, [themeColors, isDark]);
}

// =============================================================================

const StatusPill: React.FC<{
  status: Status;
  colors: TournamentListColors;
  t: (k: TranslationKey) => string;
}> = ({ status, colors, t }) => {
  const tone = STATUS_TONE[status];
  const bg =
    tone === 'positive'
      ? colors.positiveBg
      : tone === 'active'
        ? colors.activeBg
        : tone === 'muted'
          ? colors.mutedBg
          : colors.neutralBg;
  const fg =
    tone === 'positive'
      ? colors.positiveText
      : tone === 'active'
        ? colors.activeText
        : tone === 'muted'
          ? colors.mutedText
          : colors.neutralText;
  return (
    <View style={[styles.statusPill, { backgroundColor: bg }]}>
      <Text size="xs" weight="semibold" color={fg}>
        {t(`tournamentDetail.status.${status}`)}
      </Text>
    </View>
  );
};

const MetaChip: React.FC<{
  label: string;
  colors: TournamentListColors;
  icon?: keyof typeof Ionicons.glyphMap;
  tone?: 'primary' | 'secondary' | 'accent';
}> = ({ label, colors, icon, tone = 'primary' }) => {
  const bg =
    tone === 'secondary'
      ? colors.chipSecondaryBg
      : tone === 'accent'
        ? colors.chipAccentBg
        : colors.chipPrimaryBg;
  const fg =
    tone === 'secondary'
      ? colors.chipSecondaryText
      : tone === 'accent'
        ? colors.chipAccentText
        : colors.chipPrimaryText;
  return (
    <View style={[styles.metaChip, { backgroundColor: bg }]}>
      {icon && <Ionicons name={icon} size={12} color={fg} />}
      <Text size="xs" weight="semibold" color={fg}>
        {label}
      </Text>
    </View>
  );
};

function formatRatingRange(min: number | null, max: number | null): string | null {
  const fmt = (v: number) => Number(v).toFixed(1);
  if (min != null && max != null) return min === max ? fmt(min) : `${fmt(min)}–${fmt(max)}`;
  if (min != null) return `${fmt(min)}+`;
  if (max != null) return `≤ ${fmt(max)}`;
  return null;
}

const AVATARS_SHOWN = 4;

/** Stacked faces of the earliest registrants, mirroring the game card. */
const RegistrantAvatars: React.FC<{
  preview: TournamentListItem['registrant_preview'];
  total: number;
  colors: TournamentListColors;
}> = ({ preview, total, colors }) => {
  if (preview.length === 0) return null;
  const shown = preview.slice(0, AVATARS_SHOWN);
  const extra = total - shown.length;
  return (
    <View style={styles.avatarsRow}>
      {shown.map((r, i) => {
        const uri = getProfilePictureUrl(r.avatarUrl);
        return (
          <View
            key={r.id}
            style={[
              styles.avatarSlot,
              i > 0 && styles.avatarSlotOverlap,
              {
                backgroundColor: uri ? colors.cardBackground : colors.avatarPlaceholder,
                borderColor: colors.primary,
              },
            ]}
          >
            {uri ? (
              <Image source={{ uri }} style={styles.avatarImg} />
            ) : (
              <Ionicons name="person-outline" size={14} color={colors.avatarPlaceholderIcon} />
            )}
          </View>
        );
      })}
      {extra > 0 && (
        <View
          style={[
            styles.avatarSlot,
            styles.avatarSlotOverlap,
            { backgroundColor: colors.primary, borderColor: colors.primary },
          ]}
        >
          <Text size="xs" weight="semibold" color={base.white} style={styles.avatarExtraText}>
            +{extra}
          </Text>
        </View>
      )}
    </View>
  );
};

export const TournamentCard: React.FC<{
  tournament: TournamentListItem;
  colors: TournamentListColors;
  locale: string;
  t: (k: TranslationKey) => string;
  onPress: () => void;
  isOrganizer?: boolean;
  /** Decorative sport icon rendered as a faint card watermark. */
  watermark?: React.ReactNode;
}> = ({ tournament, colors, locale, t, onPress, isOrganizer, watermark }) => {
  const fmtDate = useCallback(
    (iso: string) => new Date(iso).toLocaleDateString(locale, { month: 'short', day: 'numeric' }),
    [locale]
  );

  const dateRange = useMemo(() => {
    const sameDay = tournament.start_date.slice(0, 10) === tournament.end_date.slice(0, 10);
    if (sameDay) return fmtDate(tournament.start_date);
    return t('tournamentList.dateRange')
      .replace('{start}', fmtDate(tournament.start_date))
      .replace('{end}', fmtDate(tournament.end_date));
  }, [tournament.start_date, tournament.end_date, fmtDate, t]);

  const registerBy =
    tournament.status === 'registration_open' && tournament.registration_closes_at
      ? t('tournamentList.registerBy').replace('{date}', fmtDate(tournament.registration_closes_at))
      : null;

  const ratingRange = formatRatingRange(tournament.min_rating, tournament.max_rating);
  const hasRegistrants = tournament.registrant_preview.length > 0;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      testID={`tournament-card-${tournament.id}`}
      style={[
        styles.card,
        { backgroundColor: colors.cardBackground, borderColor: colors.cardBorder },
      ]}
    >
      {watermark && (
        <View style={styles.watermark} pointerEvents="none">
          {watermark}
        </View>
      )}

      {tournament.logo_url ? (
        <Image
          source={{ uri: getTournamentLogoUrl(tournament.logo_url) ?? tournament.logo_url }}
          style={styles.cardBanner}
          resizeMode="cover"
        />
      ) : null}

      <View style={styles.cardTopRow}>
        <RegistrantAvatars
          preview={tournament.registrant_preview}
          total={tournament.registration_count}
          colors={colors}
        />
        <View style={hasRegistrants ? styles.cardStatusSlot : undefined}>
          <StatusPill status={tournament.status} colors={colors} t={t} />
        </View>
      </View>

      <Text size="base" weight="semibold" color={colors.text} numberOfLines={1}>
        {tournament.name}
      </Text>

      <View style={styles.cardMetaLine}>
        <Ionicons name="calendar-outline" size={14} color={colors.primary} />
        <Text size="xs" color={colors.textMuted}>
          {dateRange}
        </Text>
        {registerBy && (
          <>
            <View style={styles.metaSeparator} />
            <Ionicons name="time-outline" size={14} color={colors.positiveText} />
            <Text size="xs" weight="medium" color={colors.positiveText}>
              {registerBy}
            </Text>
          </>
        )}
      </View>

      {tournament.venue_name && (
        <View style={styles.cardMetaLine}>
          <Ionicons name="location" size={14} color={colors.textMuted} />
          <Text size="xs" color={colors.textMuted} numberOfLines={1} style={styles.venueText}>
            {tournament.venue_name}
          </Text>
        </View>
      )}

      {/* Importance order: role, eligibility (rating), what you play, room left, details.
          Horizontally scrollable so the chips always stay on a single row. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        nestedScrollEnabled
        style={styles.chipScroll}
        contentContainerStyle={styles.chipScrollContent}
      >
        {isOrganizer && (
          <MetaChip
            label={t('tournamentList.roleOrganizer')}
            icon="person-outline"
            colors={colors}
            tone="accent"
          />
        )}
        {ratingRange && (
          <MetaChip label={ratingRange} icon="analytics" colors={colors} tone="secondary" />
        )}
        <MetaChip
          label={t(ENTRY_FORMAT_KEYS[tournament.entry_format] as TranslationKey)}
          colors={colors}
        />
        <MetaChip
          label={`${tournament.registration_count}/${tournament.max_participants}`}
          icon="people-outline"
          colors={colors}
        />
        <MetaChip
          label={t(MATCH_FORMAT_KEYS[tournament.match_format] as TranslationKey)}
          colors={colors}
        />
        {tournament.level && <MetaChip label={tournament.level} colors={colors} />}
      </ScrollView>
    </TouchableOpacity>
  );
};

/**
 * Loading placeholder following MatchCardSkeleton's primary-tinted recipe,
 * shaped like a TournamentCard (title + status pill, meta lines, chip row).
 */
export const TournamentCardSkeleton: React.FC = () => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const bone = isDark ? primary[900] : primary[100];
  const boneHighlight = isDark ? primary[800] : primary[50];
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: isDark ? primary[950] : primary[50],
          borderColor: isDark ? `${primary[400]}40` : `${primary[500]}20`,
        },
      ]}
    >
      <View style={styles.cardHeader}>
        <Skeleton width="55%" height={18} backgroundColor={bone} highlightColor={boneHighlight} />
        <Skeleton
          width={88}
          height={22}
          borderRadius={radiusPixels.full}
          backgroundColor={bone}
          highlightColor={boneHighlight}
        />
      </View>
      <Skeleton width="45%" height={12} backgroundColor={bone} highlightColor={boneHighlight} />
      <Skeleton width="35%" height={12} backgroundColor={bone} highlightColor={boneHighlight} />
      <View style={styles.chipRow}>
        {[56, 72, 64].map(w => (
          <Skeleton
            key={w}
            width={w}
            height={24}
            borderRadius={radiusPixels.full}
            backgroundColor={bone}
            highlightColor={boneHighlight}
          />
        ))}
      </View>
    </View>
  );
};

export interface TournamentSection {
  titleKey: TranslationKey;
  items: TournamentListItem[];
}

interface TournamentListScaffoldProps {
  sections: TournamentSection[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<unknown>;
  emptyIcon?: keyof typeof Ionicons.glyphMap;
  emptyTitleKey: TranslationKey;
  emptyDescriptionKey: TranslationKey;
  /** Rendered above the list content in every state (e.g. a nav button). */
  header?: React.ReactNode;
  /** Marks cards the caller organizes with an accent chip. */
  currentUserId?: string;
  /** Decorative sport icon rendered as a faint watermark on every card. */
  cardWatermark?: React.ReactNode;
  onPressTournament: (tournament: TournamentListItem) => void;
}

export const TournamentListScaffold: React.FC<TournamentListScaffoldProps> = ({
  sections,
  isLoading,
  isError,
  refetch,
  emptyIcon = 'trophy-outline',
  emptyTitleKey,
  emptyDescriptionKey,
  header,
  currentUserId,
  cardWatermark,
  onPressTournament,
}) => {
  const { t, locale } = useTranslation();
  const colors = useTournamentListColors();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  let body: React.ReactNode;
  if (isLoading) {
    body = (
      <View style={styles.skeletonList}>
        {[1, 2, 3, 4, 5].map(i => (
          <TournamentCardSkeleton key={i} />
        ))}
      </View>
    );
  } else if (isError) {
    body = (
      <View style={styles.centered}>
        <Ionicons name="alert-circle-outline" size={48} color={colors.textMuted} />
        <Text size="base" weight="semibold" color={colors.text} style={styles.centeredText}>
          {t('tournamentList.loadError')}
        </Text>
        <TouchableOpacity
          onPress={() => void refetch()}
          style={[styles.retryButton, { backgroundColor: colors.primary }]}
        >
          <Text size="base" weight="semibold" color="#ffffff">
            {t('tournamentList.retry')}
          </Text>
        </TouchableOpacity>
      </View>
    );
  } else if (sections.length === 0) {
    body = (
      <View style={styles.centered}>
        <Ionicons name={emptyIcon} size={48} color={colors.textMuted} />
        <Text size="base" weight="semibold" color={colors.text} style={styles.centeredText}>
          {t(emptyTitleKey)}
        </Text>
        <Text size="sm" color={colors.textMuted} style={styles.centeredSubtext}>
          {t(emptyDescriptionKey)}
        </Text>
      </View>
    );
  } else {
    type Item =
      | { kind: 'header'; title: string; key: string }
      | { kind: 'row'; tournament: TournamentListItem; key: string };
    const data: Item[] = [];
    for (const s of sections) {
      data.push({ kind: 'header', title: t(s.titleKey), key: `h-${s.titleKey}` });
      for (const tn of s.items) data.push({ kind: 'row', tournament: tn, key: `r-${tn.id}` });
    }

    body = (
      <FlatList
        data={data}
        keyExtractor={item => item.key}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void handleRefresh()}
            tintColor={colors.primary}
          />
        }
        renderItem={({ item }) => {
          if (item.kind === 'header') {
            return (
              <View style={[styles.sectionHeader, { backgroundColor: colors.background }]}>
                <Text size="sm" weight="semibold" color={colors.textMuted}>
                  {item.title}
                </Text>
              </View>
            );
          }
          return (
            <TournamentCard
              tournament={item.tournament}
              colors={colors}
              locale={locale}
              t={t}
              isOrganizer={!!currentUserId && item.tournament.organizer_id === currentUserId}
              watermark={cardWatermark}
              onPress={() => onPressTournament(item.tournament)}
            />
          );
        }}
      />
    );
  }

  return (
    <SafeAreaView edges={[]} style={[styles.root, { backgroundColor: colors.background }]}>
      {header}
      {body}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacingPixels[6],
  },
  centeredText: { marginTop: spacingPixels[3], textAlign: 'center' },
  centeredSubtext: { marginTop: spacingPixels[2], textAlign: 'center' },
  retryButton: {
    marginTop: spacingPixels[4],
    paddingHorizontal: spacingPixels[5],
    paddingVertical: spacingPixels[3],
    borderRadius: radiusPixels.lg,
  },
  listContent: {
    paddingTop: spacingPixels[2],
    paddingBottom: spacingPixels[5],
  },
  sectionHeader: {
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[2],
    marginBottom: spacingPixels[1],
  },
  cardBanner: {
    height: 120,
    marginTop: -spacingPixels[4],
    marginHorizontal: -spacingPixels[4],
  },
  card: {
    marginHorizontal: spacingPixels[4],
    marginBottom: spacingPixels[3],
    padding: spacingPixels[4],
    borderRadius: radiusPixels.xl,
    borderWidth: 1.5,
    gap: spacingPixels[2],
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 5,
  },
  skeletonList: {
    flex: 1,
    paddingTop: spacingPixels[2],
  },
  watermark: {
    position: 'absolute',
    right: spacingPixels[3],
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    opacity: 0.12,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingPixels[3],
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardStatusSlot: {
    marginLeft: 'auto',
  },
  cardMetaLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
  },
  venueText: {
    flex: 1,
  },
  metaSeparator: {
    width: 1,
    height: 12,
    backgroundColor: 'rgba(128,128,128,0.3)',
    marginHorizontal: spacingPixels[1.5],
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacingPixels[1.5],
    marginTop: spacingPixels[0.5],
  },
  chipScroll: {
    marginTop: spacingPixels[0.5],
    flexGrow: 0,
  },
  chipScrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1.5],
    paddingRight: spacingPixels[1],
  },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.full,
  },
  avatarsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarSlot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    overflow: 'hidden',
  },
  avatarSlotOverlap: {
    marginLeft: -6,
  },
  avatarImg: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  avatarExtraText: {
    lineHeight: 15,
    includeFontPadding: false,
    textAlign: 'center',
    textAlignVertical: 'center',
  },
  statusPill: {
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[0.5],
    borderRadius: radiusPixels.full,
  },
});
