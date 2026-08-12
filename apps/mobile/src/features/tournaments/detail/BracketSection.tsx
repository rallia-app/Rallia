/**
 * The knockout tree and its player rows.
 *
 * Lives beside the bracket pane rather than in the screen: it is the largest
 * single piece of tournament detail and nothing outside the bracket uses it.
 */

import React, { useState, useRef, useEffect } from 'react';
import { View, TouchableOpacity, ScrollView, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import type { PlayerSearchResult, TournamentMatch } from '@rallia/shared-services';
import { getHumanName, getProfilePictureUrl, lightHaptic } from '@rallia/shared-utils';
import type { Tables } from '@rallia/shared-types';

import type { TranslationKey } from '../../../hooks';
import { seedFallbackLabel, type ScreenColors } from './components';
import { styles } from './detailStyles';

export type MatchRow = Tables<'tournament_matches'>;

export const roundLabel = (
  round: number,
  totalRounds: number,
  t: (k: TranslationKey) => string
): string => {
  if (round === totalRounds) return t('tournamentDetail.bracket.final');
  if (round === totalRounds - 1) return t('tournamentDetail.bracket.semifinal');
  if (round === totalRounds - 2) return t('tournamentDetail.bracket.quarterfinal');
  return t('tournamentDetail.bracket.round').replace('{n}', String(round));
};

export const slotLabel = (
  regId: string | null,
  isBye: boolean,
  isPhantom: boolean,
  seedByRegId: Map<string, number>,
  nameByRegId: Map<string, string>,
  t: (k: TranslationKey) => string
): string => {
  if (isPhantom) return t('tournamentDetail.bracket.phantom');
  if (isBye) return t('tournamentDetail.bracket.bye');
  if (!regId) return t('tournamentDetail.bracket.tbd');
  const name = nameByRegId.get(regId);
  if (name) return name;
  // Fall back to the seed rank for a determined-but-unnamed slot.
  const seed = seedByRegId.get(regId);
  return seed !== undefined ? seedFallbackLabel(seed, t) : t('tournamentDetail.bracket.tbd');
};

export type SlotKind = 'player' | 'bye' | 'tbd' | 'phantom';

export const slotKind = (regId: string | null, isBye: boolean, isPhantom: boolean): SlotKind => {
  if (isPhantom) return 'phantom';
  if (isBye) return 'bye';
  if (!regId) return 'tbd';
  return 'player';
};

// The bracket score is a free-form string the organizer types ("e.g., 6-4
// 6-2"). We split it into per-set pairs in written order; the caller orients
// each set onto the right player's row using the known match winner.
export const parseScoreSets = (score: string | null): Array<{ a: number; b: number }> => {
  if (!score) return [];
  const sets: Array<{ a: number; b: number }> = [];
  const re = /(\d{1,2})\s*[-–:]\s*(\d{1,2})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(score)) !== null) {
    sets.push({ a: parseInt(m[1], 10), b: parseInt(m[2], 10) });
  }
  return sets;
};

export const BracketSection: React.FC<{
  matches: MatchRow[];
  seedByRegId: Map<string, number>;
  nameByRegId: Map<string, string>;
  membersByRegId: Map<string, string[]>;
  slotPlayersByRegId: Map<string, Array<{ id: string; avatarUrl: string | null }>>;
  currentUserId: string | undefined;
  isOrganizer: boolean;
  onMatchPress: (tournamentMatchId: string, p1RegId: string, p2RegId: string) => void;
  onOrganizerOverride: (tournamentMatchId: string, p1RegId: string, p2RegId: string) => void;
  onPlayerPress: (playerId: string) => void;
  colors: ScreenColors;
  t: (k: TranslationKey) => string;
  showTitle?: boolean;
}> = ({
  matches,
  seedByRegId,
  nameByRegId,
  membersByRegId,
  slotPlayersByRegId,
  currentUserId,
  isOrganizer,
  onMatchPress,
  onOrganizerOverride,
  onPlayerPress,
  colors,
  t,
  showTitle = true,
}) => {
  const totalRounds = matches.reduce((max, m) => Math.max(max, m.round_number), 0);
  const byRound = new Map<number, MatchRow[]>();
  for (const m of matches) {
    const arr = byRound.get(m.round_number) ?? [];
    arr.push(m);
    byRound.set(m.round_number, arr);
  }
  const roundNumbers = [...byRound.keys()].sort((a, b) => a - b);

  // Flashscore-style round pager: open on the first round still being played.
  const [selectedIdx, setSelectedIdx] = useState(() => {
    const idx = roundNumbers.findIndex(r =>
      (byRound.get(r) ?? []).some(
        m => !m.winner_registration_id && !(m.player1_is_bye && m.player2_is_bye)
      )
    );
    return idx === -1 ? Math.max(0, roundNumbers.length - 1) : idx;
  });
  const [pageWidth, setPageWidth] = useState(0);
  const pagerRef = useRef<ScrollView>(null);

  // Snap to the selected page once the pager is measured (no animation).
  useEffect(() => {
    if (pageWidth > 0) {
      pagerRef.current?.scrollTo({ x: selectedIdx * pageWidth, animated: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageWidth]);

  const goToRound = (idx: number) => {
    void lightHaptic();
    setSelectedIdx(idx);
    pagerRef.current?.scrollTo({ x: idx * pageWidth, animated: true });
  };

  const onPagerSettle = (offsetX: number) => {
    if (pageWidth <= 0) return;
    const idx = Math.min(roundNumbers.length - 1, Math.max(0, Math.round(offsetX / pageWidth)));
    if (idx !== selectedIdx) setSelectedIdx(idx);
  };

  // Round is "complete" once every real (non-bye) game has a winner — used to
  // mark the chip with a check and drive the per-round progress pill.
  const roundProgress = (round: number) => {
    const real = (byRound.get(round) ?? []).filter(m => !(m.player1_is_bye && m.player2_is_bye));
    const done = real.filter(m => m.winner_registration_id).length;
    return { done, total: real.length, complete: real.length > 0 && done === real.length };
  };

  // Final-round winner → celebratory champion header at the top of the bracket.
  const finalMatch = matches.find(m => m.round_number === totalRounds && m.winner_registration_id);
  const championRegId = finalMatch?.winner_registration_id ?? null;
  const championName = championRegId
    ? (nameByRegId.get(championRegId) ?? seedFallbackLabel(seedByRegId.get(championRegId), t))
    : null;

  const renderMatch = (m: MatchRow) => {
    const isPhantom = m.player1_is_bye && m.player2_is_bye && m.winner_registration_id === null;
    const winnerSlot = !m.winner_registration_id
      ? 0
      : m.winner_registration_id === m.player1_registration_id
        ? 1
        : m.winner_registration_id === m.player2_registration_id
          ? 2
          : 0;
    const isFinalRound = m.round_number === totalRounds;

    const p1Members = m.player1_registration_id
      ? (membersByRegId.get(m.player1_registration_id) ?? [])
      : [];
    const p2Members = m.player2_registration_id
      ? (membersByRegId.get(m.player2_registration_id) ?? [])
      : [];
    // Avatars only for real, named slots (never bye/tbd/phantom).
    const p1SlotPlayers =
      m.player1_registration_id && !m.player1_is_bye && !isPhantom
        ? (slotPlayersByRegId.get(m.player1_registration_id) ?? [])
        : [];
    const p2SlotPlayers =
      m.player2_registration_id && !m.player2_is_bye && !isPhantom
        ? (slotPlayersByRegId.get(m.player2_registration_id) ?? [])
        : [];
    const callerIsParticipant =
      !!currentUserId && (p1Members.includes(currentUserId) || p2Members.includes(currentUserId));
    const slotsReady =
      !m.player1_is_bye &&
      !m.player2_is_bye &&
      !!m.player1_registration_id &&
      !!m.player2_registration_id;
    const isPlayable = m.status === 'pending' && slotsReady;
    // Organizers record results (override) and may also CORRECT a completed
    // match; the RPC rejects (NEXT_MATCH_ALREADY_PLAYED) once the downstream
    // match has its own result. Participants link their own played match.
    const canOrganizerOverride =
      isOrganizer && slotsReady && (m.status === 'pending' || m.status === 'completed');
    const canParticipantAttach = isPlayable && callerIsParticipant;
    const isTappable = canOrganizerOverride || canParticipantAttach;
    // An organizer who is playing in this match acts as a participant on it
    // (link your own played game); the override sheet stays for matches they're
    // not in and for correcting a completed result they can no longer attach.
    const useOrganizerOverride = canOrganizerOverride && !canParticipantAttach;

    const isLive = m.status === 'in_progress';
    const isDisputed = m.status === 'disputed';

    const headerRight = isLive ? (
      <View style={[styles.bmStatusPill, { backgroundColor: colors.statusActiveBg }]}>
        <View style={[styles.bmLiveDot, { backgroundColor: colors.primary }]} />
        <Text size="xs" weight="bold" color={colors.primary}>
          {t('tournamentDetail.bracket.live')}
        </Text>
      </View>
    ) : isDisputed ? (
      <View style={[styles.bmStatusPill, { backgroundColor: colors.cancelledBg }]}>
        <Ionicons name="alert-circle" size={12} color={colors.cancelledText} />
        <Text size="xs" weight="bold" color={colors.cancelledText}>
          {t('tournamentDetail.bracket.disputed')}
        </Text>
      </View>
    ) : null;

    // Per-player set scores: each set's games sit on that player's own row, the
    // set-winner's number bolded per column. The raw string has no fixed player
    // order, so we orient it by the known match winner — whichever side took
    // more sets is the winner's — then map onto rows. A winner with no parseable
    // score gets a check instead.
    const sets = parseScoreSets(m.score);
    const aWins = sets.filter(s => s.a > s.b).length;
    const bWins = sets.filter(s => s.b > s.a).length;
    const winnerOnSideA = aWins >= bWins;
    const winnerGames = sets.map(s => (winnerOnSideA ? s.a : s.b));
    const loserGames = sets.map(s => (winnerOnSideA ? s.b : s.a));
    const p1Games =
      winnerSlot === 1 ? winnerGames : winnerSlot === 2 ? loserGames : sets.map(s => s.a);
    const p2Games =
      winnerSlot === 2 ? winnerGames : winnerSlot === 1 ? loserGames : sets.map(s => s.b);
    const cells1 = p1Games.map((v, i) => ({ value: v, won: v > p2Games[i] }));
    const cells2 = p2Games.map((v, i) => ({ value: v, won: v > p1Games[i] }));

    const statusStrip =
      isLive || isDisputed ? <View style={styles.bmStatusStrip}>{headerRight}</View> : null;

    const matchInner = (
      <>
        {statusStrip}
        <BracketPlayerRow
          label={slotLabel(
            m.player1_registration_id,
            m.player1_is_bye,
            isPhantom,
            seedByRegId,
            nameByRegId,
            t
          )}
          seed={m.player1_registration_id ? seedByRegId.get(m.player1_registration_id) : undefined}
          kind={slotKind(m.player1_registration_id, m.player1_is_bye, isPhantom)}
          isWinner={winnerSlot === 1}
          isFinalWinner={winnerSlot === 1 && isFinalRound}
          decided={winnerSlot !== 0}
          cells={cells1}
          showCheck={winnerSlot === 1 && sets.length === 0}
          players={p1SlotPlayers}
          onPlayerPress={onPlayerPress}
          colors={colors}
        />
        <View style={[styles.bmRowDivider, { backgroundColor: colors.border }]} />
        <BracketPlayerRow
          label={slotLabel(
            m.player2_registration_id,
            m.player2_is_bye,
            isPhantom,
            seedByRegId,
            nameByRegId,
            t
          )}
          seed={m.player2_registration_id ? seedByRegId.get(m.player2_registration_id) : undefined}
          kind={slotKind(m.player2_registration_id, m.player2_is_bye, isPhantom)}
          isWinner={winnerSlot === 2}
          isFinalWinner={winnerSlot === 2 && isFinalRound}
          decided={winnerSlot !== 0}
          cells={cells2}
          showCheck={winnerSlot === 2 && sets.length === 0}
          players={p2SlotPlayers}
          onPlayerPress={onPlayerPress}
          colors={colors}
        />
      </>
    );

    if (isTappable && m.player1_registration_id && m.player2_registration_id) {
      const p1RegId = m.player1_registration_id;
      const p2RegId = m.player2_registration_id;
      // Fixing an already-recorded result is a quiet escape hatch, not the next
      // action — it drops the playable accent and softens the footer.
      const isCorrection = useOrganizerOverride && m.status === 'completed';
      const handlePress = useOrganizerOverride
        ? () => onOrganizerOverride(m.id, p1RegId, p2RegId)
        : () => onMatchPress(m.id, p1RegId, p2RegId);
      const a11yLabel = useOrganizerOverride
        ? t('tournamentDetail.bracket.overrideMatch')
        : t('tournamentDetail.bracket.linkMatch');
      const ctaLabel = isCorrection
        ? t('tournamentDetail.bracket.correctResult' as TranslationKey)
        : useOrganizerOverride
          ? t('tournamentDetail.bracket.recordResult')
          : t('tournamentDetail.bracket.addResult');
      const accent = isCorrection ? colors.textMuted : colors.primary;
      return (
        <TouchableOpacity
          key={m.id}
          onPress={handlePress}
          activeOpacity={0.7}
          style={[
            styles.bmCard,
            !isCorrection && styles.bmCardPlayable,
            {
              backgroundColor: colors.cardBackground,
              borderColor: isCorrection ? colors.border : colors.primary,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel={a11yLabel}
          testID="bracket-playable-match"
        >
          {matchInner}
          <View
            style={[
              styles.bmFooter,
              {
                backgroundColor: isCorrection ? 'transparent' : colors.highlightBg,
                borderTopColor: colors.border,
              },
            ]}
          >
            <Ionicons
              name={useOrganizerOverride ? 'create-outline' : 'add-circle-outline'}
              size={isCorrection ? 14 : 16}
              color={accent}
            />
            <Text
              size={isCorrection ? 'xs' : 'sm'}
              weight="semibold"
              color={accent}
              style={styles.bmFooterLabel}
            >
              {ctaLabel}
            </Text>
            <Ionicons name="chevron-forward" size={isCorrection ? 14 : 16} color={accent} />
          </View>
        </TouchableOpacity>
      );
    }

    return (
      <View
        key={m.id}
        style={[
          styles.bmCard,
          { backgroundColor: colors.cardBackground, borderColor: colors.border },
        ]}
      >
        {matchInner}
      </View>
    );
  };

  // Each pair of sibling matches feeds one match in the next round — group them
  // with a connector + chevron that advances the pager, mirroring a real tree.
  const renderRoundPage = (round: number, roundIdx: number) => {
    const roundMatches = (byRound.get(round) ?? []).sort(
      (a, b) => a.match_position - b.match_position
    );
    const hasNextRound = roundIdx < roundNumbers.length - 1;
    const pairs: MatchRow[][] = [];
    for (let i = 0; i < roundMatches.length; i += 2) {
      pairs.push(roundMatches.slice(i, i + 2));
    }
    return (
      <View key={round} style={[styles.bracketPage, { width: pageWidth }]}>
        {pairs.map(pair => (
          <View key={pair[0].id} style={styles.bmPair}>
            <View style={styles.bmPairCards}>{pair.map(renderMatch)}</View>
            {hasNextRound && pair.length === 2 && (
              <View style={styles.bmConnector}>
                <View style={[styles.bmConnectorSpine, { backgroundColor: colors.border }]} />
                <View style={[styles.bmConnectorArm, { backgroundColor: colors.border }]} />
                <TouchableOpacity
                  onPress={() => goToRound(roundIdx + 1)}
                  activeOpacity={0.7}
                  style={[
                    styles.bmConnectorBtn,
                    { backgroundColor: colors.statusMutedBg, borderColor: colors.border },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={roundLabel(roundNumbers[roundIdx + 1], totalRounds, t)}
                >
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
            )}
          </View>
        ))}
      </View>
    );
  };

  const sel = roundProgress(roundNumbers[selectedIdx] ?? totalRounds);

  return (
    <View style={styles.section}>
      {showTitle && (
        <Text size="xs" weight="semibold" color={colors.textMuted} style={styles.sectionTitle}>
          {t('tournamentDetail.bracket.sectionTitle').toUpperCase()}
        </Text>
      )}

      {/* Round selector chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.bracketChipsRow}
      >
        {roundNumbers.map((round, idx) => {
          const selected = idx === selectedIdx;
          const { complete } = roundProgress(round);
          return (
            <TouchableOpacity
              key={round}
              onPress={() => goToRound(idx)}
              activeOpacity={0.85}
              style={[
                styles.bracketChip,
                {
                  backgroundColor: selected ? colors.primary : colors.cardBackground,
                  borderColor: selected ? colors.primary : colors.border,
                },
              ]}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
            >
              {complete && (
                <Ionicons
                  name="checkmark-circle"
                  size={13}
                  color={selected ? '#ffffff' : colors.primary}
                />
              )}
              <Text
                size="xs"
                weight={selected ? 'semibold' : 'medium'}
                color={selected ? '#ffffff' : colors.textMuted}
              >
                {roundLabel(round, totalRounds, t)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Selected-round header with progress */}
      <View style={styles.bmRoundHeader}>
        <Text size="base" weight="bold" color={colors.text}>
          {roundLabel(roundNumbers[selectedIdx] ?? totalRounds, totalRounds, t)}
        </Text>
        {sel.total > 0 && (
          <View style={[styles.bmProgressPill, { backgroundColor: colors.statusMutedBg }]}>
            <Ionicons
              name={sel.complete ? 'checkmark-done' : 'ellipse-outline'}
              size={12}
              color={sel.complete ? colors.statusPositiveText : colors.textMuted}
            />
            <Text size="xs" weight="semibold" color={colors.textMuted}>
              {t('tournamentDetail.bracket.gamesProgress')
                .replace('{done}', String(sel.done))
                .replace('{total}', String(sel.total))}
            </Text>
          </View>
        )}
      </View>

      {/* Round pager — swipe or tap a chip to slide between rounds */}
      <View style={styles.bmPager} onLayout={e => setPageWidth(e.nativeEvent.layout.width)}>
        {pageWidth > 0 && (
          <ScrollView
            ref={pagerRef}
            horizontal
            pagingEnabled
            nestedScrollEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={e => onPagerSettle(e.nativeEvent.contentOffset.x)}
          >
            {roundNumbers.map((round, roundIdx) => renderRoundPage(round, roundIdx))}
          </ScrollView>
        )}
      </View>
    </View>
  );
};

export const BracketPlayerRow: React.FC<{
  label: string;
  seed?: number;
  kind: SlotKind;
  isWinner: boolean;
  isFinalWinner: boolean;
  decided: boolean;
  cells: Array<{ value: number; won: boolean }>;
  showCheck: boolean;
  players: Array<{ id: string; avatarUrl: string | null }>;
  onPlayerPress: (playerId: string) => void;
  colors: ScreenColors;
}> = ({
  label,
  seed,
  kind,
  isWinner,
  isFinalWinner,
  decided,
  cells,
  showCheck,
  players,
  onPlayerPress,
  colors,
}) => {
  const isPlayer = kind === 'player';
  const isLoser = decided && isPlayer && !isWinner;
  const winnerColor = isFinalWinner ? colors.championText : colors.primary;
  // Winner: bright + bold. Loser: muted. Undecided / non-player: neutral.
  const nameColor = !isPlayer || isLoser ? colors.textMuted : colors.text;
  // Within the score column, the set-winner's number is emphasized per column.
  const wonColor = isFinalWinner ? colors.championText : colors.text;

  return (
    <View style={styles.bmRow}>
      {isFinalWinner && (
        <Ionicons name="trophy" size={14} color={colors.championText} style={styles.bmRowCrown} />
      )}
      {isPlayer && players.length > 0 && (
        <View style={[styles.bmAvatarCluster, isLoser && styles.bmAvatarClusterDim]}>
          {players.map((p, i) => (
            <TouchableOpacity
              key={p.id}
              onPress={() => onPlayerPress(p.id)}
              activeOpacity={0.7}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              accessibilityRole="button"
              style={[
                styles.bmAvatar,
                { backgroundColor: colors.highlightBg },
                i > 0 && [styles.bmAvatarStacked, { borderColor: colors.cardBackground }],
              ]}
            >
              {p.avatarUrl ? (
                <Image source={{ uri: p.avatarUrl }} style={styles.bmAvatarImg} />
              ) : (
                <Ionicons name="person" size={13} color={colors.textMuted} />
              )}
            </TouchableOpacity>
          ))}
        </View>
      )}
      <View style={styles.bmNameWrap}>
        <Text
          size="sm"
          weight={isWinner ? 'bold' : 'medium'}
          color={nameColor}
          numberOfLines={1}
          style={styles.bmNameText}
        >
          {label}
        </Text>
        {isPlayer && seed !== undefined && (
          <Text size="xs" weight="medium" color={colors.textMuted}>
            ({seed})
          </Text>
        )}
      </View>
      {cells.length > 0 ? (
        <View style={styles.bmSetRow}>
          {cells.map((c, i) => (
            <Text
              key={i}
              size="sm"
              weight={c.won ? 'bold' : 'regular'}
              color={c.won ? wonColor : colors.textMuted}
              style={styles.bmSetCell}
            >
              {c.value}
            </Text>
          ))}
        </View>
      ) : showCheck ? (
        <Ionicons name="checkmark" size={16} color={winnerColor} style={styles.bmScore} />
      ) : null}
    </View>
  );
};

/** Row inside the header "⋯" overflow menu. */
