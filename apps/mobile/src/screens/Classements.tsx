/**
 * Classements — colocated boards hub
 *
 * Hosts the two separate ranking currencies as sibling tabs: the monthly
 * challenge ("Défi du mois", games played) and Points Rallia ("Classement",
 * tournament achievement). Kept distinct on purpose (spec §12). Both boards
 * follow the global selected sport.
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

import Leaderboard from './Leaderboard';
import TournamentRanking from './TournamentRanking';

type ClassementsTab = 'challenge' | 'ranking';

export const Classements: React.FC = () => {
  const { t } = useTranslation();
  const { colors, isDark } = useThemeStyles();
  const route = useRoute<RouteProp<RootStackParamList, 'Classements'>>();
  const [activeTab, setActiveTab] = useState<ClassementsTab>(
    route.params?.initialTab ?? 'challenge'
  );

  const activeColor = isDark ? primary[300] : primary[600];

  const renderTab = (tab: ClassementsTab, icon: keyof typeof Ionicons.glyphMap, label: string) => {
    const isActive = activeTab === tab;
    return (
      <TouchableOpacity
        style={[
          styles.tab,
          isActive && [styles.activeTab, { backgroundColor: colors.segmentActive }],
        ]}
        onPress={() => {
          if (tab !== activeTab) {
            void lightHaptic();
            setActiveTab(tab);
          }
        }}
        activeOpacity={0.8}
      >
        <Ionicons name={icon} size={18} color={isActive ? activeColor : colors.textMuted} />
        <Text
          size="sm"
          weight={isActive ? 'semibold' : 'medium'}
          style={{ color: isActive ? activeColor : colors.textMuted, marginLeft: 6 }}
        >
          {label}
        </Text>
      </TouchableOpacity>
    );
  };

  // Each tab's list carries its own bottom inset, so the wrapper takes none.
  return (
    <SafeAreaView edges={[]} style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.tabBar, { backgroundColor: colors.segmentTrack }]}>
        {renderTab('challenge', 'calendar-outline', t('classements.tabs.challenge'))}
        {renderTab('ranking', 'trophy-outline', t('classements.tabs.ranking'))}
      </View>

      <View style={styles.body}>
        {activeTab === 'challenge' ? <Leaderboard /> : <TournamentRanking />}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
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

export default Classements;
