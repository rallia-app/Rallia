/**
 * LeagueListScaffold — shared list UI for public discovery + my leagues.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text, Skeleton } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, primary } from '@rallia/design-system';
import { useTheme } from '@rallia/shared-hooks';
import type { LeagueListItem } from '@rallia/shared-services';
import type { Enums } from '@rallia/shared-types';

import {
  useTournamentListColors,
  type TournamentListColors,
} from '../../tournaments/components/TournamentListScaffold';
import { useTranslation, type TranslationKey } from '../../../hooks';

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

const StatusPill: React.FC<{
  status: LeagueStatus;
  colors: TournamentListColors;
  t: (k: TranslationKey) => string;
}> = ({ status, colors, t }) => {
  const tone = LEAGUE_STATUS_TONE[status];
  const bg =
    tone === 'positive' ? colors.positiveBg : tone === 'muted' ? colors.mutedBg : colors.neutralBg;
  const fg =
    tone === 'positive'
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

export const LeagueCard: React.FC<{
  league: LeagueListItem;
  colors: TournamentListColors;
  t: (k: TranslationKey, options?: Record<string, string | number>) => string;
  onPress: () => void;
  isOrganizer?: boolean;
  watermark?: React.ReactNode;
}> = ({ league, colors, t, onPress, isOrganizer, watermark }) => {
  const ratingRange = formatRatingRange(league.min_rating, league.max_rating);

  const memberLabel = useMemo(
    () => t('common.memberCount', { count: league.member_count }),
    [league.member_count, t]
  );

  const joinHighlight = useMemo(() => {
    if (league.join_mode !== 'open' || league.status !== 'active') return null;
    return t(JOIN_MODE_KEYS.open as TranslationKey);
  }, [league.join_mode, league.status, t]);

  const capacityLabel =
    league.member_capacity != null ? `${league.member_count}/${league.member_capacity}` : null;

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
      {watermark && (
        <View style={styles.watermark} pointerEvents="none">
          {watermark}
        </View>
      )}

      <View style={styles.cardHeader}>
        <Text
          size="base"
          weight="semibold"
          color={colors.text}
          numberOfLines={1}
          style={styles.cardTitle}
        >
          {league.name}
        </Text>
        <StatusPill status={league.status} colors={colors} t={t} />
      </View>

      <View style={styles.cardMetaLine}>
        <Ionicons name="people-outline" size={14} color={colors.primary} />
        <Text size="xs" color={colors.textMuted}>
          {memberLabel}
        </Text>
        {joinHighlight && (
          <>
            <View style={styles.metaSeparator} />
            <Ionicons name="person-add-outline" size={14} color={colors.positiveText} />
            <Text size="xs" weight="medium" color={colors.positiveText}>
              {joinHighlight}
            </Text>
          </>
        )}
      </View>

      {league.venue_name ? (
        <View style={styles.cardMetaLine}>
          <Ionicons name="location" size={14} color={colors.textMuted} />
          <Text size="xs" color={colors.textMuted} numberOfLines={1} style={styles.venueText}>
            {league.venue_name}
          </Text>
        </View>
      ) : null}

      {/* Importance order: role, eligibility, join mode, room left, visibility, level */}
      <View style={styles.chipRow}>
        {isOrganizer && (
          <MetaChip
            label={t('leagueList.roleOrganizer')}
            icon="person-outline"
            colors={colors}
            tone="accent"
          />
        )}
        {ratingRange && (
          <MetaChip label={ratingRange} icon="analytics" colors={colors} tone="secondary" />
        )}
        <MetaChip label={t(JOIN_MODE_KEYS[league.join_mode] as TranslationKey)} colors={colors} />
        {capacityLabel && <MetaChip label={capacityLabel} icon="people-outline" colors={colors} />}
        <MetaChip
          label={t(VISIBILITY_KEYS[league.visibility] as TranslationKey)}
          icon="eye-outline"
          colors={colors}
        />
        {league.level && <MetaChip label={league.level} colors={colors} />}
      </View>
    </TouchableOpacity>
  );
};

export const LeagueCardSkeleton: React.FC = () => {
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
  cardWatermark?: React.ReactNode;
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
  cardWatermark,
  onPressLeague,
}) => {
  const { t } = useTranslation();
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
          <LeagueCardSkeleton key={i} />
        ))}
      </View>
    );
  } else if (isError) {
    body = (
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
      | { kind: 'row'; league: LeagueListItem; key: string };
    const data: Item[] = [];
    for (const s of sections) {
      data.push({ kind: 'header', title: t(s.titleKey), key: `h-${s.titleKey}` });
      for (const league of s.items) data.push({ kind: 'row', league, key: `r-${league.id}` });
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
            <LeagueCard
              league={item.league}
              colors={colors}
              t={t}
              watermark={cardWatermark}
              onPress={() => onPressLeague(item.league)}
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
  skeletonList: {
    flex: 1,
    paddingTop: spacingPixels[2],
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
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingPixels[3],
  },
  cardTitle: { flex: 1 },
  statusPill: {
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[0.5],
    borderRadius: radiusPixels.full,
  },
  cardMetaLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
  },
  venueText: { flex: 1 },
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
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.full,
  },
  watermark: {
    position: 'absolute',
    right: spacingPixels[3],
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    opacity: 0.12,
  },
});
