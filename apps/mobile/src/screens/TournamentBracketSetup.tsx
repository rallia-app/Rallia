/**
 * TournamentBracketSetup Screen
 *
 * Organizer-only surface shown after registration closes and before the bracket
 * is published. Lets the organizer order the seeds (optional) with a live
 * round-1 preview, then publish — which generates the bracket, flips the
 * tournament to in_progress, and notifies participants.
 *
 * Seeding is optional: the list defaults to registration order. Seed order
 * fully determines first-round pairings, so reordering here IS the bracket
 * tweak. Publish is the irreversible commit.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { Text, useToast } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, primary } from '@rallia/design-system';
import { lightHaptic, successHaptic, warningHaptic, getHumanName } from '@rallia/shared-utils';
import {
  useTournament,
  useTournamentRegistrations,
  useProfilesByIds,
  useTournamentBracketPreview,
  useSetTournamentSeeds,
  useGenerateTournamentBracket,
} from '@rallia/shared-hooks';
import type { PreviewBracketMatch } from '@rallia/shared-services';

import { useThemeStyles, useTranslation } from '../hooks';
import { ConfirmationModal } from '../components/ConfirmationModal';
import type { RootStackParamList } from '../navigation';

type Route = RouteProp<RootStackParamList, 'TournamentBracketSetup'>;
type Nav = NativeStackNavigationProp<RootStackParamList>;

const SEED_PERSIST_DEBOUNCE_MS = 600;

type ThemeColors = ReturnType<typeof useThemeStyles>['colors'];

/** One side of a round-1 matchup card: seed chip + player label (or a bye). */
function PreviewSide({
  isBye,
  seed,
  name,
  colors,
  accent,
}: {
  isBye: boolean;
  seed: number | undefined;
  name: string;
  colors: ThemeColors;
  accent: string;
}) {
  return (
    <View style={styles.previewSide}>
      <View
        style={[
          styles.seedChip,
          isBye
            ? { backgroundColor: 'transparent', borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth }
            : { backgroundColor: `${accent}1A` },
        ]}
      >
        <Text size="xs" weight="bold" color={isBye ? colors.textMuted : accent}>
          {isBye ? '–' : String(seed ?? '?')}
        </Text>
      </View>
      <Text
        size="base"
        weight={isBye ? 'regular' : 'medium'}
        color={isBye ? colors.textMuted : colors.text}
        numberOfLines={1}
        style={styles.previewName}
      >
        {name}
      </Text>
    </View>
  );
}

export default function TournamentBracketSetup() {
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Route>();
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const toast = useToast();
  const accent = isDark ? primary[500] : primary[600];

  const { data: tournament } = useTournament(params.tournamentId);
  const { data: registrations = [] } = useTournamentRegistrations(params.tournamentId);

  const registered = useMemo(
    () => registrations.filter(r => r.status === 'registered'),
    [registrations]
  );

  // Names: registration_id -> display label (pair label for doubles).
  const userIds = useMemo(
    () => registered.flatMap(r => (r.partner_user_id ? [r.user_id, r.partner_user_id] : [r.user_id])),
    [registered]
  );
  const { data: profiles } = useProfilesByIds(userIds);
  const nameByRegId = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of registered) {
      const p = profiles?.[r.user_id];
      const name = p ? getHumanName(p, '') : '';
      const partner = r.partner_user_id ? profiles?.[r.partner_user_id] : undefined;
      const partnerName = partner ? getHumanName(partner, '') : '';
      map.set(r.id, partnerName && name ? `${name} & ${partnerName}` : name || '—');
    }
    return map;
  }, [registered, profiles]);

  // Local seed order (registration ids). Defaults to seed_rank then registration time.
  const [order, setOrder] = useState<string[]>([]);
  const initializedRef = useRef(false);
  useEffect(() => {
    if (initializedRef.current || registered.length === 0) return;
    const sorted = [...registered]
      .sort((a, b) => {
        const sa = a.seed_rank ?? Number.MAX_SAFE_INTEGER;
        const sb = b.seed_rank ?? Number.MAX_SAFE_INTEGER;
        if (sa !== sb) return sa - sb;
        const ta = new Date(a.registered_at).getTime();
        const tb = new Date(b.registered_at).getTime();
        if (ta !== tb) return ta - tb;
        return a.id.localeCompare(b.id);
      })
      .map(r => r.id);
    setOrder(sorted);
    initializedRef.current = true;
  }, [registered]);

  const canPreview = tournament?.status === 'registration_closed' && registered.length >= 2;
  const { data: preview = [] } = useTournamentBracketPreview(params.tournamentId, !!canPreview);
  const setSeeds = useSetTournamentSeeds();
  const generate = useGenerateTournamentBracket();

  // Debounced persistence of the local order so the preview re-renders.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistSeeds = useCallback(
    (next: string[]) => {
      if (!tournament || next.length < 2) return;
      setSeeds.mutate({
        tournamentId: params.tournamentId,
        orderedRegistrationIds: next,
        versionWas: tournament.version,
      });
    },
    [tournament, params.tournamentId, setSeeds]
  );

  const reorder = useCallback(
    (from: number, to: number) => {
      if (to < 0 || to >= order.length || from === to) return;
      lightHaptic();
      const next = [...order];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      setOrder(next);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => persistSeeds(next), SEED_PERSIST_DEBOUNCE_MS);
    },
    [order, persistSeeds]
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Round-1 matchups for the preview, in bracket order.
  const round1 = useMemo(
    () =>
      preview
        .filter((m: PreviewBracketMatch) => m.round_number === 1)
        .sort((a, b) => a.match_position - b.match_position),
    [preview]
  );
  const totalRounds = useMemo(
    () => (preview.length ? Math.max(...preview.map(m => m.round_number)) : 0),
    [preview]
  );
  const byeCount = useMemo(
    () => round1.filter(m => m.player1_is_bye || m.player2_is_bye).length,
    [round1]
  );

  // registration_id -> seed number (1-indexed), from the current local order.
  const seedByRegId = useMemo(() => {
    const m = new Map<string, number>();
    order.forEach((id, i) => m.set(id, i + 1));
    return m;
  }, [order]);

  const [confirmVisible, setConfirmVisible] = useState(false);

  const onPublish = useCallback(async () => {
    if (!tournament) return;
    setConfirmVisible(false);
    try {
      // Flush the latest order synchronously, then publish.
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (order.length >= 2) {
        await setSeeds.mutateAsync({
          tournamentId: params.tournamentId,
          orderedRegistrationIds: order,
          versionWas: tournament.version,
        });
      }
      await generate.mutateAsync({
        tournamentId: params.tournamentId,
        versionWas: tournament.version,
      });
      successHaptic();
      navigation.goBack();
    } catch (e) {
      warningHaptic();
      const msg = e instanceof Error ? e.message.toLowerCase() : '';
      const key = msg.includes('insufficient')
        ? 'tournamentDetail.generateBracketErrors.insufficientParticipants'
        : msg.includes('already_generated')
          ? 'tournamentDetail.generateBracketErrors.alreadyGenerated'
          : 'tournamentDetail.generateBracketErrors.generic';
      toast.error(t(key));
    }
  }, [tournament, order, params.tournamentId, setSeeds, generate, navigation, toast, t]);

  const publishing = setSeeds.isPending || generate.isPending;

  if (!tournament) {
    return (
      <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]} edges={['bottom']}>
        <View style={styles.center}>
          <ActivityIndicator color={accent} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Intro tip */}
        <View style={[styles.tip, { backgroundColor: `${accent}14` }]}>
          <Ionicons name="podium-outline" size={18} color={accent} style={styles.tipIcon} />
          <Text size="sm" color={colors.textSecondary} lineHeight="tight" style={styles.tipText}>
            {t('bracketSetup.intro')}
          </Text>
        </View>

        {/* Seeds */}
        <View style={styles.sectionHeader}>
          <Text size="xs" weight="bold" color={colors.textSecondary} style={styles.sectionLabel}>
            {t('bracketSetup.seedsLabel')}
          </Text>
          <View style={[styles.countPill, { backgroundColor: `${accent}14` }]}>
            <Text size="xs" weight="semibold" color={accent}>
              {order.length}
            </Text>
          </View>
        </View>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {order.map((regId, idx) => {
            const isTop = idx === 0;
            const isLast = idx === order.length - 1;
            return (
              <View
                key={regId}
                style={[
                  styles.seedRow,
                  idx > 0 && {
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: colors.border,
                  },
                ]}
              >
                <View
                  style={[
                    styles.seedBadge,
                    isTop
                      ? { backgroundColor: accent }
                      : { backgroundColor: `${accent}1A` },
                  ]}
                >
                  <Text size="sm" weight="bold" color={isTop ? '#ffffff' : accent}>
                    {idx + 1}
                  </Text>
                </View>
                <Text
                  size="base"
                  weight="medium"
                  color={colors.text}
                  style={styles.seedName}
                  numberOfLines={1}
                >
                  {nameByRegId.get(regId) ?? '—'}
                </Text>
                <View style={[styles.seedControls, { backgroundColor: colors.background }]}>
                  <TouchableOpacity
                    onPress={() => reorder(idx, 0)}
                    disabled={isTop}
                    hitSlop={6}
                    style={styles.ctrlBtn}
                    accessibilityLabel={t('bracketSetup.moveToTop')}
                  >
                    <Ionicons
                      name="arrow-up-circle-outline"
                      size={24}
                      color={isTop ? colors.buttonInactive : colors.textMuted}
                    />
                  </TouchableOpacity>
                  <View style={[styles.ctrlDivider, { backgroundColor: colors.border }]} />
                  <TouchableOpacity
                    onPress={() => reorder(idx, idx - 1)}
                    disabled={isTop}
                    hitSlop={6}
                    style={styles.ctrlBtn}
                    accessibilityLabel={t('bracketSetup.moveUp')}
                  >
                    <Ionicons
                      name="chevron-up"
                      size={22}
                      color={isTop ? colors.buttonInactive : accent}
                    />
                  </TouchableOpacity>
                  <View style={[styles.ctrlDivider, { backgroundColor: colors.border }]} />
                  <TouchableOpacity
                    onPress={() => reorder(idx, idx + 1)}
                    disabled={isLast}
                    hitSlop={6}
                    style={styles.ctrlBtn}
                    accessibilityLabel={t('bracketSetup.moveDown')}
                  >
                    <Ionicons
                      name="chevron-down"
                      size={22}
                      color={isLast ? colors.buttonInactive : accent}
                    />
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>

        {/* Round 1 preview */}
        <View style={[styles.sectionHeader, styles.previewHeader]}>
          <Text size="xs" weight="bold" color={colors.textSecondary} style={styles.sectionLabel}>
            {t('bracketSetup.previewLabel')}
          </Text>
          {totalRounds > 0 && (
            <Text size="xs" color={colors.textMuted}>
              {t('bracketSetup.previewSummary')
                .replace('{players}', String(registered.length))
                .replace('{rounds}', String(totalRounds))
                .replace('{byes}', String(byeCount))}
            </Text>
          )}
        </View>
        <View style={styles.matchList}>
          {round1.map((m, idx) => {
            const seed1 = seedByRegId.get(m.player1_registration_id);
            const seed2 = seedByRegId.get(m.player2_registration_id);
            return (
              <View
                key={`${m.round_number}-${m.match_position}`}
                style={[styles.matchCard, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <PreviewSide
                  isBye={m.player1_is_bye}
                  seed={seed1}
                  name={m.player1_is_bye ? t('tournamentDetail.bracket.bye') : nameByRegId.get(m.player1_registration_id) ?? '—'}
                  colors={colors}
                  accent={accent}
                />
                <View style={styles.vsRow}>
                  <View style={[styles.vsLine, { backgroundColor: colors.border }]} />
                  <Text size="xs" weight="semibold" color={colors.textMuted} style={styles.vsLabel}>
                    {t('bracketSetup.vs')}
                  </Text>
                  <View style={[styles.vsLine, { backgroundColor: colors.border }]} />
                </View>
                <PreviewSide
                  isBye={m.player2_is_bye}
                  seed={seed2}
                  name={m.player2_is_bye ? t('tournamentDetail.bracket.bye') : nameByRegId.get(m.player2_registration_id) ?? '—'}
                  colors={colors}
                  accent={accent}
                />
              </View>
            );
          })}
        </View>
      </ScrollView>

      {/* Publish */}
      <View style={[styles.footer, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
        <TouchableOpacity
          style={[styles.publishBtn, { backgroundColor: accent }, publishing && styles.disabled]}
          onPress={() => {
            lightHaptic();
            setConfirmVisible(true);
          }}
          disabled={publishing || registered.length < 2}
          accessibilityRole="button"
        >
          {publishing ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <>
              <Ionicons name="rocket-outline" size={18} color="#ffffff" />
              <Text size="base" weight="bold" color="#ffffff">
                {t('bracketSetup.publish')}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      <ConfirmationModal
        visible={confirmVisible}
        title={t('bracketSetup.confirmTitle')}
        message={t('bracketSetup.confirmMessage')}
        confirmLabel={t('bracketSetup.confirmCta')}
        cancelLabel={t('common.cancel')}
        onConfirm={onPublish}
        onClose={() => setConfirmVisible(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacingPixels[4], paddingBottom: spacingPixels[10] },

  // Intro tip
  tip: {
    flexDirection: 'row',
    gap: spacingPixels[2.5],
    padding: spacingPixels[3],
    borderRadius: radiusPixels.xl,
    marginBottom: spacingPixels[5],
  },
  tipIcon: { marginTop: 1 },
  tipText: { flex: 1 },

  // Section headers
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacingPixels[2],
  },
  previewHeader: { marginTop: spacingPixels[6] },
  sectionLabel: { textTransform: 'uppercase', letterSpacing: 0.6 },
  countPill: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: spacingPixels[1.5],
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Seed list
  card: { borderRadius: radiusPixels.xl, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  seedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacingPixels[2.5],
    paddingLeft: spacingPixels[3],
    paddingRight: spacingPixels[2],
    gap: spacingPixels[3],
  },
  seedBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seedName: { flex: 1 },
  seedControls: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radiusPixels.lg,
    paddingHorizontal: spacingPixels[1],
  },
  ctrlBtn: { paddingHorizontal: spacingPixels[1.5], paddingVertical: spacingPixels[1.5] },
  ctrlDivider: { width: StyleSheet.hairlineWidth, height: 18 },

  // Preview matchup cards
  matchList: { gap: spacingPixels[2.5] },
  matchCard: {
    borderRadius: radiusPixels.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[3.5],
  },
  previewSide: { flexDirection: 'row', alignItems: 'center', gap: spacingPixels[2.5] },
  seedChip: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewName: { flex: 1 },
  vsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    paddingVertical: spacingPixels[1.5],
    paddingLeft: spacingPixels[9],
  },
  vsLine: { flex: 1, height: StyleSheet.hairlineWidth },
  vsLabel: { textTransform: 'uppercase', letterSpacing: 0.5 },

  // Publish
  footer: {
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[3],
    paddingBottom: spacingPixels[2],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  publishBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[2],
    height: 52,
    borderRadius: radiusPixels.xl,
  },
  disabled: { opacity: 0.6 },
});
