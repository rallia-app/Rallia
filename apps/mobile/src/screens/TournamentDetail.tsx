/**
 * TournamentDetail Screen
 *
 * Read-only summary plus organizer/registrant action affordances.
 *
 * V1: hero, format/schedule/visibility cards, "Coming soon" placeholder.
 * V2: open/close registration (organizer), self-register/withdraw
 *     (registrant), registrations count.
 *
 * Spec: specs/17-leagues-tournaments/rollout.md §V1, §V2
 */

import React, { useMemo, useCallback, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  Modal,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import { Text, useToast } from '@rallia/shared-components';
import {
  lightTheme,
  darkTheme,
  spacingPixels,
  radiusPixels,
  primary,
  neutral,
} from '@rallia/design-system';
import { lightHaptic, successHaptic, warningHaptic, getHumanName } from '@rallia/shared-utils';
import {
  useTheme,
  useTournament,
  useTournamentRegistrations,
  useMyTournamentRegistration,
  useOpenTournamentRegistration,
  useCloseTournamentRegistration,
  useRegisterForTournament,
  useWithdrawFromTournament,
  useTournamentMatches,
  useGenerateTournamentBracket,
  useLinkableMatchesForSlot,
  useAttachMatchToTournamentSlot,
  useProfilesByIds,
  useSports,
  useAuth,
} from '@rallia/shared-hooks';
import type { Enums, Tables } from '@rallia/shared-types';
import type { LinkableMatch } from '@rallia/shared-services';

import { useTranslation, type TranslationKey } from '../hooks';
import { SportIcon } from '../components/SportIcon';
import type { RootStackParamList } from '../navigation';

type TournamentDetailRoute = RouteProp<RootStackParamList, 'TournamentDetail'>;

type Status = Enums<'tournament_status'>;
type Visibility = Enums<'tournament_visibility'>;
type RegistrationMode = Enums<'tournament_registration_mode'>;
type BracketType = Enums<'bracket_type'>;
type EntryFormat = Enums<'entry_format'>;

const VISIBILITY_LABEL_KEY: Record<Visibility, string> = {
  private: 'tournamentDetail.values.private',
  public: 'tournamentDetail.values.public',
  community: 'tournamentDetail.values.community',
};
const REG_MODE_LABEL_KEY: Record<RegistrationMode, string> = {
  open: 'tournamentDetail.values.open',
  approval: 'tournamentDetail.values.approval',
  invite_only: 'tournamentDetail.values.inviteOnly',
};
const BRACKET_TYPE_LABEL_KEY: Record<BracketType, string> = {
  single_elimination: 'tournamentDetail.values.singleElimination',
  double_elimination: 'tournamentDetail.values.doubleElimination',
};
const ENTRY_FORMAT_LABEL_KEY: Record<EntryFormat, string> = {
  singles: 'tournamentDetail.values.singles',
  doubles: 'tournamentDetail.values.doubles',
  mixed_doubles: 'tournamentDetail.values.mixedDoubles',
};

const STATUS_TONE: Record<Status, 'neutral' | 'positive' | 'active' | 'muted'> = {
  draft: 'neutral',
  registration_open: 'positive',
  registration_closed: 'neutral',
  in_progress: 'active',
  completed: 'muted',
  cancelled: 'muted',
  archived: 'muted',
};

interface ScreenColors {
  background: string;
  cardBackground: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  primary: string;
  badgeBg: string;
  statusNeutralBg: string;
  statusNeutralText: string;
  statusPositiveBg: string;
  statusPositiveText: string;
  statusActiveBg: string;
  statusActiveText: string;
  statusMutedBg: string;
  statusMutedText: string;
}

// =============================================================================

const InfoRow: React.FC<{ label: string; value: string; colors: ScreenColors }> = ({
  label,
  value,
  colors,
}) => (
  <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
    <Text size="sm" color={colors.textMuted}>
      {label}
    </Text>
    <Text size="base" weight="semibold" color={colors.text}>
      {value}
    </Text>
  </View>
);

const Section: React.FC<{ title: string; children: React.ReactNode; colors: ScreenColors }> = ({
  title,
  children,
  colors,
}) => (
  <View style={styles.section}>
    <Text size="xs" weight="semibold" color={colors.textMuted} style={styles.sectionTitle}>
      {title.toUpperCase()}
    </Text>
    <View
      style={[styles.card, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}
    >
      {children}
    </View>
  </View>
);

const StatusBadge: React.FC<{
  status: Status;
  colors: ScreenColors;
  t: (k: TranslationKey) => string;
}> = ({ status, colors, t }) => {
  const tone = STATUS_TONE[status];
  const bg =
    tone === 'positive'
      ? colors.statusPositiveBg
      : tone === 'active'
        ? colors.statusActiveBg
        : tone === 'muted'
          ? colors.statusMutedBg
          : colors.statusNeutralBg;
  const fg =
    tone === 'positive'
      ? colors.statusPositiveText
      : tone === 'active'
        ? colors.statusActiveText
        : tone === 'muted'
          ? colors.statusMutedText
          : colors.statusNeutralText;
  return (
    <View style={[styles.statusBadge, { backgroundColor: bg }]}>
      <Text size="xs" weight="semibold" color={fg}>
        {t(`tournamentDetail.status.${status}` as TranslationKey)}
      </Text>
    </View>
  );
};

// =============================================================================

export const TournamentDetail: React.FC = () => {
  const { params } = useRoute<TournamentDetailRoute>();
  const { theme } = useTheme();
  const { t, locale } = useTranslation();
  const { session } = useAuth();
  const toast = useToast();
  const isDark = theme === 'dark';
  const userId = session?.user?.id;

  const { data: tournament, isLoading, isError, refetch } = useTournament(params.tournamentId);
  const { data: registrations = [] } = useTournamentRegistrations(params.tournamentId);
  const { data: myRegistration } = useMyTournamentRegistration(params.tournamentId, userId);
  const { sports } = useSports();

  const isOrganizer = !!tournament && !!userId && tournament.organizer_id === userId;
  const myActiveRegistration =
    myRegistration &&
    (myRegistration.status === 'registered' || myRegistration.status === 'pending')
      ? myRegistration
      : null;
  const activeCount = registrations.length;

  const showError = useCallback(
    (errMsg: string, fallbackKey: TranslationKey) => {
      const lower = errMsg.toLowerCase();
      const key: TranslationKey = lower.includes('sport_mismatch')
        ? ('tournamentDetail.errors.sportMismatch' as TranslationKey)
        : lower.includes('tournament_full')
          ? ('tournamentDetail.errors.tournamentFull' as TranslationKey)
          : lower.includes('already_registered')
            ? ('tournamentDetail.errors.alreadyRegistered' as TranslationKey)
            : lower.includes('not_invited')
              ? ('tournamentDetail.errors.notInvited' as TranslationKey)
              : lower.includes('optimistic_lock')
                ? ('tournamentDetail.errors.lockConflict' as TranslationKey)
                : lower.includes('tournament_reg_closed') || lower.includes('reg_closed')
                  ? ('tournamentDetail.errors.regClosed' as TranslationKey)
                  : fallbackKey;
      warningHaptic();
      toast.error(t(key));
    },
    [t, toast]
  );

  const open = useOpenTournamentRegistration({
    onSuccess: () => successHaptic(),
    onError: e => showError(e.message, 'tournamentDetail.errors.openFailed' as TranslationKey),
  });
  const close = useCloseTournamentRegistration({
    onSuccess: () => successHaptic(),
    onError: e => showError(e.message, 'tournamentDetail.errors.closeFailed' as TranslationKey),
  });
  const register = useRegisterForTournament({
    onSuccess: () => successHaptic(),
    onError: e => showError(e.message, 'tournamentDetail.errors.registerFailed' as TranslationKey),
  });
  const withdraw = useWithdrawFromTournament({
    onSuccess: () => successHaptic(),
    onError: e => showError(e.message, 'tournamentDetail.errors.withdrawFailed' as TranslationKey),
  });
  const generateBracket = useGenerateTournamentBracket({
    onSuccess: () => successHaptic(),
    onError: e => {
      const lower = e.message.toLowerCase();
      const key: TranslationKey = lower.includes('insufficient_participants')
        ? ('tournamentDetail.generateBracketErrors.insufficientParticipants' as TranslationKey)
        : lower.includes('bracket_already_generated')
          ? ('tournamentDetail.generateBracketErrors.alreadyGenerated' as TranslationKey)
          : lower.includes('tournament_not_draft')
            ? ('tournamentDetail.generateBracketErrors.wrongStatus' as TranslationKey)
            : ('tournamentDetail.generateBracketErrors.generic' as TranslationKey);
      warningHaptic();
      toast.error(t(key));
    },
  });

  const onOpen = useCallback(() => {
    if (!tournament) return;
    lightHaptic();
    open.mutate({ tournamentId: tournament.id, versionWas: tournament.version });
  }, [tournament, open]);

  const onClose = useCallback(() => {
    if (!tournament) return;
    lightHaptic();
    close.mutate({ tournamentId: tournament.id, versionWas: tournament.version });
  }, [tournament, close]);

  const onRegister = useCallback(() => {
    if (!tournament) return;
    lightHaptic();
    register.mutate({ tournamentId: tournament.id });
  }, [tournament, register]);

  const onWithdraw = useCallback(() => {
    if (!tournament || !myActiveRegistration) return;
    lightHaptic();
    withdraw.mutate({
      registrationId: myActiveRegistration.id,
      versionWas: myActiveRegistration.version,
      tournamentId: tournament.id,
    });
  }, [tournament, myActiveRegistration, withdraw]);

  const onGenerateBracket = useCallback(() => {
    if (!tournament) return;
    lightHaptic();
    generateBracket.mutate({ tournamentId: tournament.id, versionWas: tournament.version });
  }, [tournament, generateBracket]);

  // Bracket: only fetch when the bracket has been generated (status >= in_progress).
  const bracketStatuses: ReadonlyArray<Enums<'tournament_status'>> = [
    'in_progress',
    'completed',
    'archived',
  ];
  const shouldFetchBracket = !!tournament && bracketStatuses.includes(tournament.status);
  const { data: matches = [] } = useTournamentMatches(
    shouldFetchBracket ? tournament?.id : undefined
  );

  // Map registration_id → seed number (1-indexed). The order matches the
  // RPC's seeding criteria so the labels here line up with the bracket.
  const seedByRegId = useMemo(() => {
    const map = new Map<string, number>();
    [...registrations]
      .sort((a, b) => {
        const sa = a.seed_rank ?? Number.MAX_SAFE_INTEGER;
        const sb = b.seed_rank ?? Number.MAX_SAFE_INTEGER;
        if (sa !== sb) return sa - sb;
        const ta = new Date(a.registered_at).getTime();
        const tb = new Date(b.registered_at).getTime();
        if (ta !== tb) return ta - tb;
        return a.id.localeCompare(b.id);
      })
      .forEach((r, i) => map.set(r.id, i + 1));
    return map;
  }, [registrations]);

  // Map registration_id → user_id, used to decide whether the caller can
  // tap into a bracket match.
  const userByRegId = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of registrations) map.set(r.id, r.user_id);
    return map;
  }, [registrations]);

  // Batch-fetch player profiles so the bracket can render real names.
  const userIds = useMemo(() => registrations.map(r => r.user_id), [registrations]);
  const { data: profiles } = useProfilesByIds(userIds);
  const nameByRegId = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of registrations) {
      const p = profiles?.get(r.user_id);
      // Always use first (+ last). display_name is intentionally ignored
      // per the app-wide convention in @rallia/shared-utils/getHumanName.
      const name = p ? getHumanName(p, '') : '';
      if (name) map.set(r.id, name);
    }
    return map;
  }, [registrations, profiles]);

  const [pickerSlot, setPickerSlot] = useState<{
    tournamentMatchId: string;
    player1RegId: string;
    player2RegId: string;
    player1UserId: string;
    player2UserId: string;
  } | null>(null);

  const handleBracketMatchTap = useCallback(
    (tournamentMatchId: string, p1RegId: string, p2RegId: string) => {
      const p1User = userByRegId.get(p1RegId);
      const p2User = userByRegId.get(p2RegId);
      if (!p1User || !p2User) return;
      lightHaptic();
      setPickerSlot({
        tournamentMatchId,
        player1RegId: p1RegId,
        player2RegId: p2RegId,
        player1UserId: p1User,
        player2UserId: p2User,
      });
    },
    [userByRegId]
  );

  const themeColors = isDark ? darkTheme : lightTheme;
  const colors = useMemo<ScreenColors>(
    () => ({
      background: themeColors.background,
      cardBackground: themeColors.card,
      text: themeColors.foreground,
      textSecondary: isDark ? primary[300] : neutral[600],
      textMuted: themeColors.mutedForeground,
      border: themeColors.border,
      primary: isDark ? primary[500] : primary[600],
      badgeBg: isDark ? primary[500] : primary[600],
      statusNeutralBg: isDark ? neutral[700] : neutral[200],
      statusNeutralText: isDark ? neutral[100] : neutral[700],
      statusPositiveBg: isDark ? '#16a34a30' : '#dcfce7',
      statusPositiveText: isDark ? '#86efac' : '#15803d',
      statusActiveBg: isDark ? `${primary[500]}30` : `${primary[600]}20`,
      statusActiveText: isDark ? primary[300] : primary[700],
      statusMutedBg: isDark ? neutral[800] : neutral[100],
      statusMutedText: isDark ? neutral[400] : neutral[500],
    }),
    [themeColors, isDark]
  );

  const sport = useMemo(
    () => sports.find(s => s.id === tournament?.sport_id),
    [sports, tournament]
  );

  const formatDate = (iso: string): string =>
    new Date(iso).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });

  if (isLoading) {
    return (
      <SafeAreaView
        edges={['bottom']}
        style={[styles.root, { backgroundColor: colors.background }]}
      >
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text size="sm" color={colors.textMuted} style={styles.centeredText}>
            {t('tournamentDetail.loading' as TranslationKey)}
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
            {t('tournamentDetail.loadError' as TranslationKey)}
          </Text>
          <TouchableOpacity
            onPress={() => refetch()}
            style={[styles.retryButton, { backgroundColor: colors.primary }]}
          >
            <Text size="base" weight="semibold" color="#ffffff">
              {t('tournamentDetail.retry' as TranslationKey)}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (!tournament) {
    return (
      <SafeAreaView
        edges={['bottom']}
        style={[styles.root, { backgroundColor: colors.background }]}
      >
        <View style={styles.centered}>
          <Ionicons name="trophy-outline" size={48} color={colors.textMuted} />
          <Text size="base" weight="semibold" color={colors.text} style={styles.centeredText}>
            {t('tournamentDetail.notFound' as TranslationKey)}
          </Text>
          <Text size="sm" color={colors.textMuted} style={styles.centeredSubtext}>
            {t('tournamentDetail.notFoundDescription' as TranslationKey)}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['bottom']} style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.heroBadgesRow}>
            <View style={[styles.sportBadge, { backgroundColor: colors.badgeBg }]}>
              <SportIcon sportName={sport?.name ?? 'tennis'} size={14} color="#ffffff" />
              <Text size="sm" weight="semibold" color="#ffffff">
                {sport?.display_name ?? sport?.name ?? ''}
              </Text>
            </View>
            <StatusBadge status={tournament.status} colors={colors} t={t} />
          </View>
          <Text size="2xl" weight="bold" color={colors.text} style={styles.heroTitle}>
            {tournament.name}
          </Text>
          {tournament.description ? (
            <Text size="sm" color={colors.textMuted} style={styles.heroDescription}>
              {tournament.description}
            </Text>
          ) : null}
        </View>

        <Section title={t('tournamentDetail.sections.format' as TranslationKey)} colors={colors}>
          <InfoRow
            label={t('tournamentDetail.labels.bracketSize' as TranslationKey)}
            value={String(tournament.max_participants)}
            colors={colors}
          />
          <InfoRow
            label={t('tournamentDetail.labels.bracketType' as TranslationKey)}
            value={t(BRACKET_TYPE_LABEL_KEY[tournament.bracket_type] as TranslationKey)}
            colors={colors}
          />
          <InfoRow
            label={t('tournamentDetail.labels.entryFormat' as TranslationKey)}
            value={t(ENTRY_FORMAT_LABEL_KEY[tournament.entry_format] as TranslationKey)}
            colors={colors}
          />
        </Section>

        <Section title={t('tournamentDetail.sections.schedule' as TranslationKey)} colors={colors}>
          <InfoRow
            label={t('tournamentDetail.labels.startDate' as TranslationKey)}
            value={formatDate(tournament.start_date)}
            colors={colors}
          />
          <InfoRow
            label={t('tournamentDetail.labels.endDate' as TranslationKey)}
            value={formatDate(tournament.end_date)}
            colors={colors}
          />
        </Section>

        <Section
          title={t('tournamentDetail.sections.visibility' as TranslationKey)}
          colors={colors}
        >
          <InfoRow
            label={t('tournamentDetail.labels.visibility' as TranslationKey)}
            value={t(VISIBILITY_LABEL_KEY[tournament.visibility] as TranslationKey)}
            colors={colors}
          />
          <InfoRow
            label={t('tournamentDetail.labels.registrationMode' as TranslationKey)}
            value={t(REG_MODE_LABEL_KEY[tournament.registration_mode] as TranslationKey)}
            colors={colors}
          />
        </Section>

        {/* Registrations summary */}
        {(tournament.status === 'registration_open' ||
          tournament.status === 'registration_closed' ||
          tournament.status === 'in_progress') && (
          <Section
            title={t('tournamentDetail.registrations.sectionTitle' as TranslationKey)}
            colors={colors}
          >
            <View style={styles.registrationsRow}>
              <Ionicons name="people-outline" size={20} color={colors.textMuted} />
              <Text size="base" weight="semibold" color={colors.text}>
                {t('tournamentDetail.registrations.count' as TranslationKey)
                  .replace('{count}', String(activeCount))
                  .replace('{max}', String(tournament.max_participants))}
              </Text>
            </View>
          </Section>
        )}

        {/* Bracket */}
        {shouldFetchBracket && matches.length > 0 && (
          <BracketSection
            matches={matches}
            seedByRegId={seedByRegId}
            nameByRegId={nameByRegId}
            userByRegId={userByRegId}
            currentUserId={userId}
            onMatchPress={handleBracketMatchTap}
            colors={colors}
            t={t}
          />
        )}

        {/* Action panel */}
        {(() => {
          // Organizer actions
          if (isOrganizer && tournament.status === 'draft') {
            return (
              <PrimaryActionButton
                label={
                  open.isPending
                    ? t('tournamentDetail.actions.opening' as TranslationKey)
                    : t('tournamentDetail.actions.openRegistration' as TranslationKey)
                }
                icon="lock-open-outline"
                onPress={onOpen}
                disabled={open.isPending}
                colors={colors}
              />
            );
          }
          if (isOrganizer && tournament.status === 'registration_open') {
            return (
              <PrimaryActionButton
                label={
                  close.isPending
                    ? t('tournamentDetail.actions.closing' as TranslationKey)
                    : t('tournamentDetail.actions.closeRegistration' as TranslationKey)
                }
                icon="lock-closed-outline"
                onPress={onClose}
                disabled={close.isPending}
                colors={colors}
              />
            );
          }
          if (isOrganizer && tournament.status === 'registration_closed') {
            return (
              <PrimaryActionButton
                label={
                  generateBracket.isPending
                    ? t('tournamentDetail.actions.generating' as TranslationKey)
                    : t('tournamentDetail.actions.generateBracket' as TranslationKey)
                }
                icon="git-network-outline"
                onPress={onGenerateBracket}
                disabled={generateBracket.isPending}
                colors={colors}
              />
            );
          }

          // Registrant actions
          if (!isOrganizer && tournament.status === 'registration_open' && !myActiveRegistration) {
            return (
              <PrimaryActionButton
                label={
                  register.isPending
                    ? t('tournamentDetail.actions.registering' as TranslationKey)
                    : t('tournamentDetail.actions.register' as TranslationKey)
                }
                icon="person-add-outline"
                onPress={onRegister}
                disabled={register.isPending}
                colors={colors}
              />
            );
          }
          if (!isOrganizer && myActiveRegistration) {
            const statusLabelKey =
              myActiveRegistration.status === 'pending'
                ? 'tournamentDetail.actions.registrationPendingLabel'
                : 'tournamentDetail.actions.registeredLabel';
            return (
              <View style={styles.section}>
                <View style={[styles.statusInline, { backgroundColor: colors.statusPositiveBg }]}>
                  <Ionicons name="checkmark-circle" size={18} color={colors.statusPositiveText} />
                  <Text size="sm" weight="semibold" color={colors.statusPositiveText}>
                    {t(statusLabelKey as TranslationKey)}
                  </Text>
                </View>
                <SecondaryActionButton
                  label={
                    withdraw.isPending
                      ? t('tournamentDetail.actions.withdrawing' as TranslationKey)
                      : t('tournamentDetail.actions.withdraw' as TranslationKey)
                  }
                  icon="exit-outline"
                  onPress={onWithdraw}
                  disabled={withdraw.isPending}
                  colors={colors}
                />
              </View>
            );
          }
          return null;
        })()}
      </ScrollView>

      {pickerSlot && tournament && (
        <LinkMatchPickerModal
          slot={pickerSlot}
          sportId={tournament.sport_id}
          tournamentId={tournament.id}
          seedByRegId={seedByRegId}
          nameByRegId={nameByRegId}
          onDismiss={() => setPickerSlot(null)}
          colors={colors}
          t={t}
          locale={locale}
          onError={msg => {
            warningHaptic();
            toast.error(msg);
          }}
          onSuccess={() => {
            successHaptic();
            setPickerSlot(null);
          }}
        />
      )}
    </SafeAreaView>
  );
};

interface PickerSlot {
  tournamentMatchId: string;
  player1RegId: string;
  player2RegId: string;
  player1UserId: string;
  player2UserId: string;
}

const LinkMatchPickerModal: React.FC<{
  slot: PickerSlot;
  sportId: string;
  tournamentId: string;
  seedByRegId: Map<string, number>;
  nameByRegId: Map<string, string>;
  onDismiss: () => void;
  colors: ScreenColors;
  t: (k: TranslationKey) => string;
  locale: string;
  onError: (msg: string) => void;
  onSuccess: () => void;
}> = ({
  slot,
  sportId,
  tournamentId,
  seedByRegId,
  nameByRegId,
  onDismiss,
  colors,
  t,
  locale,
  onError,
  onSuccess,
}) => {
  const { data: matches = [], isLoading } = useLinkableMatchesForSlot({
    tournamentMatchId: slot.tournamentMatchId,
    player1UserId: slot.player1UserId,
    player2UserId: slot.player2UserId,
    sportId,
  });

  const attach = useAttachMatchToTournamentSlot({
    onSuccess: onSuccess,
    onError: e =>
      onError(t('tournamentDetail.linkPicker.attachFailed' as TranslationKey) + ` (${e.message})`),
  });

  const seed1 = seedByRegId.get(slot.player1RegId);
  const seed2 = seedByRegId.get(slot.player2RegId);
  const name1 = nameByRegId.get(slot.player1RegId) ?? `Seed ${seed1 ?? '?'}`;
  const name2 = nameByRegId.get(slot.player2RegId) ?? `Seed ${seed2 ?? '?'}`;
  const matchupLabel = `${name1} vs ${name2}`;

  const handlePick = useCallback(
    (matchId: string) => {
      lightHaptic();
      attach.mutate({
        tournamentMatchId: slot.tournamentMatchId,
        matchId,
        tournamentId,
      });
    },
    [attach, slot.tournamentMatchId, tournamentId]
  );

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onDismiss}>
      <Pressable style={styles.modalBackdrop} onPress={onDismiss}>
        <Pressable
          style={[styles.modalSheet, { backgroundColor: colors.cardBackground }]}
          onPress={e => e.stopPropagation()}
        >
          <View style={styles.modalHeader}>
            <View style={{ flex: 1 }}>
              <Text size="lg" weight="bold" color={colors.text}>
                {t('tournamentDetail.linkPicker.title' as TranslationKey)}
              </Text>
              <Text size="sm" color={colors.textMuted}>
                {matchupLabel}
              </Text>
            </View>
            <TouchableOpacity
              onPress={onDismiss}
              style={styles.iconButton}
              accessibilityRole="button"
            >
              <Ionicons name="close-outline" size={24} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          {isLoading && (
            <View style={styles.modalLoading}>
              <ActivityIndicator color={colors.primary} />
            </View>
          )}

          {!isLoading && matches.length === 0 && (
            <View style={styles.modalEmpty}>
              <Ionicons name="search-outline" size={36} color={colors.textMuted} />
              <Text
                size="base"
                weight="semibold"
                color={colors.text}
                style={{ marginTop: spacingPixels[3], textAlign: 'center' }}
              >
                {t('tournamentDetail.linkPicker.empty' as TranslationKey)}
              </Text>
              <Text
                size="sm"
                color={colors.textMuted}
                style={{ marginTop: spacingPixels[2], textAlign: 'center' }}
              >
                {t('tournamentDetail.linkPicker.emptyHint' as TranslationKey)}
              </Text>
            </View>
          )}

          {!isLoading && matches.length > 0 && (
            <ScrollView style={styles.modalList} showsVerticalScrollIndicator={false}>
              {matches.map(m => (
                <LinkableMatchRow
                  key={m.id}
                  match={m}
                  onPick={() => handlePick(m.id)}
                  disabled={attach.isPending}
                  colors={colors}
                  locale={locale}
                />
              ))}
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const LinkableMatchRow: React.FC<{
  match: LinkableMatch;
  onPick: () => void;
  disabled?: boolean;
  colors: ScreenColors;
  locale: string;
}> = ({ match, onPick, disabled, colors, locale }) => {
  const dateLabel = useMemo(
    () =>
      new Date(match.match_date).toLocaleDateString(locale, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }),
    [match.match_date, locale]
  );
  const scoreLabel =
    match.team1_score !== null && match.team2_score !== null
      ? `${match.team1_score}–${match.team2_score}`
      : '';
  const winnerLabel =
    match.winning_team === 1 ? 'Team 1' : match.winning_team === 2 ? 'Team 2' : '';

  return (
    <TouchableOpacity
      onPress={onPick}
      disabled={disabled}
      activeOpacity={0.7}
      style={[
        styles.linkableMatchRow,
        { borderColor: colors.border, backgroundColor: colors.cardBackground },
        disabled && styles.buttonDisabled,
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text size="base" weight="semibold" color={colors.text}>
          {dateLabel}
        </Text>
        <Text size="xs" color={colors.textMuted}>
          {match.start_time} — {scoreLabel} {winnerLabel}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
    </TouchableOpacity>
  );
};

type MatchRow = Tables<'tournament_matches'>;

const roundLabel = (
  round: number,
  totalRounds: number,
  t: (k: TranslationKey) => string
): string => {
  if (round === totalRounds) return t('tournamentDetail.bracket.final' as TranslationKey);
  if (round === totalRounds - 1) return t('tournamentDetail.bracket.semifinal' as TranslationKey);
  if (round === totalRounds - 2)
    return t('tournamentDetail.bracket.quarterfinal' as TranslationKey);
  return t('tournamentDetail.bracket.round' as TranslationKey).replace('{n}', String(round));
};

const slotLabel = (
  regId: string | null,
  isBye: boolean,
  isPhantom: boolean,
  seedByRegId: Map<string, number>,
  nameByRegId: Map<string, string>,
  t: (k: TranslationKey) => string
): string => {
  if (isPhantom) return t('tournamentDetail.bracket.phantom' as TranslationKey);
  if (isBye) return t('tournamentDetail.bracket.bye' as TranslationKey);
  if (!regId) return t('tournamentDetail.bracket.tbd' as TranslationKey);
  const name = nameByRegId.get(regId);
  if (name) return name;
  const seed = seedByRegId.get(regId);
  return seed !== undefined ? `Seed ${seed}` : t('tournamentDetail.bracket.tbd' as TranslationKey);
};

const BracketSection: React.FC<{
  matches: MatchRow[];
  seedByRegId: Map<string, number>;
  nameByRegId: Map<string, string>;
  userByRegId: Map<string, string>;
  currentUserId: string | undefined;
  onMatchPress: (tournamentMatchId: string, p1RegId: string, p2RegId: string) => void;
  colors: ScreenColors;
  t: (k: TranslationKey) => string;
}> = ({
  matches,
  seedByRegId,
  nameByRegId,
  userByRegId,
  currentUserId,
  onMatchPress,
  colors,
  t,
}) => {
  const totalRounds = matches.reduce((max, m) => Math.max(max, m.round_number), 0);
  const byRound = new Map<number, MatchRow[]>();
  for (const m of matches) {
    const arr = byRound.get(m.round_number) ?? [];
    arr.push(m);
    byRound.set(m.round_number, arr);
  }
  const roundNumbers = [...byRound.keys()].sort((a, b) => a - b);

  return (
    <View style={styles.section}>
      <Text size="xs" weight="semibold" color={colors.textMuted} style={styles.sectionTitle}>
        {t('tournamentDetail.bracket.sectionTitle' as TranslationKey).toUpperCase()}
      </Text>
      <View
        style={[
          styles.card,
          { backgroundColor: colors.cardBackground, borderColor: colors.border },
        ]}
      >
        {roundNumbers.map((round, idx) => {
          const roundMatches = (byRound.get(round) ?? []).sort(
            (a, b) => a.match_position - b.match_position
          );
          return (
            <View
              key={round}
              style={[
                styles.bracketRound,
                idx > 0 && {
                  borderTopColor: colors.border,
                  borderTopWidth: StyleSheet.hairlineWidth,
                },
              ]}
            >
              <Text
                size="xs"
                weight="semibold"
                color={colors.primary}
                style={styles.bracketRoundLabel}
              >
                {roundLabel(round, totalRounds, t).toUpperCase()}
              </Text>
              {roundMatches.map(m => {
                const isPhantom =
                  m.player1_is_bye && m.player2_is_bye && m.winner_registration_id === null;
                const winnerSlot =
                  m.winner_registration_id === m.player1_registration_id
                    ? 1
                    : m.winner_registration_id === m.player2_registration_id
                      ? 2
                      : 0;

                const p1User = m.player1_registration_id
                  ? userByRegId.get(m.player1_registration_id)
                  : undefined;
                const p2User = m.player2_registration_id
                  ? userByRegId.get(m.player2_registration_id)
                  : undefined;
                const callerIsParticipant =
                  !!currentUserId && (currentUserId === p1User || currentUserId === p2User);
                const isPlayable =
                  m.status === 'pending' &&
                  !m.player1_is_bye &&
                  !m.player2_is_bye &&
                  !!m.player1_registration_id &&
                  !!m.player2_registration_id;
                const isTappable = isPlayable && callerIsParticipant;

                const matchInner = (
                  <>
                    <BracketSlot
                      label={slotLabel(
                        m.player1_registration_id,
                        m.player1_is_bye,
                        isPhantom,
                        seedByRegId,
                        nameByRegId,
                        t
                      )}
                      isWinner={winnerSlot === 1}
                      isBye={m.player1_is_bye}
                      colors={colors}
                    />
                    <View style={[styles.bracketSlotDivider, { backgroundColor: colors.border }]} />
                    <BracketSlot
                      label={slotLabel(
                        m.player2_registration_id,
                        m.player2_is_bye,
                        isPhantom,
                        seedByRegId,
                        nameByRegId,
                        t
                      )}
                      isWinner={winnerSlot === 2}
                      isBye={m.player2_is_bye}
                      colors={colors}
                    />
                    {m.score && (
                      <View style={[styles.bracketScoreRow, { borderTopColor: colors.border }]}>
                        <Text size="xs" color={colors.textMuted}>
                          {m.score}
                        </Text>
                      </View>
                    )}
                  </>
                );

                if (isTappable && m.player1_registration_id && m.player2_registration_id) {
                  const p1RegId = m.player1_registration_id;
                  const p2RegId = m.player2_registration_id;
                  return (
                    <TouchableOpacity
                      key={m.id}
                      onPress={() => onMatchPress(m.id, p1RegId, p2RegId)}
                      activeOpacity={0.7}
                      style={[
                        styles.bracketMatch,
                        styles.bracketMatchPlayable,
                        { borderColor: colors.primary },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={t('tournamentDetail.bracket.linkMatch' as TranslationKey)}
                    >
                      {matchInner}
                    </TouchableOpacity>
                  );
                }

                return (
                  <View key={m.id} style={[styles.bracketMatch, { borderColor: colors.border }]}>
                    {matchInner}
                  </View>
                );
              })}
            </View>
          );
        })}
      </View>
    </View>
  );
};

const BracketSlot: React.FC<{
  label: string;
  isWinner: boolean;
  isBye: boolean;
  colors: ScreenColors;
}> = ({ label, isWinner, isBye, colors }) => (
  <View style={styles.bracketSlot}>
    <Text
      size="sm"
      weight={isWinner ? 'semibold' : 'regular'}
      color={isBye ? colors.textMuted : isWinner ? colors.primary : colors.text}
    >
      {label}
    </Text>
    {isWinner && <Ionicons name="checkmark-circle" size={14} color={colors.primary} />}
  </View>
);

const PrimaryActionButton: React.FC<{
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  disabled?: boolean;
  colors: ScreenColors;
}> = ({ label, icon, onPress, disabled, colors }) => (
  <View style={styles.section}>
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
      style={[
        styles.primaryButton,
        { backgroundColor: colors.primary },
        disabled && styles.buttonDisabled,
      ]}
      accessibilityRole="button"
    >
      <Ionicons name={icon} size={20} color="#ffffff" />
      <Text size="base" weight="semibold" color="#ffffff">
        {label}
      </Text>
    </TouchableOpacity>
  </View>
);

const SecondaryActionButton: React.FC<{
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  disabled?: boolean;
  colors: ScreenColors;
}> = ({ label, icon, onPress, disabled, colors }) => (
  <TouchableOpacity
    onPress={onPress}
    disabled={disabled}
    activeOpacity={0.7}
    style={[
      styles.secondaryButton,
      { borderColor: colors.border, backgroundColor: colors.cardBackground },
      disabled && styles.buttonDisabled,
    ]}
    accessibilityRole="button"
  >
    <Ionicons name={icon} size={18} color={colors.text} />
    <Text size="base" weight="semibold" color={colors.text}>
      {label}
    </Text>
  </TouchableOpacity>
);

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
  scrollContent: {
    padding: spacingPixels[4],
    paddingBottom: spacingPixels[8],
  },
  hero: {
    marginBottom: spacingPixels[6],
  },
  heroBadgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    marginBottom: spacingPixels[3],
    flexWrap: 'wrap',
  },
  sportBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[1.5],
    borderRadius: radiusPixels.full,
    gap: spacingPixels[1.5],
  },
  statusBadge: {
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[1.5],
    borderRadius: radiusPixels.full,
  },
  heroTitle: {
    marginBottom: spacingPixels[2],
  },
  heroDescription: {
    lineHeight: 20,
  },
  section: {
    marginBottom: spacingPixels[5],
  },
  sectionTitle: {
    marginBottom: spacingPixels[2],
    letterSpacing: 0.5,
  },
  card: {
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  placeholderButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[2],
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
  },
  comingSoonChip: {
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[0.5],
    borderRadius: radiusPixels.full,
  },
  registrationsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[4],
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[2],
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[2],
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
  },
  buttonDisabled: { opacity: 0.6 },
  statusInline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[2],
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    marginBottom: spacingPixels[3],
  },
  bracketRound: {
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
    gap: spacingPixels[2],
  },
  bracketRoundLabel: {
    letterSpacing: 0.5,
  },
  bracketMatch: {
    borderWidth: 1,
    borderRadius: radiusPixels.md,
    overflow: 'hidden',
  },
  bracketMatchPlayable: {
    borderWidth: 2,
  },
  bracketScoreRow: {
    paddingVertical: spacingPixels[2],
    paddingHorizontal: spacingPixels[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    paddingHorizontal: spacingPixels[5],
    paddingTop: spacingPixels[4],
    paddingBottom: spacingPixels[8],
    borderTopLeftRadius: radiusPixels['2xl'],
    borderTopRightRadius: radiusPixels['2xl'],
    maxHeight: '70%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacingPixels[4],
  },
  iconButton: { padding: spacingPixels[1] },
  modalLoading: { padding: spacingPixels[8], alignItems: 'center' },
  modalEmpty: { padding: spacingPixels[6], alignItems: 'center' },
  modalList: { maxHeight: 400 },
  linkableMatchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    marginBottom: spacingPixels[2],
  },
  bracketSlot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacingPixels[2.5],
    paddingHorizontal: spacingPixels[3],
  },
  bracketSlotDivider: {
    height: StyleSheet.hairlineWidth,
  },
});

export default TournamentDetail;
