/**
 * Tournament Link Match Sheet
 *
 * Picker that links one of the caller's already-played, verified matches to a
 * bracket slot. Lists the eligible matches (both bracket players joined, same
 * sport, verified result, not yet linked) as MatchCard-style cards. Each side
 * shows the player's avatar and name (first name alone for singles, first name
 * + last initial per player for a doubles pair), with the sets-won score and
 * the per-set breakdown between them, and attaches the chosen one on tap. Built on
 * BaseActionSheet for consistent header, safe-area, and dismiss handling.
 */

import React, { useCallback, useMemo, useRef } from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator, Image } from 'react-native';
import { SheetManager, SheetProps, FlatList } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text, useToast } from '@rallia/shared-components';
import {
  spacingPixels,
  radiusPixels,
  primary,
  accent,
  secondary,
  status,
} from '@rallia/design-system';
import {
  lightHaptic,
  successHaptic,
  warningHaptic,
  getProfilePictureUrl,
  getInitialName,
} from '@rallia/shared-utils';
import {
  useLinkableMatchesForSlot,
  useAttachMatchToTournamentSlot,
  useProfilesByIds,
} from '@rallia/shared-hooks';
import type { LinkableMatch, PlayerProfile } from '@rallia/shared-services';

import { BaseActionSheet } from '#/components/BaseActionSheet';
import { useThemeStyles, useTranslation, type TranslationKey } from '#/hooks';

const SHEET_ID = 'tournament-link-match';

export function TournamentLinkMatchActionSheet({ payload }: SheetProps<'tournament-link-match'>) {
  const tournamentMatchId = payload?.tournamentMatchId ?? '';
  const tournamentId = payload?.tournamentId ?? '';
  const sportId = payload?.sportId ?? '';
  const entryFormat = payload?.entryFormat ?? 'singles';
  const team1UserIds = useMemo(() => payload?.team1UserIds ?? [], [payload?.team1UserIds]);
  const team2UserIds = useMemo(() => payload?.team2UserIds ?? [], [payload?.team2UserIds]);
  const onSuccess = payload?.onSuccess;
  const onDismiss = payload?.onDismiss;

  const { colors, isDark } = useThemeStyles();
  const { t, locale } = useTranslation();
  const toast = useToast();

  // Skip the dismiss callback once a pick succeeds (the sheet closes itself).
  const didPickRef = useRef(false);

  const { data: matches = [], isLoading } = useLinkableMatchesForSlot({
    tournamentMatchId,
    team1UserIds,
    team2UserIds,
    sportId,
    entryFormat,
  });

  // The bracket players are fixed for the whole sheet — fetch once and look
  // up each match's team→players by id.
  const playerIds = useMemo(
    () => [...team1UserIds, ...team2UserIds].filter(Boolean),
    [team1UserIds, team2UserIds]
  );
  const { data: profiles } = useProfilesByIds(playerIds);

  const attach = useAttachMatchToTournamentSlot({
    onSuccess: () => {
      successHaptic();
      didPickRef.current = true;
      void SheetManager.hide(SHEET_ID);
      onSuccess?.();
    },
    onError: e => {
      warningHaptic();
      toast.error(t('tournamentDetail.linkPicker.attachFailed') + ` (${e.message})`);
    },
  });

  const handleClose = useCallback(() => {
    void SheetManager.hide(SHEET_ID);
  }, []);

  const handleSheetClose = useCallback(() => {
    if (!didPickRef.current) onDismiss?.();
    didPickRef.current = false;
  }, [onDismiss]);

  const handlePick = useCallback(
    (matchId: string) => {
      lightHaptic();
      attach.mutate({ tournamentMatchId, matchId, tournamentId });
    },
    [attach, tournamentMatchId, tournamentId]
  );

  const renderItem = useCallback(
    ({ item }: { item: LinkableMatch }) => (
      <LinkableMatchCard
        match={item}
        profiles={profiles}
        onPick={() => handlePick(item.id)}
        disabled={attach.isPending}
        colors={colors}
        isDark={isDark}
        locale={locale}
        t={t}
      />
    ),
    [handlePick, attach.isPending, colors, isDark, locale, t, profiles]
  );

  return (
    <BaseActionSheet
      title={t('tournamentDetail.linkPicker.title')}
      onClose={handleClose}
      onSheetClose={handleSheetClose}
      flex={false}
    >
      {isLoading ? (
        <View style={styles.stateContainer}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : matches.length === 0 ? (
        <View style={styles.stateContainer}>
          <Ionicons name="search-outline" size={36} color={colors.textMuted} />
          <Text size="base" weight="semibold" color={colors.text} style={styles.emptyTitle}>
            {t('tournamentDetail.linkPicker.empty')}
          </Text>
          <Text size="sm" color={colors.textMuted} style={styles.emptyHint}>
            {t(
              entryFormat === 'singles'
                ? 'tournamentDetail.linkPicker.emptyHint'
                : 'tournamentDetail.linkPicker.emptyHintDoubles'
            )}
          </Text>
        </View>
      ) : (
        <FlatList
          data={matches}
          keyExtractor={m => m.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}
    </BaseActionSheet>
  );
}

type ThemeColors = ReturnType<typeof useThemeStyles>['colors'];

const AVATAR_SIZE = 40;

/** Circular avatar with a primary ring + gold trophy badge when this player won. */
const PlayerAvatar: React.FC<{
  profile?: PlayerProfile;
  won: boolean;
  colors: ThemeColors;
  trophyColor: string;
}> = ({ profile, won, colors, trophyColor }) => {
  const url = getProfilePictureUrl(profile?.profile_picture_url);
  return (
    <View style={styles.avatarWrap}>
      <View
        style={[
          styles.avatar,
          { backgroundColor: colors.inputBackground },
          won && { borderWidth: 2, borderColor: colors.primary },
        ]}
      >
        {url ? (
          <Image source={{ uri: url }} style={styles.avatarImage} />
        ) : (
          <Ionicons name="person" size={18} color={colors.textMuted} />
        )}
      </View>
      {won ? (
        <View style={[styles.trophyBadge, { backgroundColor: trophyColor }]}>
          <Ionicons name="trophy" size={9} color="#ffffff" />
        </View>
      ) : null}
    </View>
  );
};

/** One side: avatar(s) + name(s), a pair for doubles, hugging the central score. */
const PlayerSide: React.FC<{
  sideProfiles: Array<PlayerProfile | undefined>;
  won: boolean;
  align: 'left' | 'right';
  colors: ThemeColors;
  trophyColor: string;
}> = ({ sideProfiles, won, align, colors, trophyColor }) => {
  // Pairs carry the last initial so two teammates stay tellable apart, matching
  // the bracket's pair labels. A lone player keeps the bare first name: this
  // card is compact and there is nobody to confuse them with.
  const isPair = sideProfiles.length > 1;
  const name =
    sideProfiles
      .map(p => (isPair ? getInitialName(p, '') : (p?.first_name?.trim() ?? '')))
      .filter(Boolean)
      .join(' & ') || '—';
  const avatars = (
    <View style={styles.avatarStack}>
      {sideProfiles.map((profile, i) => (
        <View key={profile?.id ?? i} style={i > 0 ? styles.avatarOverlap : undefined}>
          <PlayerAvatar
            profile={profile}
            won={won && i === 0}
            colors={colors}
            trophyColor={trophyColor}
          />
        </View>
      ))}
    </View>
  );
  const label = (
    <Text
      size="sm"
      weight="semibold"
      color={won ? colors.primary : colors.text}
      numberOfLines={2}
      style={styles.playerName}
    >
      {name}
    </Text>
  );
  return (
    <View style={[styles.playerSide, align === 'right' && styles.playerSideRight]}>
      {align === 'left' ? (
        <>
          {avatars}
          {label}
        </>
      ) : (
        <>
          {label}
          {avatars}
        </>
      )}
    </View>
  );
};

/** Central sets-won score ("2 – 1"), winner side tinted primary. */
const ScoreBlock: React.FC<{
  match: LinkableMatch;
  colors: ThemeColors;
}> = ({ match, colors }) => {
  const won1 = match.winning_team === 1;
  const won2 = match.winning_team === 2;
  return (
    <View style={styles.scoreBlock}>
      <Text size="3xl" weight="bold" color={colors.textMuted} style={styles.scoreValue}>
        <Text
          size="3xl"
          weight="bold"
          color={won1 ? colors.primary : colors.textMuted}
          style={styles.scoreValue}
        >
          {match.team1_score ?? '–'}
        </Text>
        <Text size="3xl" weight="bold" color={colors.textMuted} style={styles.scoreValue}>
          {' – '}
        </Text>
        <Text
          size="3xl"
          weight="bold"
          color={won2 ? colors.primary : colors.textMuted}
          style={styles.scoreValue}
        >
          {match.team2_score ?? '–'}
        </Text>
      </Text>
    </View>
  );
};

/**
 * Per-set breakdown as coloured pills, mirroring the score card in
 * MatchDetailSheet — green when the left (team 1) player took the set, coral
 * when the right (team 2) player took it.
 */
const SetPills: React.FC<{
  sets: LinkableMatch['sets'];
  isDark: boolean;
}> = ({ sets, isDark }) => (
  <View style={styles.setsRow}>
    {sets.map((s, idx) => {
      const leftWonSet = s.team1 > s.team2;
      const pillBg = leftWonSet
        ? isDark
          ? 'rgba(5, 150, 105, 0.15)'
          : 'rgba(5, 150, 105, 0.1)'
        : isDark
          ? 'rgba(237, 106, 109, 0.15)'
          : 'rgba(237, 106, 109, 0.1)';
      const pillBorder = leftWonSet
        ? isDark
          ? 'rgba(5, 150, 105, 0.3)'
          : 'rgba(5, 150, 105, 0.2)'
        : isDark
          ? 'rgba(237, 106, 109, 0.3)'
          : 'rgba(237, 106, 109, 0.2)';
      const pillTextColor = leftWonSet
        ? isDark
          ? status.success.light
          : status.success.dark
        : isDark
          ? secondary[300]
          : secondary[600];
      return (
        <View
          key={idx}
          style={[styles.setPill, { backgroundColor: pillBg, borderColor: pillBorder }]}
        >
          <Text size="xs" weight="semibold" color={pillTextColor}>
            {`${s.team1}-${s.team2}`}
          </Text>
        </View>
      );
    })}
  </View>
);

const LinkableMatchCard: React.FC<{
  match: LinkableMatch;
  profiles?: Record<string, PlayerProfile>;
  onPick: () => void;
  disabled?: boolean;
  colors: ThemeColors;
  isDark: boolean;
  locale: string;
  t: (k: TranslationKey) => string;
}> = ({ match, profiles, onPick, disabled, colors, isDark, locale, t }) => {
  const dateLabel = useMemo(
    () =>
      new Date(match.match_date).toLocaleDateString(locale, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }),
    [match.match_date, locale]
  );
  const timeLabel = match.start_time.slice(0, 5);

  const accentColor = isDark ? primary[400] : primary[500];
  const trophyColor = isDark ? accent[400] : accent[500];
  const cardBg = isDark ? primary[950] : primary[50];
  const borderColor = isDark ? `${primary[400]}40` : `${primary[500]}20`;

  const side1 = match.team1_user_ids.map(id => profiles?.[id]);
  const side2 = match.team2_user_ids.map(id => profiles?.[id]);

  return (
    <TouchableOpacity
      onPress={onPick}
      disabled={disabled}
      activeOpacity={0.85}
      accessibilityRole="button"
      style={[
        styles.card,
        { backgroundColor: cardBg, borderColor },
        disabled && styles.cardDisabled,
      ]}
    >
      {/* Date / time + verified */}
      <View style={styles.topRow}>
        <View style={styles.timeContainer}>
          <Ionicons name="calendar-outline" size={15} color={accentColor} />
          <Text
            size="sm"
            weight="bold"
            color={colors.text}
            numberOfLines={1}
            style={styles.timeText}
          >
            {dateLabel} · {timeLabel}
          </Text>
        </View>
        {match.verified_at ? (
          <View
            style={[
              styles.verifiedChip,
              { backgroundColor: `${colors.primary}${isDark ? '30' : '15'}` },
            ]}
          >
            <Ionicons name="checkmark-circle" size={11} color={colors.primary} />
            <Text size="xs" weight="semibold" color={colors.primary}>
              {t('common.verified')}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Side — score — side */}
      <View style={styles.scoreRow}>
        <PlayerSide
          sideProfiles={side1}
          won={match.winning_team === 1}
          align="left"
          colors={colors}
          trophyColor={trophyColor}
        />
        <ScoreBlock match={match} colors={colors} />
        <PlayerSide
          sideProfiles={side2}
          won={match.winning_team === 2}
          align="right"
          colors={colors}
          trophyColor={trophyColor}
        />
      </View>

      {/* Per-set breakdown */}
      {match.sets.length > 0 ? <SetPills sets={match.sets} isDark={isDark} /> : null}

      {/* Link affordance (whole card is tappable) */}
      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <Text size="sm" weight="bold" color={colors.primary}>
          {t('tournamentDetail.linkPicker.linkCta')}
        </Text>
        <Ionicons name="arrow-forward" size={16} color={colors.primary} />
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  listContent: {
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[3],
    paddingBottom: spacingPixels[6],
    gap: spacingPixels[3],
  },
  card: {
    borderRadius: radiusPixels.xl,
    borderWidth: 1.5,
    padding: spacingPixels[4],
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 3,
  },
  cardDisabled: {
    opacity: 0.6,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingPixels[2],
  },
  timeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
    gap: spacingPixels[1.5],
  },
  timeText: {
    flexShrink: 1,
  },
  verifiedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.full,
    flexShrink: 0,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: spacingPixels[4],
    paddingBottom: spacingPixels[3],
    gap: spacingPixels[2],
  },
  playerSide: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacingPixels[2],
  },
  playerSideRight: {
    justifyContent: 'flex-start',
  },
  avatarWrap: {
    position: 'relative',
    flexShrink: 0,
  },
  avatarStack: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
  },
  avatarOverlap: {
    marginLeft: -AVATAR_SIZE / 3,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
  },
  trophyBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
    elevation: 3,
  },
  playerName: {
    flexShrink: 1,
  },
  scoreBlock: {
    alignItems: 'center',
    flexShrink: 0,
    paddingHorizontal: spacingPixels[1],
  },
  scoreValue: {
    lineHeight: 34,
  },
  setsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacingPixels[2],
    marginTop: spacingPixels[2],
    marginBottom: spacingPixels[3],
  },
  setPill: {
    paddingHorizontal: spacingPixels[2.5],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.full,
    borderWidth: 1,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[1.5],
    paddingTop: spacingPixels[3],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  stateContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[3],
    paddingBottom: spacingPixels[8],
    gap: spacingPixels[2],
  },
  emptyTitle: {
    marginTop: spacingPixels[3],
    textAlign: 'center',
  },
  emptyHint: {
    textAlign: 'center',
  },
});

export default TournamentLinkMatchActionSheet;
