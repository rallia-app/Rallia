/**
 * Step 3 — Auto-match pitch + opt-ins.
 *
 * Dedicated step for the auto-create / auto-invite toggles, split out of the
 * recap+goal step after user feedback: players were surprised to find matches
 * created under their name because the opt-ins were buried as pre-checked
 * checkboxes. Ace pitches the feature, a "how it works" card spells out
 * exactly what happens (matches posted under YOUR name, invites sent for you),
 * and the toggles sit front-and-center. The CTA submits the check-in.
 */
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, Text } from '@rallia/shared-components';
import { useThemeStyles } from '@rallia/shared-hooks';
import { primary, radiusPixels, shadowsSemanticNative, spacingPixels } from '@rallia/design-system';

import { MascotBubble } from '#/features/weekly-checkin/components/MascotBubble';
import { AutoToggleRow } from '#/features/weekly-checkin/components/AutoToggleRow';
import {
  WEEKLY_CHECKIN_AUTO_CREATE_TOGGLE_ENABLED,
  WEEKLY_CHECKIN_AUTO_INVITE_TOGGLE_ENABLED,
} from '#/features/weekly-checkin/featureFlag';
import { useTranslation } from '#/hooks';

interface AutoMatchStepProps {
  autoCreate: boolean;
  setAutoCreate: (b: boolean) => void;
  autoInvite: boolean;
  setAutoInvite: (b: boolean) => void;
  isSubmitting: boolean;
  onSubmit: () => void;
}

export function AutoMatchStep({
  autoCreate,
  setAutoCreate,
  autoInvite,
  setAutoInvite,
  isSubmitting,
  onSubmit,
}: AutoMatchStepProps) {
  const { t } = useTranslation();
  const { colors, isDark } = useThemeStyles();
  const iconColor = isDark ? primary[400] : primary[600];

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <MascotBubble text={t('weeklyCheckIn.autoMatch.bubble')} textKey="auto-match" />

        <View style={[styles.howCard, { backgroundColor: colors.card }]}>
          <Text style={[styles.howLabel, { color: colors.textMuted }]}>
            {t('weeklyCheckIn.autoMatch.howLabel')}
          </Text>
          <HowRow
            icon="calendar-outline"
            iconColor={iconColor}
            title={t('weeklyCheckIn.autoMatch.howCreateTitle')}
            description={t('weeklyCheckIn.autoMatch.howCreateDesc')}
          />
          <HowRow
            icon="people-outline"
            iconColor={iconColor}
            title={t('weeklyCheckIn.autoMatch.howInviteTitle')}
            description={t('weeklyCheckIn.autoMatch.howInviteDesc')}
          />
          <HowRow
            icon="notifications-outline"
            iconColor={iconColor}
            title={t('weeklyCheckIn.autoMatch.howNotifyTitle')}
            description={t('weeklyCheckIn.autoMatch.howNotifyDesc')}
          />
        </View>

        <View style={styles.togglesSection}>
          <Text style={[styles.togglesLabel, { color: colors.textMuted }]}>
            {t('weeklyCheckIn.autoMatch.togglesLabel')}
          </Text>

          {WEEKLY_CHECKIN_AUTO_CREATE_TOGGLE_ENABLED && (
            <AutoToggleRow
              title={t('weeklyCheckIn.autoMatch.autoCreateTitle')}
              description={t('weeklyCheckIn.autoMatch.autoCreateDesc')}
              checked={autoCreate}
              onChange={setAutoCreate}
            />
          )}
          {WEEKLY_CHECKIN_AUTO_INVITE_TOGGLE_ENABLED && (
            <AutoToggleRow
              title={t('weeklyCheckIn.autoMatch.autoInviteTitle')}
              description={t('weeklyCheckIn.autoMatch.autoInviteDesc')}
              checked={autoInvite}
              onChange={setAutoInvite}
            />
          )}

          <Text style={[styles.reassurance, { color: colors.textMuted }]}>
            {t('weeklyCheckIn.autoMatch.reassurance')}
          </Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          variant="primary"
          size="lg"
          fullWidth
          rounded
          loading={isSubmitting}
          disabled={isSubmitting}
          onPress={onSubmit}
        >
          {t('weeklyCheckIn.autoMatch.cta')}
        </Button>
      </View>
    </View>
  );
}

function HowRow({
  icon,
  iconColor,
  title,
  description,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  iconColor: string;
  title: string;
  description: string;
}) {
  const { colors } = useThemeStyles();
  return (
    <View style={styles.howRow}>
      <View style={[styles.howIcon, { backgroundColor: `${iconColor}1A` }]}>
        <Ionicons name={icon} size={17} color={iconColor} />
      </View>
      <View style={styles.howText}>
        <Text style={[styles.howTitle, { color: colors.text }]}>{title}</Text>
        {/* One line always — shrinks slightly on narrow screens instead of wrapping. */}
        <Text
          style={[styles.howDesc, { color: colors.textMuted }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
        >
          {description}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scroll: {
    paddingTop: spacingPixels[2],
    paddingHorizontal: spacingPixels[5],
    paddingBottom: spacingPixels[3],
  },
  howCard: {
    marginTop: spacingPixels[4],
    marginHorizontal: spacingPixels[1],
    borderRadius: radiusPixels.xl,
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[3.5],
    gap: spacingPixels[3],
    ...shadowsSemanticNative.card,
  },
  howLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  howRow: {
    flexDirection: 'row',
    gap: spacingPixels[2.5],
  },
  howIcon: {
    width: 32,
    height: 32,
    borderRadius: radiusPixels.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  howText: {
    flex: 1,
  },
  howTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    marginBottom: 1,
    lineHeight: 18,
  },
  howDesc: {
    fontSize: 12,
    lineHeight: 16.5,
    fontWeight: '400',
  },
  togglesSection: {
    marginTop: spacingPixels[4],
  },
  togglesLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginHorizontal: spacingPixels[1],
    marginBottom: spacingPixels[2],
  },
  reassurance: {
    fontSize: 11.5,
    lineHeight: 16,
    marginHorizontal: spacingPixels[1],
    marginTop: spacingPixels[2],
  },
  footer: {
    paddingHorizontal: spacingPixels[5],
    paddingBottom: spacingPixels[6],
    paddingTop: spacingPixels[2],
  },
});
