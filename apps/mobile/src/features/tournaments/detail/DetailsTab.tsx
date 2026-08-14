/**
 * Details pane: the reference card for an event — description, schedule, draw
 * shape, entry band, visibility, venue and the fee breakdown.
 */

import React from 'react';
import { View } from 'react-native';
import { Text } from '@rallia/shared-components';
import type { Tournament } from '@rallia/shared-services';

import type { TranslationKey } from '../../../hooks';
import {
  BRACKET_TYPE_LABEL_KEY,
  ENTRY_FORMAT_LABEL_KEY,
  InfoRow,
  LabeledBlock,
  MATCH_FORMAT_LABEL_KEY,
  REG_MODE_LABEL_KEY,
  Section,
  StackedRow,
  VISIBILITY_LABEL_KEY,
  type ScreenColors,
} from './components';
import { styles } from './detailStyles';

interface DetailsTabProps {
  tournament: Tournament;
  colors: ScreenColors;
  t: (key: TranslationKey) => string;
  formatDate: (iso: string) => string;
  ratingRangeLabel: string | null;
  hasVenueDetails: boolean;
  venueSecondaryLine: string | null;
  showFeesSection: boolean;
  entryFeeLabel: string | null;
  playerPaysServiceFee: boolean;
  feeTotalLabel: string | null;
  refundSummary: string | null;
  prizePoolLabel: string | null;
}

export const DetailsTab: React.FC<DetailsTabProps> = ({
  tournament,
  colors,
  t,
  formatDate,
  ratingRangeLabel,
  hasVenueDetails,
  venueSecondaryLine,
  showFeesSection,
  entryFeeLabel,
  playerPaysServiceFee,
  feeTotalLabel,
  refundSummary,
  prizePoolLabel,
}) => (
  <View style={styles.tabContent}>
    {tournament.description?.trim() ? (
      <LabeledBlock
        label={t('tournamentDetail.labels.description')}
        value={tournament.description}
        colors={colors}
      />
    ) : null}

    <Section title={t('tournamentDetail.dashboard.details')} colors={colors}>
      <InfoRow
        label={t('tournamentDetail.labels.startDate')}
        value={formatDate(tournament.start_date)}
        colors={colors}
      />
      <InfoRow
        label={t('tournamentDetail.labels.endDate')}
        value={formatDate(tournament.end_date)}
        colors={colors}
      />
      {tournament.registration_closes_at &&
        (tournament.status === 'draft' || tournament.status === 'registration_open') && (
          <InfoRow
            label={t('tournamentDetail.labels.registrationCloses')}
            value={formatDate(tournament.registration_closes_at)}
            colors={colors}
          />
        )}
      <InfoRow
        label={t('tournamentDetail.labels.bracketSize')}
        value={String(tournament.max_participants)}
        colors={colors}
      />
      <InfoRow
        label={t('tournamentDetail.labels.bracketType')}
        value={t(BRACKET_TYPE_LABEL_KEY[tournament.bracket_type] as TranslationKey)}
        colors={colors}
      />
      <InfoRow
        label={t('tournamentDetail.labels.entryFormat')}
        value={t(ENTRY_FORMAT_LABEL_KEY[tournament.entry_format] as TranslationKey)}
        colors={colors}
      />
      <InfoRow
        label={t('tournamentDetail.labels.matchFormat')}
        value={t(MATCH_FORMAT_LABEL_KEY[tournament.match_format] as TranslationKey)}
        colors={colors}
      />
      {ratingRangeLabel ? (
        <InfoRow
          label={t('tournamentDetail.labels.ratingRange')}
          value={ratingRangeLabel}
          colors={colors}
        />
      ) : null}
      <InfoRow
        label={t('tournamentDetail.labels.visibility')}
        value={t(VISIBILITY_LABEL_KEY[tournament.visibility] as TranslationKey)}
        colors={colors}
      />
      <InfoRow
        label={t('tournamentDetail.labels.registrationMode')}
        value={t(REG_MODE_LABEL_KEY[tournament.registration_mode] as TranslationKey)}
        colors={colors}
      />
    </Section>

    {hasVenueDetails ? (
      <LabeledBlock label={t('tournamentDetail.labels.location')} colors={colors}>
        <Text size="base" weight="semibold" color={colors.text}>
          {tournament.venue_name || tournament.city}
        </Text>
        {venueSecondaryLine ? (
          <Text size="sm" color={colors.textMuted} style={styles.venueAddress}>
            {venueSecondaryLine}
          </Text>
        ) : null}
      </LabeledBlock>
    ) : null}

    {showFeesSection ? (
      <Section title={t('tournamentDetail.dashboard.feesTitle')} colors={colors}>
        <InfoRow
          label={t('tournamentDetail.labels.entryFee')}
          value={entryFeeLabel ?? t('tournamentCreation.payments.freeNote')}
          colors={colors}
        />
        {playerPaysServiceFee && feeTotalLabel ? (
          <InfoRow
            label={t('tournamentDetail.labels.youPay')}
            value={feeTotalLabel}
            colors={colors}
          />
        ) : null}
        {refundSummary ? (
          <StackedRow
            label={t('tournamentDetail.labels.refundPolicy')}
            value={refundSummary}
            colors={colors}
          />
        ) : null}
        {prizePoolLabel ? (
          <InfoRow
            label={t('tournamentDetail.dashboard.prizePool')}
            value={prizePoolLabel}
            colors={colors}
          />
        ) : null}
      </Section>
    ) : null}
  </View>
);

export default DetailsTab;
