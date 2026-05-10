/**
 * TournamentDetail Screen
 *
 * V1 of the L&T vertical slice plan: read-only summary of a tournament,
 * shown after the wizard creates a draft. Action affordances
 * (open registration, manage bracket, etc.) are placeholder "Coming soon"
 * buttons; they ship in subsequent vertical slices V2+.
 *
 * Spec: specs/17-leagues-tournaments/rollout.md §V1
 */

import React, { useMemo } from 'react';
import { View, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import { Text } from '@rallia/shared-components';
import {
  lightTheme,
  darkTheme,
  spacingPixels,
  radiusPixels,
  primary,
  neutral,
} from '@rallia/design-system';
import { useTheme, useTournament, useSports } from '@rallia/shared-hooks';
import type { Enums } from '@rallia/shared-types';

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
  const isDark = theme === 'dark';

  const { data: tournament, isLoading, isError, refetch } = useTournament(params.tournamentId);
  const { sports } = useSports();

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

        {/* Placeholder action — wires up in V2 (open registration RPC) */}
        {tournament.status === 'draft' && (
          <View style={styles.section}>
            <View
              style={[
                styles.placeholderButton,
                { backgroundColor: colors.statusMutedBg, borderColor: colors.border },
              ]}
            >
              <Ionicons name="lock-closed-outline" size={18} color={colors.textMuted} />
              <Text size="base" weight="semibold" color={colors.textMuted}>
                {t('tournamentDetail.actions.openRegistration' as TranslationKey)}
              </Text>
              <View style={[styles.comingSoonChip, { backgroundColor: colors.background }]}>
                <Text size="xs" weight="semibold" color={colors.textMuted}>
                  {t('tournamentDetail.actions.comingSoon' as TranslationKey)}
                </Text>
              </View>
            </View>
          </View>
        )}
      </ScrollView>
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
});

export default TournamentDetail;
