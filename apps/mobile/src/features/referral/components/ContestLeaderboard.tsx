/**
 * ContestLeaderboard
 *
 * Enhancements:
 * - Podium view for top 3 (scale-in on mount)
 * - Staggered slide-in for rows #4+
 * - Animated countdown digits (scale pulse on change)
 * - Gap-to-next motivational text
 */

import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView, Image, Share, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text, Button } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import { lightHaptic } from '@rallia/shared-utils';
import type { ReferralContest, ReferralLeaderboardEntry, ContestRank } from '@rallia/shared-hooks';
import type { TranslationKey } from '../../../hooks/useTranslation';

// ============================================================================
// TYPES
// ============================================================================

interface ThemeColors {
  background: string;
  cardBackground: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  buttonActive: string;
  buttonInactive: string;
  buttonTextActive: string;
}

interface ContestLeaderboardProps {
  contest: ReferralContest;
  leaderboard: ReferralLeaderboardEntry[];
  myRank: ContestRank | null;
  referralLink: string | undefined;
  playerId: string | undefined;
  colors: ThemeColors;
  isDark: boolean;
  t: (key: TranslationKey) => string;
  compact?: boolean;
}

// ============================================================================
// COUNTDOWN HOOK
// ============================================================================

function useCountdown(endAt: string) {
  const calc = () => {
    const diff = new Date(endAt).getTime() - Date.now();
    if (diff <= 0) return { days: 0, hours: 0, minutes: 0, expired: true };
    return {
      days: Math.floor(diff / 86_400_000),
      hours: Math.floor((diff % 86_400_000) / 3_600_000),
      minutes: Math.floor((diff % 3_600_000) / 60_000),
      expired: false,
    };
  };
  const [remaining, setRemaining] = useState(calc);
  useEffect(() => {
    const id = setInterval(() => setRemaining(calc()), 60_000);
    return () => clearInterval(id);
  }, [endAt]);
  return remaining;
}

// ============================================================================
// PODIUM CONFIG
// Visual order: rank 2 (left) | rank 1 (center, tallest) | rank 3 (right)
// ============================================================================

const PODIUM = [
  {
    rank: 2,
    barHeight: 60,
    avatarSize: 36,
    medalColor: '#A8A9AD',
    entranceDelay: 120,
    countSize: 'xl' as const,
  },
  {
    rank: 1,
    barHeight: 88,
    avatarSize: 46,
    medalColor: '#FFD700',
    entranceDelay: 0,
    countSize: '2xl' as const,
  },
  {
    rank: 3,
    barHeight: 40,
    avatarSize: 30,
    medalColor: '#CD7F32',
    entranceDelay: 220,
    countSize: 'lg' as const,
  },
] as const;

// ============================================================================
// CROWN — floats above rank-1 avatar
// ============================================================================

const CrownBounce: React.FC = () => {
  const float = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(scale, {
      toValue: 1,
      damping: 8,
      stiffness: 200,
      useNativeDriver: true,
    }).start(() => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(float, { toValue: -4, duration: 1100, useNativeDriver: true }),
          Animated.timing(float, { toValue: 0, duration: 1100, useNativeDriver: true }),
        ])
      ).start();
    });
  }, []);

  return (
    <Animated.Text style={[styles.crownEmoji, { transform: [{ translateY: float }, { scale }] }]}>
      {'👑'}
    </Animated.Text>
  );
};

// ============================================================================
// COUNTDOWN UNIT — scale-pulses when the digit changes
// ============================================================================

const CountdownUnit: React.FC<{ value: number; label: string; colors: ThemeColors }> = ({
  value,
  label,
  colors,
}) => {
  const scale = useRef(new Animated.Value(1)).current;
  const prev = useRef(value);

  useEffect(() => {
    if (prev.current !== value) {
      prev.current = value;
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.35, duration: 100, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, damping: 6, stiffness: 200 }),
      ]).start();
    }
  }, [value]);

  return (
    <View style={styles.unit}>
      <Animated.View style={{ transform: [{ scale }] }}>
        <Text size="xl" weight="bold" color={colors.text}>
          {String(value).padStart(2, '0')}
        </Text>
      </Animated.View>
      <Text size="xs" color={colors.textMuted}>
        {label}
      </Text>
    </View>
  );
};

// ============================================================================
// PODIUM SLOT — animates in independently with staggered delay
// ============================================================================

interface PodiumSlotProps {
  rank: 1 | 2 | 3;
  barHeight: number;
  avatarSize: number;
  medalColor: string;
  entry: ReferralLeaderboardEntry | undefined;
  isMe: boolean;
  colors: ThemeColors;
  entranceDelay: number;
  countSize: 'lg' | 'xl' | '2xl';
}

const PodiumSlot: React.FC<PodiumSlotProps> = ({
  rank,
  barHeight,
  avatarSize,
  medalColor,
  entry,
  isMe,
  colors,
  entranceDelay,
  countSize,
}) => {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(18)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 260,
        delay: entranceDelay,
        useNativeDriver: true,
      }),
      Animated.spring(translateY, {
        toValue: 0,
        delay: entranceDelay,
        damping: 18,
        stiffness: 200,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const firstName = entry ? entry.displayName.split(' ')[0] : null;
  const isFirst = rank === 1;
  const ringSize = avatarSize + 8;

  return (
    <Animated.View style={[styles.podiumSlot, { opacity, transform: [{ translateY }] }]}>
      {/* Info above the bar */}
      <View style={styles.podiumInfo}>
        {isFirst && entry && <CrownBounce />}
        {entry ? (
          <>
            <View
              style={[
                styles.podiumAvatarRing,
                {
                  width: ringSize,
                  height: ringSize,
                  borderRadius: ringSize / 2,
                  borderColor: isMe ? colors.buttonActive : medalColor,
                  borderWidth: isFirst ? 3 : 2,
                  shadowColor: medalColor,
                  shadowOffset: { width: 0, height: 3 },
                  shadowOpacity: 0.45,
                  shadowRadius: 7,
                  elevation: 5,
                },
              ]}
            >
              {entry.avatarUrl ? (
                <Image
                  source={{ uri: entry.avatarUrl }}
                  style={{ width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2 }}
                />
              ) : (
                <View
                  style={[
                    styles.podiumAvatarFallback,
                    {
                      width: avatarSize,
                      height: avatarSize,
                      borderRadius: avatarSize / 2,
                      backgroundColor: colors.buttonInactive,
                    },
                  ]}
                >
                  <Ionicons
                    name="person-outline"
                    size={avatarSize * 0.45}
                    color={colors.textMuted}
                  />
                </View>
              )}
            </View>
            <Text
              size="xs"
              weight={isMe ? 'semibold' : 'medium'}
              color={isMe ? colors.buttonActive : colors.text}
              numberOfLines={1}
              style={styles.podiumName}
            >
              {isMe ? 'You' : firstName}
            </Text>
          </>
        ) : (
          <View
            style={[
              styles.podiumAvatarFallback,
              {
                width: avatarSize,
                height: avatarSize,
                borderRadius: avatarSize / 2,
                backgroundColor: `${colors.border}55`,
              },
            ]}
          >
            <Text size="xs" color={colors.textMuted}>
              {'?'}
            </Text>
          </View>
        )}
      </View>

      {/* Podium bar */}
      <View
        style={[
          styles.podiumBar,
          {
            height: barHeight,
            backgroundColor: entry ? medalColor : colors.buttonInactive,
          },
        ]}
      >
        {entry && (
          <Text size={countSize} weight="bold" color="#fff">
            {entry.referralCount}
          </Text>
        )}
      </View>
    </Animated.View>
  );
};

// ============================================================================
// PODIUM — three-column display; each slot animates in independently
// ============================================================================

const Podium: React.FC<{
  leaderboard: ReferralLeaderboardEntry[];
  playerId: string | undefined;
  colors: ThemeColors;
}> = ({ leaderboard, playerId, colors }) => {
  return (
    <View style={styles.podium}>
      {PODIUM.map(({ rank, barHeight, avatarSize, medalColor, entranceDelay, countSize }) => {
        const entry = leaderboard.find(e => e.rank === rank);
        return (
          <PodiumSlot
            key={rank}
            rank={rank}
            barHeight={barHeight}
            avatarSize={avatarSize}
            medalColor={medalColor}
            entry={entry}
            isMe={entry?.referrerId === playerId}
            colors={colors}
            entranceDelay={entranceDelay}
            countSize={countSize}
          />
        );
      })}
    </View>
  );
};

// ============================================================================
// ANIMATED ROW — slides in with a per-row delay (for #4+)
// ============================================================================

interface AnimatedRowProps {
  entry: ReferralLeaderboardEntry;
  isMe: boolean;
  index: number;
  colors: ThemeColors;
}

const AnimatedRow: React.FC<AnimatedRowProps> = ({ entry, isMe, index, colors }) => {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(10)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        delay: index * 50,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 200,
        delay: index * 50,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      <View
        style={[
          styles.row,
          { borderColor: colors.border },
          isMe && { backgroundColor: `${colors.buttonActive}14` },
        ]}
      >
        <Text size="sm" weight="bold" color={colors.textMuted} style={styles.rowRank}>
          #{entry.rank}
        </Text>
        {entry.avatarUrl ? (
          <Image source={{ uri: entry.avatarUrl }} style={styles.rowAvatar} />
        ) : (
          <View
            style={[
              styles.rowAvatar,
              styles.rowAvatarFallback,
              { backgroundColor: colors.buttonInactive },
            ]}
          >
            <Ionicons name="person-outline" size={14} color={colors.textMuted} />
          </View>
        )}
        <Text
          size="sm"
          weight={isMe ? 'semibold' : 'medium'}
          color={isMe ? colors.buttonActive : colors.text}
          style={styles.rowName}
          numberOfLines={1}
        >
          {isMe ? `${entry.displayName} (you)` : entry.displayName}
        </Text>
        <Text size="sm" weight="bold" color={isMe ? colors.buttonActive : colors.text}>
          {entry.referralCount}
        </Text>
      </View>
    </Animated.View>
  );
};

// ============================================================================
// GAP TEXT — motivational message based on user's standing
// ============================================================================

const GapText: React.FC<{
  myRank: ContestRank;
  leaderboard: ReferralLeaderboardEntry[];
  colors: ThemeColors;
  t: (key: TranslationKey) => string;
}> = ({ myRank, leaderboard, colors, t }) => {
  if (myRank.rank === 0) {
    return (
      <Text size="xs" color={colors.textMuted} style={styles.gapText}>
        {t('referral.contest.joinLeaderboard')}
      </Text>
    );
  }
  if (myRank.rank === 1) {
    return (
      <Text size="xs" weight="semibold" color={colors.buttonActive} style={styles.gapText}>
        {t('referral.contest.youreLeading')}
      </Text>
    );
  }
  const nextEntry = leaderboard.find(e => e.rank === myRank.rank - 1);
  if (!nextEntry) return null;
  const gap = nextEntry.referralCount - myRank.referralCount + 1;
  return (
    <Text size="xs" color={colors.textSecondary} style={styles.gapText}>
      {t('referral.contest.referMore')
        .replace('{count}', String(gap))
        .replace('{rank}', String(myRank.rank - 1))}
    </Text>
  );
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const ContestLeaderboard: React.FC<ContestLeaderboardProps> = ({
  contest,
  leaderboard,
  myRank,
  referralLink,
  playerId,
  colors,
  isDark,
  t,
  compact = false,
}) => {
  const { days, hours, minutes, expired } = useCountdown(contest.endAt);

  const handleShare = async () => {
    if (!referralLink) return;
    lightHaptic();
    try {
      await Share.share({ message: referralLink });
    } catch {
      // user cancelled
    }
  };

  const topEntries = leaderboard.filter(e => e.rank <= 3);
  const lowerEntries = leaderboard.filter(e => e.rank > 3);
  const myEntryInList = leaderboard.some(e => e.referrerId === playerId);
  const showMyRow = !!myRank && myRank.rank > 0 && !myEntryInList;

  // ── Compact (inside expandable banner) ──────────────────────────────────────
  if (compact) {
    return (
      <View style={styles.compactWrapper}>
        {leaderboard.length === 0 ? (
          <Text size="sm" color={colors.textMuted} style={styles.emptyText}>
            {t('referral.contest.noEntries')}
          </Text>
        ) : (
          <Podium leaderboard={topEntries} playerId={playerId} colors={colors} />
        )}

        {/* User's own row when outside top 3 */}
        {showMyRow && myRank && (
          <View
            style={[
              styles.myRow,
              {
                borderColor: `${colors.buttonActive}40`,
                backgroundColor: `${colors.buttonActive}10`,
              },
            ]}
          >
            <View
              style={[
                styles.rowAvatarFallback,
                styles.rowAvatar,
                { backgroundColor: colors.buttonInactive },
              ]}
            >
              <Ionicons name="person-outline" size={14} color={colors.textMuted} />
            </View>
            <Text size="sm" weight="semibold" color={colors.buttonActive} style={styles.rowName}>
              You · #{myRank.rank}
            </Text>
            <Text size="sm" weight="bold" color={colors.buttonActive}>
              {myRank.referralCount}
            </Text>
          </View>
        )}

        {/* Gap text */}
        {myRank && <GapText myRank={myRank} leaderboard={leaderboard} colors={colors} t={t} />}
      </View>
    );
  }

  // ── Full (standalone / future full-screen use) ───────────────────────────────
  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      {/* Prize banner */}
      <View
        style={[
          styles.banner,
          { backgroundColor: `${colors.buttonActive}14`, borderColor: `${colors.buttonActive}40` },
        ]}
      >
        <Ionicons name="trophy-outline" size={20} color={colors.buttonActive} />
        <View style={styles.bannerText}>
          <Text size="sm" weight="semibold" color={colors.buttonActive}>
            {contest.title}
          </Text>
          <Text size="xs" color={colors.textSecondary}>
            {contest.prizeDescription}
          </Text>
        </View>
      </View>

      {/* Countdown */}
      <View style={[styles.countdown, { backgroundColor: colors.buttonInactive }]}>
        {expired ? (
          <Text size="sm" color={colors.textMuted} style={{ textAlign: 'center' }}>
            {t('referral.contest.ended')}
          </Text>
        ) : (
          <>
            <Text size="xs" color={colors.textMuted} style={styles.countdownLabel}>
              {t('referral.contest.endsIn')}
            </Text>
            <View style={styles.countdownRow}>
              <CountdownUnit value={days} label={t('referral.contest.days')} colors={colors} />
              <Text size="xl" weight="bold" color={colors.textMuted} style={styles.colon}>
                :
              </Text>
              <CountdownUnit value={hours} label={t('referral.contest.hours')} colors={colors} />
              <Text size="xl" weight="bold" color={colors.textMuted} style={styles.colon}>
                :
              </Text>
              <CountdownUnit
                value={minutes}
                label={t('referral.contest.minutes')}
                colors={colors}
              />
            </View>
          </>
        )}
      </View>

      {/* Podium */}
      {leaderboard.length > 0 ? (
        <Podium leaderboard={topEntries} playerId={playerId} colors={colors} />
      ) : (
        <Text size="sm" color={colors.textMuted} style={styles.emptyText}>
          {t('referral.contest.noEntries')}
        </Text>
      )}

      {/* Rows #4+ */}
      {lowerEntries.map((entry, i) => (
        <AnimatedRow
          key={entry.referrerId}
          entry={entry}
          isMe={entry.referrerId === playerId}
          index={i}
          colors={colors}
        />
      ))}

      {/* User's own row when outside the visible list */}
      {showMyRow && myRank && (
        <View
          style={[
            styles.myRow,
            {
              borderColor: `${colors.buttonActive}40`,
              backgroundColor: `${colors.buttonActive}10`,
            },
          ]}
        >
          <View
            style={[
              styles.rowAvatarFallback,
              styles.rowAvatar,
              { backgroundColor: colors.buttonInactive },
            ]}
          >
            <Ionicons name="person-outline" size={14} color={colors.textMuted} />
          </View>
          <Text size="sm" weight="semibold" color={colors.buttonActive} style={styles.rowName}>
            You · #{myRank.rank}
          </Text>
          <Text size="sm" weight="bold" color={colors.buttonActive}>
            {myRank.referralCount}
          </Text>
        </View>
      )}

      {/* Gap text */}
      {myRank && <GapText myRank={myRank} leaderboard={leaderboard} colors={colors} t={t} />}

      {/* CTA */}
      {!expired && (
        <Button
          variant="primary"
          size="md"
          fullWidth
          onPress={handleShare}
          leftIcon={<Ionicons name="share-outline" size={20} color="#FFFFFF" />}
          isDark={isDark}
          style={styles.cta}
        >
          {t('referral.shareInvite')}
        </Button>
      )}
    </ScrollView>
  );
};

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrollContent: {
    paddingHorizontal: spacingPixels[6],
    paddingTop: spacingPixels[4],
    paddingBottom: spacingPixels[8],
    gap: spacingPixels[4],
  },
  compactWrapper: {
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[3],
    paddingBottom: spacingPixels[4],
    gap: spacingPixels[3],
  },
  // Countdown
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
  },
  bannerText: { flex: 1, gap: 2 },
  countdown: {
    alignItems: 'center',
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
  },
  countdownLabel: { marginBottom: spacingPixels[2] },
  countdownRow: { flexDirection: 'row', alignItems: 'center' },
  unit: { alignItems: 'center', minWidth: 56 },
  colon: { marginHorizontal: 2, marginBottom: 14 },
  // Podium
  podium: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 6,
  },
  podiumSlot: {
    flex: 1,
    alignItems: 'center',
  },
  podiumInfo: {
    alignItems: 'center',
    paddingBottom: spacingPixels[2],
    gap: 4,
  },
  podiumAvatarRing: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  podiumAvatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  podiumName: {
    maxWidth: 80,
    textAlign: 'center',
  },
  podiumBar: {
    width: '100%',
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  crownEmoji: {
    fontSize: 18,
    lineHeight: 22,
  },
  // Rows (#4+)
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[2],
    borderRadius: radiusPixels.md,
    borderWidth: 1,
  },
  rowRank: {
    minWidth: 32,
    textAlign: 'center',
    marginRight: spacingPixels[2],
  },
  rowAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    marginRight: spacingPixels[2],
  },
  rowAvatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowName: { flex: 1 },
  // User's own row (outside top list)
  myRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[2],
    borderRadius: radiusPixels.md,
    borderWidth: 1,
    gap: spacingPixels[2],
  },
  // Gap text
  gapText: {
    textAlign: 'center',
  },
  // Misc
  emptyText: {
    textAlign: 'center',
    paddingVertical: spacingPixels[4],
  },
  cta: { marginTop: spacingPixels[2] },
});
