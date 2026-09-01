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
 * still says what was announced if the game is later cancelled. Spots and
 * membership come from the live match row.
 *
 * Mirrors CourtSystemMessageCard: full-width, degrades to plain text without a
 * payload.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, Text, useToast } from '@rallia/shared-components';
import { base, spacingPixels, radiusPixels, status as statusColors } from '@rallia/design-system';
import { getMatchWithDetails } from '@rallia/shared-services';
import {
  createDateInTimezone,
  formatIntuitiveDateInTimezone,
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

import { ChatCardFallback, ChatCardHeader, chatCardShell } from './ChatCardShell';

/** Beyond this, arming a kick-off timer is pointless — the card re-mounts first. */
const KICKOFF_TIMER_HORIZON_MS = 24 * 60 * 60 * 1000;

interface MatchShareCardProps {
  message: MessageWithSender;
}

export function MatchShareCard({ message }: MatchShareCardProps) {
  const { t, locale } = useTranslation();
  const { colors } = useThemeStyles();
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

  // When the game starts, in the COURT's timezone — comparing a wall-clock to
  // the device's zone is how a game reads as "expired" to a travelling player
  // and as live to everyone else. The live row wins over the snapshot because
  // the host may have moved the game since it was announced.
  const startsAt = useMemo(() => {
    const date = match?.match_date ?? metadata?.match_date;
    const time = match?.start_time ?? metadata?.start_time;
    if (!date || !time) return null;
    const zone =
      match?.timezone ?? metadata?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    return createDateInTimezone(date, time, zone);
  }, [match?.match_date, match?.start_time, match?.timezone, metadata]);

  // Reading the clock during render is impure (React Compiler rejects it), and
  // polling every card in a long chat would be wasteful. Instead each card arms
  // ONE timer that fires exactly at its own kick-off. A game further out than a
  // day gets none: the card is re-mounted long before then.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startsAt) return;
    const delay = startsAt.getTime() - Date.now();
    if (delay <= 0 || delay > KICKOFF_TIMER_HORIZON_MS) return;
    const id = setTimeout(() => setNow(Date.now()), delay + 1000);
    return () => clearTimeout(id);
  }, [startsAt]);

  const hasStarted = !!startsAt && startsAt.getTime() <= now;

  // "Tomorrow at 7:00 PM" — read off the snapshot so the line is stable.
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
    return `${day} · ${formatTimeOfDay(at, locale)}`;
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
  const subtitle = isGone
    ? t('quickGame.card.unavailable')
    : !countsKnown
      ? t('quickGame.card.loadingSpots')
      : isCancelled
        ? t('quickGame.card.cancelled')
        : hasStarted
          ? t('quickGame.card.past')
          : spotsLeft === 0
            ? t('quickGame.card.full')
            : t('quickGame.card.spotsLeft', { count: spotsLeft });

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
        <ChatCardHeader
          icon="flash-outline"
          accent={colors.primary}
          title={`${whenLabel} · ${formatLabel}`}
          subtitle={metadata.sport_display ? `${metadata.sport_display} · ${subtitle}` : subtitle}
          colors={colors}
        />

        <View style={styles.metaRow}>
          <View style={[styles.tag, { backgroundColor: colors.buttonInactive }]}>
            <Ionicons name="location-outline" size={13} color={colors.textMuted} />
            <Text size="xs" color={colors.textMuted} numberOfLines={1}>
              {metadata.place_name ?? t('quickGame.card.locationTbd')}
            </Text>
          </View>
          {metadata.min_rating_label ? (
            <View style={[styles.tag, { backgroundColor: colors.buttonInactive }]}>
              <Ionicons name="trending-up-outline" size={13} color={colors.textMuted} />
              <Text size="xs" color={colors.textMuted}>
                {metadata.min_rating_label}
              </Text>
            </View>
          ) : null}
          {requested ? (
            <View style={[styles.tag, { backgroundColor: colors.buttonInactive }]}>
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
        </View>

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
      </Pressable>
    </View>
  );
}

export default MatchShareCard;

const styles = StyleSheet.create({
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacingPixels[2],
    marginTop: spacingPixels[3],
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.full,
  },
});
