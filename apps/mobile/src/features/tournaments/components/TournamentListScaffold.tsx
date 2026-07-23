/**
 * TournamentListScaffold
 *
 * Shared presentational layer for the tournament list screens (public
 * discovery + my tournaments): status pill, tournament card, section headers,
 * and the loading / error / empty / list states around a FlatList.
 * Screens own data fetching and section grouping; this owns rendering.
 */

import React, { useMemo, useCallback, useState } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Image,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Text, Skeleton } from '@rallia/shared-components';
import { getProfilePictureUrl, formatPrice, tournamentRankingHeadline } from '@rallia/shared-utils';
import {
  lightTheme,
  darkTheme,
  spacingPixels,
  radiusPixels,
  primary,
  secondary,
  accent,
  neutral,
} from '@rallia/design-system';
import { useTheme } from '@rallia/shared-hooks';
import type { TournamentListItem } from '@rallia/shared-services';
import type { Enums } from '@rallia/shared-types';

import { useTranslation, type TranslationKey } from '../../../hooks';
import { TournamentBanner, TOURNAMENT_BANNER_ASPECT } from './TournamentBanner';

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

// Fixed light-tone text colors for pills sitting on the banner image: the
// pill background is near-white there regardless of theme.
const ON_IMAGE_TONE_TEXT: Record<'neutral' | 'positive' | 'active' | 'muted', string> = {
  positive: '#15803d',
  active: primary[700],
  neutral: neutral[700],
  muted: neutral[500],
};

const StatusPill: React.FC<{
  status: Status;
  colors: TournamentListColors;
  t: (k: TranslationKey) => string;
  onImage?: boolean;
}> = ({ status, colors, t, onImage }) => {
  const tone = STATUS_TONE[status];
  const bg = onImage
    ? 'rgba(255,255,255,0.94)'
    : tone === 'positive'
      ? colors.positiveBg
      : tone === 'active'
        ? colors.activeBg
        : tone === 'muted'
          ? colors.mutedBg
          : colors.neutralBg;
  const fg = onImage
    ? ON_IMAGE_TONE_TEXT[tone]
    : tone === 'positive'
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
const AVATAR_SIZE = 24;

/** Stacked registrant faces with a quiet fill count beside the stack. */
const RegistrationStrip: React.FC<{
  preview: TournamentListItem['registrant_preview'];
  total: number;
  maxParticipants: number;
  colors: TournamentListColors;
}> = ({ preview, total, maxParticipants, colors }) => {
  const shown = preview.slice(0, AVATARS_SHOWN);
  const isFull = total >= maxParticipants;

  return (
    <View style={styles.registrationStrip}>
      {shown.length > 0 && (
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
                    borderColor: colors.cardBackground,
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
        </View>
      )}
      <View style={styles.fillCount}>
        <Ionicons
          name="people-outline"
          size={13}
          color={isFull ? colors.mutedText : colors.chipPrimaryText}
        />
        <Text
          size="xs"
          weight="semibold"
          color={isFull ? colors.mutedText : colors.chipPrimaryText}
        >
          {total}/{maxParticipants}
        </Text>
      </View>
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
}> = ({ tournament, colors, locale, t, onPress, isOrganizer }) => {
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
  const [mountedAt] = useState(() => Date.now());
  const registerByUrgent =
    tournament.status === 'registration_open' &&
    tournament.registration_closes_at != null &&
    new Date(tournament.registration_closes_at).getTime() - mountedAt < 48 * 3600 * 1000;

  const ratingRange = formatRatingRange(tournament.min_rating, tournament.max_rating);
  // Only a certified organizer's tournament awards points (same gate as the
  // detail screen) — never advertise points the event can't pay.
  const rankingHeadline = tournament.organizer_is_certified
    ? tournamentRankingHeadline(tournament)
    : null;
  // Always the champion figure, projected or not: the chip is a headline, and
  // the Points tab carries the "up to" nuance.
  const rankingLabel = rankingHeadline
    ? t('tournamentList.rankingPoints').replace('{points}', String(rankingHeadline.points))
    : null;
  const prizeLabel =
    tournament.prize_money_cents && tournament.prize_money_cents > 0
      ? formatPrice(tournament.prize_money_cents, tournament.currency, {
          locale,
          trimZeroCents: true,
        })
      : null;
  const venue = tournament.venue_name || tournament.city;

  // Quiet decision facts, dot-separated; special facts (points, role) keep a chip.
  // `level` is deliberately left out: the rating range already says who can enter.
  const metaFacts = [
    ratingRange,
    t(ENTRY_FORMAT_KEYS[tournament.entry_format] as TranslationKey),
    t(MATCH_FORMAT_KEYS[tournament.match_format] as TranslationKey),
  ].filter((f): f is string => !!f);

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
      <View style={styles.bannerWrap}>
        <TournamentBanner logoUrl={tournament.logo_url} />
        <View style={styles.bannerTopRow}>
          <StatusPill status={tournament.status} colors={colors} t={t} onImage />
          {/* What the event is worth, both currencies together: cash in the
              solid gold pill, Circuit Rallia points in the lighter one. */}
          <View style={styles.bannerBadges}>
            {prizeLabel && (
              <View style={styles.prizeBadge}>
                <Ionicons name="trophy" size={12} color={accent[900]} />
                <Text size="xs" weight="semibold" color={accent[900]} numberOfLines={1}>
                  {prizeLabel}
                </Text>
              </View>
            )}
            {rankingLabel && (
              <View style={styles.pointsBadge}>
                <Ionicons name="ribbon" size={12} color={accent[700]} />
                <Text size="xs" weight="semibold" color={accent[700]} numberOfLines={1}>
                  {rankingLabel}
                </Text>
              </View>
            )}
          </View>
        </View>
        {/* Scrim is deliberately shallow and light: it only has to carry two
            lines, and the text shadow does the rest of the legibility work, so
            the artwork stays visible. */}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.28)', 'rgba(0,0,0,0.66)']}
          locations={[0, 0.42, 1]}
          style={styles.bannerScrim}
        >
          <Text
            size="base"
            weight="semibold"
            color="#ffffff"
            numberOfLines={1}
            style={styles.scrimText}
          >
            {tournament.name}
          </Text>
          <Text size="xs" color="rgba(255,255,255,0.92)" numberOfLines={1} style={styles.scrimText}>
            {venue ? `${dateRange} · ${venue}` : dateRange}
          </Text>
        </LinearGradient>
      </View>

      <View style={styles.cardBody}>
        <View style={styles.metaRow}>
          {metaFacts.map((fact, i) => (
            <React.Fragment key={`${i}-${fact}`}>
              {i > 0 && (
                <Text size="xs" color={colors.textMuted}>
                  ·
                </Text>
              )}
              <View style={styles.metaItem}>
                {i === 0 && ratingRange && (
                  <Ionicons name="analytics" size={13} color={colors.primary} />
                )}
                <Text size="xs" weight="medium" color={colors.textMuted}>
                  {fact}
                </Text>
              </View>
            </React.Fragment>
          ))}
          {isOrganizer && (
            <MetaChip
              label={t('tournamentList.roleOrganizer')}
              icon="person-outline"
              colors={colors}
              tone="accent"
            />
          )}
        </View>

        <View style={[styles.cardFooter, { borderTopColor: colors.cardBorder }]}>
          <RegistrationStrip
            preview={tournament.registrant_preview}
            total={tournament.registration_count}
            maxParticipants={tournament.max_participants}
            colors={colors}
          />
          {registerBy && (
            <View style={styles.registerByWrap}>
              <Text
                size="xs"
                weight="semibold"
                color={registerByUrgent ? colors.chipSecondaryText : colors.positiveText}
              >
                {registerBy}
              </Text>
              <Ionicons
                name="chevron-forward"
                size={13}
                color={registerByUrgent ? colors.chipSecondaryText : colors.positiveText}
              />
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
};

/**
 * Loading placeholder following MatchCardSkeleton's primary-tinted recipe,
 * shaped like a TournamentCard (banner block, meta line, footer row).
 */
export const TournamentCardSkeleton: React.FC = () => {
  const { theme } = useTheme();
  const { width } = useWindowDimensions();
  const isDark = theme === 'dark';
  // Skeleton takes a numeric height, so mirror the card banner's 16:9 box.
  const bannerHeight = Math.round((width - spacingPixels[4] * 2) / TOURNAMENT_BANNER_ASPECT);
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
      <Skeleton
        width="100%"
        height={bannerHeight}
        backgroundColor={bone}
        highlightColor={boneHighlight}
      />
      <View style={styles.cardBody}>
        <Skeleton width="65%" height={12} backgroundColor={bone} highlightColor={boneHighlight} />
        <View style={styles.cardHeader}>
          <Skeleton width={96} height={20} backgroundColor={bone} highlightColor={boneHighlight} />
          <Skeleton width={110} height={12} backgroundColor={bone} highlightColor={boneHighlight} />
        </View>
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

  type Item =
    | { kind: 'header'; title: string; key: string }
    | { kind: 'row'; tournament: TournamentListItem; key: string };
  const data = useMemo<Item[]>(() => {
    if (isLoading || isError) return [];
    const out: Item[] = [];
    for (const s of sections) {
      out.push({ kind: 'header', title: t(s.titleKey), key: `h-${s.titleKey}` });
      for (const tn of s.items) out.push({ kind: 'row', tournament: tn, key: `r-${tn.id}` });
    }
    return out;
  }, [isLoading, isError, sections, t]);

  let emptyComponent: React.ReactNode;
  if (isLoading) {
    emptyComponent = (
      <View style={styles.skeletonList}>
        {[1, 2, 3, 4, 5].map(i => (
          <TournamentCardSkeleton key={i} />
        ))}
      </View>
    );
  } else if (isError) {
    emptyComponent = (
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
  } else {
    emptyComponent = (
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
  }

  return (
    <SafeAreaView edges={[]} style={[styles.root, { backgroundColor: colors.background }]}>
      <FlatList
        data={data}
        keyExtractor={item => item.key}
        contentContainerStyle={[
          styles.listContent,
          data.length === 0 && !isLoading && styles.emptyListContent,
        ]}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={header ? <>{header}</> : null}
        ListEmptyComponent={emptyComponent}
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
              onPress={() => onPressTournament(item.tournament)}
            />
          );
        }}
      />
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
    flexGrow: 1,
  },
  emptyListContent: {
    justifyContent: 'center',
    minHeight: '100%',
  },
  sectionHeader: {
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[2],
    marginBottom: spacingPixels[1],
  },
  bannerWrap: {
    position: 'relative',
  },
  bannerTopRow: {
    position: 'absolute',
    top: spacingPixels[2.5],
    left: spacingPixels[2.5],
    right: spacingPixels[2.5],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingPixels[2],
  },
  bannerBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    marginLeft: 'auto',
    flexShrink: 1,
  },
  prizeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[0.5],
    borderRadius: radiusPixels.full,
    backgroundColor: accent[300],
  },
  pointsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[0.5],
    borderRadius: radiusPixels.full,
    backgroundColor: 'rgba(255,255,255,0.94)',
  },
  bannerScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacingPixels[3],
    paddingTop: spacingPixels[2],
    paddingBottom: spacingPixels[2],
    gap: 1,
  },
  scrimText: {
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 5,
  },
  cardBody: {
    paddingHorizontal: spacingPixels[3],
    paddingTop: spacingPixels[2.5],
    paddingBottom: spacingPixels[3],
    gap: spacingPixels[2.5],
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacingPixels[1.5],
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingPixels[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacingPixels[2.5],
  },
  registerByWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  card: {
    marginHorizontal: spacingPixels[4],
    marginBottom: spacingPixels[3],
    borderRadius: radiusPixels.xl,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  skeletonList: {
    paddingTop: spacingPixels[2],
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingPixels[3],
  },
  registrationStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1.5],
    flexShrink: 1,
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
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    overflow: 'hidden',
  },
  avatarSlotOverlap: {
    marginLeft: -6,
  },
  avatarImg: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
  },
  fillCount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
  },
  statusPill: {
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[0.5],
    borderRadius: radiusPixels.full,
  },
});
