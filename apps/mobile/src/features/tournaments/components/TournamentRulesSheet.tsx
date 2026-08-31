/**
 * Tournament Rules Sheet
 *
 * What the app does at a round deadline, in the player's words. The rules
 * themselves are unplayed-match-resolution.md § 6; this is the only place a
 * player can read them BEFORE one is applied to them, which is the point: a
 * decision nobody was told about is indistinguishable from an arbitrary one.
 *
 * Deliberately not a full transcription of the ladder. A player needs to know
 * what is expected of them, what happens if they do it and still cannot play,
 * and what a forfeit costs them. The exact signal arithmetic stays in the
 * spec, and the notification names the rung after the fact.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { SheetManager, SheetProps } from 'react-native-actions-sheet';
import { Text } from '@rallia/shared-components';
import { spacingPixels } from '@rallia/design-system';

import { BaseActionSheet } from '#/components/BaseActionSheet';
import { useThemeStyles, useTranslation, type TranslationKey } from '#/hooks';

const SHEET_ID = 'tournament-rules';

/** Section keys, in the order a player meets them. */
const SECTIONS = ['deadline', 'trying', 'bothTried', 'neither', 'cost'] as const;

export function TournamentRulesActionSheet(_props: SheetProps<'tournament-rules'>) {
  const { t } = useTranslation();
  const { colors } = useThemeStyles();

  return (
    <BaseActionSheet
      title={t('tournamentDetail.rules.title')}
      onClose={() => void SheetManager.hide(SHEET_ID)}
    >
      <Text size="sm" style={[styles.intro, { color: colors.textMuted }]}>
        {t('tournamentDetail.rules.intro')}
      </Text>

      {SECTIONS.map(key => (
        <View key={key} style={styles.section}>
          <Text size="sm" weight="semibold" color={colors.text}>
            {t(`tournamentDetail.rules.${key}.title` as TranslationKey)}
          </Text>
          <Text size="sm" style={[styles.body, { color: colors.textMuted }]}>
            {t(`tournamentDetail.rules.${key}.body` as TranslationKey)}
          </Text>
        </View>
      ))}

      <Text size="xs" style={[styles.footnote, { color: colors.textMuted }]}>
        {t('tournamentDetail.rules.footnote')}
      </Text>
    </BaseActionSheet>
  );
}

const styles = StyleSheet.create({
  intro: {
    lineHeight: 20,
    marginBottom: spacingPixels[4],
  },
  section: {
    gap: spacingPixels[1],
    marginBottom: spacingPixels[4],
  },
  body: {
    lineHeight: 20,
  },
  footnote: {
    lineHeight: 18,
    marginBottom: spacingPixels[2],
  },
});

export default TournamentRulesActionSheet;
