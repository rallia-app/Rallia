/**
 * Tournaments List
 *
 * Discovery surface for tournaments visible to the caller (RLS-gated).
 * Reached from the Home quick-nav FAB row. Tap a row → TournamentDetail.
 *
 * V2 scope: scoped to the active sport, grouped by status:
 *   - Yours (you organize)
 *   - Open for registration
 *   - Upcoming (registration_closed / in_progress)
 *   - Drafts (yours only — RLS hides others' drafts anyway)
 *   - Completed
 *
 * Spec: specs/17-leagues-tournaments/rollout.md §V2 (discovery slice)
 */

import React, { useMemo, useCallback, useState } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Text } from '@rallia/shared-components';
import {
  lightTheme,
  darkTheme,
  spacingPixels,
  radiusPixels,
  primary,
  neutral,
} from '@rallia/design-system';
import { useTheme, useVisibleTournaments, useAuth } from '@rallia/shared-hooks';
import type { Tables, Enums } from '@rallia/shared-types';

import { useTranslation, type TranslationKey } from '../hooks';
import { useSport } from '../context';
import type { RootStackParamList } from '../navigation';

type Tournament = Tables<'tournaments'>;
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

interface ListColors {
  background: string;
  cardBackground: string;
  text: string;
  textMuted: string;
  border: string;
  primary: string;
  positiveBg: string;
  positiveText: string;
  activeBg: string;
  activeText: string;
  neutralBg: string;
  neutralText: string;
  mutedBg: string;
  mutedText: string;
}

// =============================================================================

const StatusPill: React.FC<{
  status: Status;
  colors: ListColors;
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
        {t(`tournamentDetail.status.${status}` as TranslationKey)}
      </Text>
    </View>
  );
};

const TournamentRow: React.FC<{
  tournament: Tournament;
  colors: ListColors;
  locale: string;
  t: (k: TranslationKey) => string;
  onPress: () => void;
}> = ({ tournament, colors, locale, t, onPress }) => {
  const dateRange = useMemo(() => {
    const fmt = (iso: string) =>
      new Date(iso).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
    return t('tournamentList.dateRange' as TranslationKey)
      .replace('{start}', fmt(tournament.start_date))
      .replace('{end}', fmt(tournament.end_date));
  }, [tournament.start_date, tournament.end_date, locale, t]);

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[styles.row, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}
    >
      <View style={styles.rowMain}>
        <Text size="base" weight="semibold" color={colors.text} numberOfLines={1}>
          {tournament.name}
        </Text>
        <View style={styles.rowMeta}>
          <Ionicons name="calendar-outline" size={14} color={colors.textMuted} />
          <Text size="xs" color={colors.textMuted}>
            {dateRange}
          </Text>
          <View style={styles.metaSeparator} />
          <Ionicons name="people-outline" size={14} color={colors.textMuted} />
          <Text size="xs" color={colors.textMuted}>
            {tournament.max_participants}
          </Text>
        </View>
      </View>
      <View style={styles.rowRight}>
        <StatusPill status={tournament.status} colors={colors} t={t} />
        <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
      </View>
    </TouchableOpacity>
  );
};

interface Section {
  titleKey: TranslationKey;
  items: Tournament[];
}

// =============================================================================

export const Tournaments: React.FC = () => {
  const { theme } = useTheme();
  const { t, locale } = useTranslation();
  const { selectedSport } = useSport();
  const { session } = useAuth();
  const isDark = theme === 'dark';
  const userId = session?.user?.id;

  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const {
    data: tournaments = [],
    isLoading,
    isError,
    refetch,
    isRefetching,
  } = useVisibleTournaments(selectedSport?.id);
  const [refreshing, setRefreshing] = useState(false);

  const themeColors = isDark ? darkTheme : lightTheme;
  const colors = useMemo<ListColors>(
    () => ({
      background: themeColors.background,
      cardBackground: themeColors.card,
      text: themeColors.foreground,
      textMuted: themeColors.mutedForeground,
      border: themeColors.border,
      primary: isDark ? primary[500] : primary[600],
      positiveBg: isDark ? '#16a34a30' : '#dcfce7',
      positiveText: isDark ? '#86efac' : '#15803d',
      activeBg: isDark ? `${primary[500]}30` : `${primary[600]}20`,
      activeText: isDark ? primary[300] : primary[700],
      neutralBg: isDark ? neutral[700] : neutral[200],
      neutralText: isDark ? neutral[100] : neutral[700],
      mutedBg: isDark ? neutral[800] : neutral[100],
      mutedText: isDark ? neutral[400] : neutral[500],
    }),
    [themeColors, isDark]
  );

  const sections = useMemo<Section[]>(() => {
    const mine: Tournament[] = [];
    const open: Tournament[] = [];
    const upcoming: Tournament[] = [];
    const past: Tournament[] = [];
    const drafts: Tournament[] = [];

    for (const tn of tournaments) {
      if (tn.organizer_id === userId && tn.status === 'draft') {
        drafts.push(tn);
      } else if (tn.organizer_id === userId) {
        mine.push(tn);
      } else if (tn.status === 'registration_open') {
        open.push(tn);
      } else if (tn.status === 'completed' || tn.status === 'cancelled') {
        past.push(tn);
      } else {
        upcoming.push(tn);
      }
    }

    const out: Section[] = [];
    if (mine.length)
      out.push({ titleKey: 'tournamentList.sectionMine' as TranslationKey, items: mine });
    if (open.length)
      out.push({ titleKey: 'tournamentList.sectionOpen' as TranslationKey, items: open });
    if (upcoming.length)
      out.push({ titleKey: 'tournamentList.sectionUpcoming' as TranslationKey, items: upcoming });
    if (drafts.length)
      out.push({ titleKey: 'tournamentList.sectionDraft' as TranslationKey, items: drafts });
    if (past.length)
      out.push({ titleKey: 'tournamentList.sectionPast' as TranslationKey, items: past });
    return out;
  }, [tournaments, userId]);

  const handlePress = useCallback(
    (tournamentId: string, name: string) => {
      navigation.navigate('TournamentDetail', { tournamentId, tournamentName: name });
    },
    [navigation]
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  if (isLoading) {
    return (
      <SafeAreaView
        edges={['bottom']}
        style={[styles.root, { backgroundColor: colors.background }]}
      >
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text size="sm" color={colors.textMuted} style={styles.centeredText}>
            {t('tournamentList.loading' as TranslationKey)}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (isError) {
    return (
      <SafeAreaView
        edges={['bottom']}
        style={[styles.root, { backgroundColor: colors.background }]}
      >
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.textMuted} />
          <Text size="base" weight="semibold" color={colors.text} style={styles.centeredText}>
            {t('tournamentList.loadError' as TranslationKey)}
          </Text>
          <TouchableOpacity
            onPress={() => refetch()}
            style={[styles.retryButton, { backgroundColor: colors.primary }]}
          >
            <Text size="base" weight="semibold" color="#ffffff">
              {t('tournamentList.retry' as TranslationKey)}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (sections.length === 0) {
    return (
      <SafeAreaView
        edges={['bottom']}
        style={[styles.root, { backgroundColor: colors.background }]}
      >
        <View style={styles.centered}>
          <Ionicons name="trophy-outline" size={48} color={colors.textMuted} />
          <Text size="base" weight="semibold" color={colors.text} style={styles.centeredText}>
            {t('tournamentList.empty' as TranslationKey)}
          </Text>
          <Text size="sm" color={colors.textMuted} style={styles.centeredSubtext}>
            {t('tournamentList.emptyDescription' as TranslationKey)}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // Flatten sections for FlatList rendering with sticky headers via type discrim
  type Item =
    | { kind: 'header'; title: string; key: string }
    | { kind: 'row'; tournament: Tournament; key: string };
  const data: Item[] = [];
  for (const s of sections) {
    data.push({ kind: 'header', title: t(s.titleKey), key: `h-${s.titleKey}` });
    for (const tn of s.items) data.push({ kind: 'row', tournament: tn, key: `r-${tn.id}` });
  }

  return (
    <SafeAreaView edges={[]} style={[styles.root, { backgroundColor: colors.background }]}>
      <FlatList
        data={data}
        keyExtractor={item => item.key}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing || isRefetching}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
          />
        }
        renderItem={({ item }) => {
          if (item.kind === 'header') {
            return (
              <Text
                size="xs"
                weight="semibold"
                color={colors.textMuted}
                style={styles.sectionHeader}
              >
                {item.title.toUpperCase()}
              </Text>
            );
          }
          return (
            <TournamentRow
              tournament={item.tournament}
              colors={colors}
              locale={locale}
              t={t}
              onPress={() => handlePress(item.tournament.id, item.tournament.name)}
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
    padding: spacingPixels[4],
    paddingBottom: spacingPixels[8],
    gap: spacingPixels[2],
  },
  sectionHeader: {
    marginTop: spacingPixels[4],
    marginBottom: spacingPixels[2],
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    gap: spacingPixels[3],
  },
  rowMain: {
    flex: 1,
    gap: spacingPixels[1],
  },
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
  },
  metaSeparator: {
    width: 1,
    height: 12,
    backgroundColor: 'rgba(128,128,128,0.3)',
    marginHorizontal: spacingPixels[1.5],
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  statusPill: {
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[0.5],
    borderRadius: radiusPixels.full,
  },
});

export default Tournaments;
