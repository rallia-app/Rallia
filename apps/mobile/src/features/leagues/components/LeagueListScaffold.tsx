/**
 * LeagueListScaffold — shared list UI for public discovery + my leagues.
 */

import React, { useCallback, useMemo, useState } from 'react';
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
import { getProfilePictureUrl } from '@rallia/shared-utils';
import { spacingPixels, radiusPixels, primary, neutral } from '@rallia/design-system';
import { useTheme } from '@rallia/shared-hooks';
import type { LeagueListItem } from '@rallia/shared-services';
import type { Enums } from '@rallia/shared-types';

import {
  useTournamentListColors,
  type TournamentListColors,
} from '../../tournaments/components/TournamentListScaffold';
import { useTranslation, useScrollBottomInset, type TranslationKey } from '../../../hooks';
import { LeagueBanner, LEAGUE_BANNER_ASPECT } from './LeagueBanner';

type LeagueStatus = Enums<'league_status'>;
type JoinMode = Enums<'tournament_registration_mode'>;
type Visibility = Enums<'tournament_visibility'>;

const LEAGUE_STATUS_TONE: Record<LeagueStatus, 'positive' | 'neutral' | 'muted'> = {
  active: 'positive',
  paused: 'neutral',
  closed: 'muted',
};

const JOIN_MODE_KEYS: Record<JoinMode, string> = {
  open: 'leagueDetail.values.open',
  approval: 'leagueDetail.values.approval',
  invite_only: 'leagueDetail.values.inviteOnly',
};
const VISIBILITY_KEYS: Record<Visibility, string> = {
  private: 'leagueDetail.values.private',
  public: 'leagueDetail.values.public',
  community: 'leagueDetail.values.community',
};

function formatRatingRange(min: number | null, max: number | null): string | null {
  const fmt = (v: number) => Number(v).toFixed(1);
  if (min != null && max != null) return min === max ? fmt(min) : `${fmt(min)}–${fmt(max)}`;
  if (min != null) return `${fmt(min)}+`;
  if (max != null) return `≤ ${fmt(max)}`;
  return null;
}

// Fixed light-tone text colors for the pill sitting on the banner image: the
// pill background is near-white there regardless of theme.
const ON_IMAGE_TONE_TEXT: Record<'positive' | 'neutral' | 'muted', string> = {
  positive: '#15803d',
  neutral: neutral[700],
  muted: neutral[500],
};

const StatusPill: React.FC<{
  status: LeagueStatus;
  colors: TournamentListColors;
  t: (k: TranslationKey) => string;
  onImage?: boolean;
}> = ({ status, colors, t, onImage }) => {
  const tone = LEAGUE_STATUS_TONE[status];
  const bg = onImage
    ? 'rgba(255,255,255,0.94)'
    : tone === 'positive'
      ? colors.positiveBg
      : tone === 'muted'
        ? colors.mutedBg
        : colors.neutralBg;
  const fg = onImage
    ? ON_IMAGE_TONE_TEXT[tone]
    : tone === 'positive'
      ? colors.positiveText
      : tone === 'muted'
        ? colors.mutedText
        : colors.neutralText;
  return (
    <View style={[styles.statusPill, { backgroundColor: bg }]}>
      <Text size="xs" weight="semibold" color={fg}>
        {t(`leagueDetail.status.${status}`)}
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

const AVATARS_SHOWN = 4;
const AVATAR_SIZE = 24;

/** Stacked member faces with a quiet count beside the stack. */
const MemberStrip: React.FC<{
  preview: LeagueListItem['member_preview'];
  total: number;
  capacity: number | null;
  colors: TournamentListColors;
}> = ({ preview, total, capacity, colors }) => {
  const shown = preview.slice(0, AVATARS_SHOWN);
  const isFull = capacity != null && total >= capacity;

  return (
    <View style={styles.memberStrip}>
      {shown.length > 0 && (
        <View style={styles.avatarsRow}>
          {shown.map((m, i) => {
            const uri = getProfilePictureUrl(m.avatarUrl);
            return (
              <View
                key={m.id}
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
          {capacity != null ? `${total}/${capacity}` : total}
        </Text>
      </View>
    </View>
  );
};

export const LeagueCard: React.FC<{
  league: LeagueListItem;
  colors: TournamentListColors;
  t: (k: TranslationKey, options?: Record<string, string | number>) => string;
  onPress: () => void;
  isOrganizer?: boolean;
}> = ({ league, colors, t, onPress, isOrganizer }) => {
  const ratingRange = formatRatingRange(league.min_rating, league.max_rating);

  const joinHighlight = useMemo(() => {
    if (league.join_mode !== 'open' || league.status !== 'active') return null;
    return t(JOIN_MODE_KEYS.open as TranslationKey);
  }, [league.join_mode, league.status, t]);

  // Quiet decision facts, dot-separated; special facts (role) keep a chip.
  const metaFacts = [
    ratingRange,
    t(JOIN_MODE_KEYS[league.join_mode] as TranslationKey),
    t(VISIBILITY_KEYS[league.visibility] as TranslationKey),
    league.level,
  ].filter((f): f is string => !!f);

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      testID={`league-card-${league.id}`}
      style={[
        styles.card,
        { backgroundColor: colors.cardBackground, borderColor: colors.cardBorder },
      ]}
    >
      <View style={styles.bannerWrap}>
        <LeagueBanner logoUrl={league.logo_url} />
        <View style={styles.bannerTopRow}>
          <StatusPill status={league.status} colors={colors} t={t} onImage />
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
            {league.name}
          </Text>
          {league.venue_name ? (
            <Text
              size="xs"
              color="rgba(255,255,255,0.92)"
              numberOfLines={1}
              style={styles.scrimText}
            >
              {league.venue_name}
            </Text>
          ) : null}
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
              label={t('leagueList.roleOrganizer')}
              icon="person-outline"
              colors={colors}
              tone="accent"
            />
          )}
        </View>

        <View style={[styles.cardFooter, { borderTopColor: colors.cardBorder }]}>
          <MemberStrip
            preview={league.member_preview}
            total={league.member_count}
            capacity={league.member_capacity}
            colors={colors}
          />
          {joinHighlight && (
            <View style={styles.joinOpenWrap}>
              <Text size="xs" weight="semibold" color={colors.positiveText}>
                {joinHighlight}
              </Text>
              <Ionicons name="chevron-forward" size={13} color={colors.positiveText} />
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
};

/**
 * Loading placeholder following the tournament card's primary-tinted recipe,
 * shaped like a LeagueCard (banner block, meta line, footer row).
 */
export const LeagueCardSkeleton: React.FC = () => {
  const { theme } = useTheme();
  const { width } = useWindowDimensions();
  const isDark = theme === 'dark';
  // Skeleton takes a numeric height, so mirror the card banner's box.
  const bannerHeight = Math.round((width - spacingPixels[4] * 2) / LEAGUE_BANNER_ASPECT);
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

export interface LeagueSection {
  titleKey: TranslationKey;
  items: LeagueListItem[];
}

interface LeagueListScaffoldProps {
  sections: LeagueSection[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<unknown>;
  emptyIcon?: keyof typeof Ionicons.glyphMap;
  emptyTitleKey: TranslationKey;
  emptyDescriptionKey: TranslationKey;
  header?: React.ReactNode;
  /** Marks cards the caller organizes with an accent chip. */
  currentUserId?: string;
  onPressLeague: (league: LeagueListItem) => void;
}

export const LeagueListScaffold: React.FC<LeagueListScaffoldProps> = ({
  sections,
  isLoading,
  isError,
  refetch,
  emptyIcon = 'ribbon-outline',
  emptyTitleKey,
  emptyDescriptionKey,
  header,
  currentUserId,
  onPressLeague,
}) => {
  const { t } = useTranslation();
  const colors = useTournamentListColors();
  const bottomInset = useScrollBottomInset();
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
    | { kind: 'row'; league: LeagueListItem; key: string };
  const data = useMemo<Item[]>(() => {
    if (isLoading || isError) return [];
    const out: Item[] = [];
    for (const s of sections) {
      out.push({ kind: 'header', title: t(s.titleKey), key: `h-${s.titleKey}` });
      for (const league of s.items) out.push({ kind: 'row', league, key: `r-${league.id}` });
    }
    return out;
  }, [isLoading, isError, sections, t]);

  let emptyComponent: React.ReactNode;
  if (isLoading) {
    emptyComponent = (
      <View style={styles.skeletonList}>
        {[1, 2, 3, 4, 5].map(i => (
          <LeagueCardSkeleton key={i} />
        ))}
      </View>
    );
  } else if (isError) {
    emptyComponent = (
      <View style={styles.centered}>
        <Ionicons name="alert-circle-outline" size={48} color={colors.textMuted} />
        <Text size="base" weight="semibold" color={colors.text} style={styles.centeredText}>
          {t('leagueList.loadError')}
        </Text>
        <TouchableOpacity
          onPress={() => void refetch()}
          style={[styles.retryButton, { backgroundColor: colors.primary }]}
        >
          <Text size="base" weight="semibold" color="#ffffff">
            {t('leagueList.retry')}
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

  // One list in every state, with the header inside it: pull-to-refresh stays
  // live while loading, erroring and empty, not just once rows exist.
  // Bottom inset goes in the list's contentContainerStyle, not on the wrapper,
  // so the list scrolls under the home indicator instead of stopping above it.
  return (
    <SafeAreaView edges={[]} style={[styles.root, { backgroundColor: colors.background }]}>
      <FlatList
        data={data}
        keyExtractor={item => item.key}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: bottomInset },
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
            <LeagueCard
              league={item.league}
              colors={colors}
              t={t}
              isOrganizer={!!currentUserId && item.league.organizer_id === currentUserId}
              onPress={() => onPressLeague(item.league)}
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
    // Lets the empty/error state fill the screen so it centres and the whole
    // surface stays pullable.
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
  skeletonList: {
    paddingTop: spacingPixels[2],
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
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingPixels[3],
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
  joinOpenWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  memberStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1.5],
    flexShrink: 1,
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
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.full,
  },
});
