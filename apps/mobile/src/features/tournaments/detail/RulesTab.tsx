/**
 * Rules pane: the organizer's free-text rules, one bullet per line.
 */

import React from 'react';
import { View } from 'react-native';
import { Text } from '@rallia/shared-components';

import type { ScreenColors } from './components';
import { styles } from './detailStyles';

interface RulesTabProps {
  rulesLines: string[];
  colors: ScreenColors;
}

export const RulesTab: React.FC<RulesTabProps> = ({ rulesLines, colors }) => (
  <View style={styles.tabContent}>
    <View
      style={[
        styles.card,
        styles.rulesCard,
        { backgroundColor: colors.cardBackground, borderColor: colors.border },
      ]}
    >
      {rulesLines.map((line, i) => (
        <View key={i} style={styles.ruleRow}>
          <View style={[styles.ruleDot, { backgroundColor: colors.primary }]} />
          <Text size="sm" color={colors.text} style={styles.ruleText}>
            {line}
          </Text>
        </View>
      ))}
    </View>
  </View>
);

export default RulesTab;
