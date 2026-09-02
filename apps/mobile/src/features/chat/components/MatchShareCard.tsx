/**
 * MatchShareCard
 *
 * Renders a 'match_share' chat card: the game announcement that the
 * post_match_to_network_chats trigger posts into every community / player-group
 * chat the creator belongs to. Until now these rendered as a plain text bubble
 * ("New game · Aug 31"), which told you a game existed but gave you no way in.
 *
 * Unlike the Match Organizer card there is nothing to vote on — the game
 * already exists, so the only question is whether you're in, and joining
 * happens right here in one tap.
 *
 * The header reads the message metadata snapshot so it renders instantly and
 * still says what was announced if the game is later cancelled. Faces, spots,
 * court status and membership come from the live match row, the same row the
 * feed's MatchCard draws from, so the two agree on who is in and whether the
 * court is booked.
 *
 * Mirrors CourtSystemMessageCard: full-width, degrades to plain text without a
 * payload. Composes the shell's header styles directly because the leading
 * element is the avatar row, not an icon circle.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import {
  Button,
  PlayerSlotRow,
  SkeletonAvatar,
  Text,
  buildPlayerSlots,
  useToast,
} from '@rallia/shared-components';
import {
  accent,
  base,
  duration,
  radiusPixels,
  secondary,
  spacingPixels,
  status as statusColors,
} from '@rallia/design-system';
import { getMatchWithDetails } from '@rallia/shared-services';
import {
  createDateInTimezone,
  formatIntuitiveDateInTimezone,
  formatMatchDuration,
  lightHaptic,
  successHaptic,
  warningHaptic,
} from '@rallia/shared-utils';
import type { MatchShareMetadata, MessageWithSender } from '@rallia/shared-services';
import { useMatch, useMatchActions } from '@rallia/shared-hooks';

import type { MatchDetailData } from '#/context/MatchDetailSheetContext';
import { useMatchDetailSheet } from '#/context/MatchDetailSheetContext';
import * as Analytics from '#/services/analytics';
import { useAuth, useTranslation, useThemeStyles } from '#/hooks';
import { formatTimeOfDay } from '#/utils/dateFormatting';

import { ChatCardFallback, chatCardShell } from './ChatCardShell';

/** Beyond this, arming a state timer is pointless — the card re-mounts first. */
const STATE_TIMER_HORIZON_MS = 24 * 60 * 60 * 1000;
/** MatchCard's "starting soon" window. */
const SOON_WINDOW_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** PlayerSlotRow's avatar size, mirrored by the loading placeholder. */
const SLOT_SIZE = 32;

interface MatchShareCardProps {
  message: MessageWithSender;
}

export function MatchShareCard({ message }: MatchShareCardProps) {
  const { t, locale } = useTranslation();
  const { colors, isDark } = useThemeStyles();
  const { session } = useAuth();
  const { openSheet } = useMatchDetailSheet();
  const toast = useToast();
  const currentUserId = session?.user?.id;

  const metadata = (message.metadata ?? null) as MatchShareMetadata | null;
  const matchId = metadata?.match_id ?? null;

  const [isOpening, setIsOpening] = useState(false);

  const { match, isLoading, isSuccess } = useMatch(matchId ?? undefined);
  const { joinMatch, isJoining } = useMatchActions(matchId ?? undefined, {
    matchData: match ?? undefined,
    onJoinSuccess: result => {
      void successHaptic();
      // Not every game is direct-join; say which one this was.
      if (result?.status === 'requested') toast.success(t('quickGame.card.joinRequested'));
    },
    onJoinError: () => {
      void warningHaptic();
      toast.error(t('quickGame.card.joinFailed'));
    },
  });

  // The trigger writes match.format straight through, so narrow it once here
  // rather than casting at each use.
  const format: 'singles' | 'doubles' = metadata?.format === 'doubles' ? 'doubles' : 'singles';

  const isHost = !!currentUserId && metadata?.creator_id === currentUserId;
  const myParticipation = currentUserId
    ? (match?.participants ?? []).find(p => p.player_id === currentUserId)
    : undefined;
  const joined = myParticipation?.status === 'joined';
  // These games are request-to-join, so a tap does not put you in — it puts you
  // in a queue. The card has to say that, or it reads as a Join that failed.
  const requested = myParticipation?.status === 'requested';

  const totalSlots = format === 'doubles' ? 4 : 2;
  const takenSlots = (match?.participants ?? []).filter(p => p.status === 'joined').length;
  const spotsLeft = Math.max(0, totalSlots - takenSlots);
  const isCancelled = !!match?.cancelled_at;
  // The host counts as taken from the moment the game exists, so an unloaded
  // match would read "2 spots left" on a singles game and offer a Join that
  // could bounce. Say nothing until we know.
  const countsKnown = !!match && !isLoading;
  // The query came back and there is no game: deleted, or RLS hides it now. The
  // card must say so rather than sit on "Loading…" for good.
  const isGone = isSuccess && !match;

  // When the game starts and ends, in the COURT's timezone — comparing a
  // wall-clock to the device's zone is how a game reads as "expired" to a
  // travelling player and as live to everyone else. The live row wins over the
  // snapshot because the host may have moved the game since it was announced.
  const startsAt = useMemo(() => {
    const date = match?.match_date ?? metadata?.match_date;
    const time = match?.start_time ?? metadata?.start_time;
    if (!date || !time) return null;
    const zone =
      match?.timezone ?? metadata?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    return createDateInTimezone(date, time, zone);
  }, [match?.match_date, match?.start_time, match?.timezone, metadata]);

  const endsAt = useMemo(() => {
    const date = match?.match_date ?? metadata?.match_date;
    const time = match?.end_time ?? metadata?.end_time;
    if (!date || !time || !startsAt) return null;
    const zone =
      match?.timezone ?? metadata?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const end = createDateInTimezone(date, time, zone);
    // An end before the start means the game crosses midnight.
    if (end.getTime() <= startsAt.getTime()) end.setTime(end.getTime() + DAY_MS);
    return end;
  }, [match?.match_date, match?.end_time, match?.timezone, metadata, startsAt]);

  // Reading the clock during render is impure (React Compiler rejects it), and
  // polling every card in a long chat would be wasteful. Instead each card arms
  // ONE timer for its next state change: starting soon, kick-off, or the end.
  // A change further out than a day gets none: the card is re-mounted long
  // before then.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startsAt) return;
    const current = Date.now();
    const marks = [startsAt.getTime() - SOON_WINDOW_MS, startsAt.getTime(), endsAt?.getTime()];
    const next = marks
      .filter((m): m is number => m !== undefined && m > current)
      .sort((a, b) => a - b)[0];
    if (next === undefined || next - current > STATE_TIMER_HORIZON_MS) return;
    const id = setTimeout(() => setNow(Date.now()), next - current + 1000);
    return () => clearTimeout(id);
  }, [startsAt, endsAt, now]);

  const hasStarted = !!startsAt && startsAt.getTime() <= now;
  const hasEnded = !!endsAt && endsAt.getTime() <= now;
  const isStartingSoon = !!startsAt && !hasStarted && startsAt.getTime() - now < SOON_WINDOW_MS;
  // MatchCard's "expired": play began and the game never filled. It outranks
  // live, since a live indicator on a game nobody could play is a lie.
  const isUnfilled = countsKnown && !isCancelled && hasStarted && spotsLeft > 0;
  const showLive = hasStarted && !hasEnded && !isCancelled && !isUnfilled;
  const showSoon = isStartingSoon && !isCancelled;

  // One pulse drives both the live dot and the starting-soon glow, faster when
  // live, as on MatchCard.
  const pulse = useMemo(() => new Animated.Value(0), []);
  useEffect(() => {
    if (!showLive && !showSoon) return;
    const ms = showLive ? duration.extraSlow : duration.verySlow;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: ms,
          easing: Easing.bezier(0.4, 0, 0.2, 1),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: ms,
          easing: Easing.bezier(0.4, 0, 0.2, 1),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [showLive, showSoon, pulse]);

  const liveRingScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.8] });
  const liveRingOpacity = pulse.interpolate({
    inputRange: [0, 0.3, 1],
    outputRange: [0.6, 0.3, 0],
  });
  const liveDotOpacity = pulse.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0.7, 1] });
  const soonOpacity = pulse.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.5, 1, 0.5] });

  const liveColor = isDark ? secondary[400] : secondary[500];
  const soonColor = isDark ? accent[400] : accent[500];

  // "Tomorrow · 7:00 PM · 1h30" — read off the snapshot so the line is stable.
  const whenLabel = useMemo(() => {
    if (!metadata) return '';
    const intuitive = formatIntuitiveDateInTimezone(
      metadata.match_date,
      metadata.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      locale
    );
    const day = intuitive.translationKey ? t(intuitive.translationKey) : intuitive.label;
    const [h, m] = metadata.start_time.split(':').map(Number);
    const at = new Date();
    at.setHours(h, m, 0, 0);
    const parts = [day, formatTimeOfDay(at, locale)];
    if (metadata.end_time) parts.push(formatMatchDuration(metadata.start_time, metadata.end_time));
    return parts.join(' · ');
  }, [metadata, locale, t]);

  const formatLabel = t(format === 'doubles' ? 'quickGame.card.doubles' : 'quickGame.card.singles');

  // Promise chaining rather than try/finally: React Compiler bails out of a
  // component containing a try statement.
  const handleOpenMatch = useCallback(() => {
    if (!matchId || isOpening) return;
    void lightHaptic();
    setIsOpening(true);
    void getMatchWithDetails(matchId)
      .then(full => {
        if (full) openSheet(full as MatchDetailData, { source: 'chat_link' });
        else toast.error(t('chat.message.matchUnavailable'));
      })
      .catch(() => toast.error(t('chat.message.matchUnavailable')))
      .finally(() => setIsOpening(false));
  }, [matchId, isOpening, openSheet, toast, t]);

  const handleJoin = useCallback(() => {
    // hasStarted is re-checked here, not just in the render gate: a card drawn
    // seconds before kick-off would otherwise still accept the tap.
    if (!currentUserId || !matchId || hasStarted) return;
    void lightHaptic();
    Analytics.quickGameJoined({
      match_id: matchId,
      format,
      spots_left_before: spotsLeft,
    });
    joinMatch(currentUserId);
  }, [currentUserId, matchId, hasStarted, joinMatch, format, spotsLeft]);

  if (!metadata || !matchId) {
    return <ChatCardFallback text={message.content} colors={colors} />;
  }

  // Once you're in, the card's job is to point at the game chat, where the
  // where-and-what gets sorted out.
  const showJoin =
    countsKnown && !isHost && !joined && !requested && !isCancelled && !hasStarted && spotsLeft > 0;
  // The label has to match what the tap actually does on this game.
  const joinLabel =
    match?.join_mode === 'request' ? t('quickGame.card.askToJoin') : t('quickGame.card.join');
  // Cancelled outranks passed: it says why there is nothing to join. Once the
  // game has started, spot counts stop meaning anything, so they don't show.
  const spotsLabel = isGone
    ? t('quickGame.card.unavailable')
    : !countsKnown
      ? t('quickGame.card.loadingSpots')
      : isCancelled
        ? t('quickGame.card.cancelled')
        : showLive
          ? t('quickGame.card.live')
          : hasStarted
            ? t('quickGame.card.past')
            : spotsLeft === 0
              ? t('quickGame.card.full')
              : t('quickGame.card.spotsLeft', { count: spotsLeft });
  const subtitle = [metadata.sport_display, formatLabel, spotsLabel].filter(Boolean).join(' · ');

  const isCourtBooked = match?.court_status === 'reserved';
  // The count is precomputed by getMatchWithDetails from the facility
  // availability snapshot, only for future games with no court reserved.
  const openCourts =
    !isCourtBooked && !hasStarted && !isCancelled ? (match?.available_courts ?? 0) : 0;

  const titleColor = showLive ? liveColor : showSoon ? soonColor : colors.text;
  const slotTone = isUnfilled || hasEnded || isCancelled ? 'muted' : 'default';

  const chipTint = { backgroundColor: `${colors.primary}1A` };
  const chipNeutral = { backgroundColor: colors.buttonInactive };

  return (
    <View style={chatCardShell.wrapper}>
      <Pressable
        onPress={handleOpenMatch}
        style={[
          chatCardShell.card,
          { backgroundColor: colors.cardBackground, borderColor: colors.border },
        ]}
        accessibilityRole="button"
        accessibilityLabel={t('quickGame.card.title')}
      >
        {/* Faces lead: who is in, who hosts, how many seats are open. */}
        <View style={[chatCardShell.headerRow, styles.headerRow]}>
          {countsKnown && match ? (
            <PlayerSlotRow
              slots={buildPlayerSlots(match, totalSlots)}
              isDark={isDark}
              tone={slotTone}
            />
          ) : isLoading ? (
            <View style={styles.slotSkeletons}>
              {Array.from({ length: totalSlots }, (_, i) => (
                <SkeletonAvatar
                  key={i}
                  size={SLOT_SIZE}
                  style={i > 0 ? styles.slotSkeletonOverlap : undefined}
                  backgroundColor={colors.skeletonBackground}
                  highlightColor={colors.skeletonHighlight}
                />
              ))}
            </View>
          ) : null}
          <View style={chatCardShell.headerText}>
            <View style={styles.titleRow}>
              {showLive ? (
                <View style={styles.liveIndicator}>
                  <Animated.View
                    style={[
                      styles.liveRing,
                      {
                        backgroundColor: liveColor,
                        transform: [{ scale: liveRingScale }],
                        opacity: liveRingOpacity,
                      },
                    ]}
                  />
                  <Animated.View
                    style={[
                      styles.liveDot,
                      { backgroundColor: liveColor, opacity: liveDotOpacity },
                    ]}
                  />
                </View>
              ) : showSoon ? (
                <Animated.View style={[styles.soonIcon, { opacity: soonOpacity }]}>
                  <Ionicons name="time" size={14} color={soonColor} />
                </Animated.View>
              ) : null}
              <Text
                size="sm"
                weight="semibold"
                color={titleColor}
                lineHeight="tight"
                style={styles.titleText}
              >
                {whenLabel}
              </Text>
            </View>
            <Text
              size="xs"
              color={colors.textMuted}
              lineHeight="tight"
              style={chatCardShell.headerSubtitle}
            >
              {subtitle}
            </Text>
          </View>
        </View>

        {/* Chips scroll sideways rather than wrap, as on MatchCard, so the
            card keeps one height whatever the game carries. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          nestedScrollEnabled
          style={styles.chipsScroll}
          contentContainerStyle={styles.chipsContent}
        >
          <View style={[styles.tag, chipNeutral]}>
            <Ionicons name="location-outline" size={13} color={colors.textMuted} />
            <Text size="xs" color={colors.textMuted} numberOfLines={1}>
              {metadata.place_name ?? t('quickGame.card.locationTbd')}
            </Text>
          </View>
          {isCourtBooked ? (
            <View style={[styles.tag, chipTint]}>
              <Ionicons name="checkmark-circle" size={13} color={colors.primary} />
              <Text size="xs" weight="semibold" color={colors.primary}>
                {t('match.courtStatus.courtBooked')}
              </Text>
            </View>
          ) : openCourts > 0 ? (
            <View style={[styles.tag, chipTint]}>
              <Ionicons name="tennisball-outline" size={13} color={colors.primary} />
              <Text size="xs" weight="semibold" color={colors.primary}>
                {t('match.courtStatus.courtsAvailable', { count: openCourts })}
              </Text>
            </View>
          ) : null}
          {metadata.min_rating_label ? (
            <View style={[styles.tag, chipNeutral]}>
              <Ionicons name="trending-up-outline" size={13} color={colors.textMuted} />
              <Text size="xs" color={colors.textMuted}>
                {metadata.min_rating_label}
              </Text>
            </View>
          ) : null}
          {requested ? (
            <View style={[styles.tag, chipNeutral]}>
              <Ionicons name="hourglass-outline" size={13} color={colors.textMuted} />
              <Text size="xs" color={colors.textMuted}>
                {t('quickGame.card.requestPending')}
              </Text>
            </View>
          ) : joined || isHost ? (
            <View style={[styles.tag, { backgroundColor: `${statusColors.success.DEFAULT}1A` }]}>
              <Ionicons name="checkmark" size={13} color={statusColors.success.DEFAULT} />
              <Text size="xs" color={statusColors.success.DEFAULT}>
                {t(isHost ? 'quickGame.card.youHost' : 'quickGame.card.youIn')}
              </Text>
            </View>
          ) : null}
        </ScrollView>

        <View style={chatCardShell.cardCta}>
          {showJoin ? (
            <Button
              variant="primary"
              size="sm"
              fullWidth
              loading={isJoining}
              onPress={handleJoin}
              leftIcon={<Ionicons name="add" size={16} color={base.white} />}
            >
              {joinLabel}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              fullWidth
              loading={isOpening}
              onPress={handleOpenMatch}
            >
              {t('quickGame.card.viewGame')}
            </Button>
          )}
        </View>

        {/* Scrim + banner after the content so they paint on top: MatchCard's
            treatment for a game that began without filling. */}
        {isUnfilled ? (
          <>
            <View
              pointerEvents="none"
              style={[
                styles.unfilledScrim,
                { backgroundColor: isDark ? `${base.black}40` : `${base.white}73` },
              ]}
            />
            <View pointerEvents="none" style={styles.unfilledBannerWrap}>
              <View
                style={[
                  styles.unfilledBanner,
                  {
                    backgroundColor: `${isDark ? statusColors.error.light : statusColors.error.DEFAULT}E0`,
                  },
                ]}
              >
                <Ionicons name="close-circle" size={14} color={base.white} />
                <Text size="sm" weight="bold" color={base.white}>
                  {t('match.status.unfilled')}
                </Text>
              </View>
            </View>
          </>
        ) : null}
      </Pressable>
    </View>
  );
}

export default MatchShareCard;

const styles = StyleSheet.create({
  headerRow: {
    alignItems: 'center',
  },
  slotSkeletons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  slotSkeletonOverlap: {
    marginLeft: -8,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  titleText: {
    flexShrink: 1,
  },
  liveIndicator: {
    width: 12,
    height: 12,
    marginRight: spacingPixels[1.5],
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveRing: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  soonIcon: {
    marginRight: spacingPixels[1],
  },
  chipsScroll: {
    marginTop: spacingPixels[3],
  },
  chipsContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.full,
  },
  unfilledScrim: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: radiusPixels.xl,
  },
  unfilledBannerWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unfilledBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[2],
    borderRadius: radiusPixels.full,
    shadowColor: base.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
});
