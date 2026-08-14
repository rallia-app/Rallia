/**
 * Compete — the hub for everything competitive.
 *
 * Two flat segments: the unified event list, and the ranking that events feed.
 * The monthly challenge counts games played, not events, so it lives with the
 * games feed (PublicMatches) rather than here.
 *
 * Spec: specs/navigation-ia/README.md
 */

import React, { useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, type RouteProp } from '@react-navigation/native';

import { useTranslation, useThemeStyles } from '../hooks';
import type { RootStackParamList } from '../navigation';
import { SegmentBar, type SegmentOption } from '../components/SegmentBar';

import Events from './Events';
import TournamentRanking from './TournamentRanking';

export type CompeteSegment = 'events' | 'ranking';

export const Compete: React.FC = () => {
  const { t } = useTranslation();
  const { colors } = useThemeStyles();
  const route = useRoute<RouteProp<RootStackParamList, 'Compete'>>();
  const [activeSegment, setActiveSegment] = useState<CompeteSegment>(
    route.params?.initialSegment ?? 'events'
  );

  const segments = useMemo<Array<SegmentOption<CompeteSegment>>>(
    () => [
      { key: 'events', icon: 'trophy-outline', label: t('compete.tabs.events') },
      { key: 'ranking', icon: 'ribbon-outline', label: t('compete.tabs.ranking') },
    ],
    [t]
  );

  // Each segment's list carries its own bottom inset, so the wrapper takes none.
  return (
    <SafeAreaView edges={[]} style={[styles.root, { backgroundColor: colors.background }]}>
      <SegmentBar
        segments={segments}
        active={activeSegment}
        onChange={setActiveSegment}
        testIDPrefix="compete-segment"
      />

      <View style={styles.body}>
        {activeSegment === 'events' && <Events />}
        {activeSegment === 'ranking' && <TournamentRanking />}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: {
    flex: 1,
  },
});

export default Compete;
