/**
 * Compete — the hub for everything competitive.
 *
 * Three flat segments: the unified event list, and the two ranking currencies
 * that were previously a separate Classements screen with its own nested tab
 * bar. Flattening them means one level of tabs instead of two, and gives
 * tournaments and leagues the stable anchor the IA spec asked for.
 *
 * Spec: specs/navigation-ia/README.md
 */

import React, { useState } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRoute, type RouteProp } from '@react-navigation/native';
import { Text } from '@rallia/shared-components';
import { spacingPixels, primary } from '@rallia/design-system';

import { useTranslation, useThemeStyles } from '../hooks';
import type { RootStackParamList } from '../navigation';
import { lightHaptic } from '#/utils/haptics';

import Events from './Events';
import Leaderboard from './Leaderboard';
import TournamentRanking from './TournamentRanking';

export type CompeteSegment = 'events' | 'challenge' | 'ranking';

const SEGMENTS: Array<{
  key: CompeteSegment;
  icon: keyof typeof Ionicons.glyphMap;
  labelKey: 'compete.tabs.events' | 'compete.tabs.challenge' | 'compete.tabs.ranking';
}> = [
  { key: 'events', icon: 'trophy-outline', labelKey: 'compete.tabs.events' },
  { key: 'challenge', icon: 'calendar-outline', labelKey: 'compete.tabs.challenge' },
  { key: 'ranking', icon: 'ribbon-outline', labelKey: 'compete.tabs.ranking' },
];

export const Compete: React.FC = () => {
  const { t } = useTranslation();
  const { colors, isDark } = useThemeStyles();
  const route = useRoute<RouteProp<RootStackParamList, 'Compete'>>();
  const [activeSegment, setActiveSegment] = useState<CompeteSegment>(
    route.params?.initialSegment ?? 'events'
  );

  const activeColor = isDark ? primary[300] : primary[600];

  // Each segment's list carries its own bottom inset, so the wrapper takes none.
  return (
    <SafeAreaView edges={[]} style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.tabBar, { backgroundColor: colors.segmentTrack }]}>
        {SEGMENTS.map(segment => {
          const isActive = activeSegment === segment.key;
          return (
            <TouchableOpacity
              key={segment.key}
              style={[
                styles.tab,
                isActive && [styles.activeTab, { backgroundColor: colors.segmentActive }],
              ]}
              onPress={() => {
                if (segment.key !== activeSegment) {
                  void lightHaptic();
                  setActiveSegment(segment.key);
                }
              }}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              testID={`compete-segment-${segment.key}`}
            >
              <Ionicons
                name={segment.icon}
                size={18}
                color={isActive ? activeColor : colors.textMuted}
              />
              <Text
                size="sm"
                weight={isActive ? 'semibold' : 'medium'}
                style={{ color: isActive ? activeColor : colors.textMuted, marginLeft: 6 }}
                numberOfLines={1}
              >
                {t(segment.labelKey)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.body}>
        {activeSegment === 'events' && <Events />}
        {activeSegment === 'challenge' && <Leaderboard />}
        {activeSegment === 'ranking' && <TournamentRanking />}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  tabBar: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: spacingPixels[5],
    marginBottom: spacingPixels[1],
    borderRadius: 12,
    padding: 4,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 10,
  },
  activeTab: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  body: {
    flex: 1,
  },
});

export default Compete;
