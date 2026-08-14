/**
 * Details pane: the league's reference card — description, join mode, visibility and entry band.
 */

import React from 'react';
import { View } from 'react-native';
import type { League } from '@rallia/shared-services';

import {
  InfoRow,
  JOIN_MODE_KEY,
  LabeledBlock,
  Section,
  VISIBILITY_KEY,
  type ScreenColors,
} from './components';
import type { TranslationKey } from '../../../hooks';
import { styles } from './detailStyles';

interface DetailsTabProps {
  league: League;
  colors: ScreenColors;
  t: (key: TranslationKey) => string;
  ratingRangeLabel: string | null;
}

export const DetailsTab: React.FC<DetailsTabProps> = ({ league, colors, t, ratingRangeLabel }) => (
  <View style={styles.tabContent}>
    {league.description?.trim() ? (
      <LabeledBlock
        label={t('leagueDetail.labels.description')}
        value={league.description}
        colors={colors}
      />
    ) : null}

    <Section title={t('leagueDetail.tabs.details')} colors={colors}>
      <InfoRow
        label={t('leagueDetail.labels.visibility')}
        value={t(VISIBILITY_KEY[league.visibility] as TranslationKey)}
        colors={colors}
      />
      <InfoRow
        label={t('leagueDetail.labels.joinMode')}
        value={t(JOIN_MODE_KEY[league.join_mode] as TranslationKey)}
        colors={colors}
      />
      {league.venue_name ? (
        <InfoRow label={t('leagueDetail.labels.venue')} value={league.venue_name} colors={colors} />
      ) : null}
      {ratingRangeLabel && (
        <InfoRow
          label={t('leagueDetail.labels.ratingRange')}
          value={ratingRangeLabel}
          colors={colors}
        />
      )}
    </Section>
  </View>
);

export default DetailsTab;
