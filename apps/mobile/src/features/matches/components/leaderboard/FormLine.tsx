/**
 * FormLine
 *
 * A row of small W/L pill chips representing a player's last N results,
 * most-recent on the right.  Used in form strip rows, leaderboard rows, and
 * the "Your Story" card.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { neutral, radiusPixels, spacingPixels, status } from '@rallia/design-system';
import type { LeaderboardOutcome } from '@rallia/shared-hooks';

export interface FormLineProps {
  /** Outcomes most-recent first (matches the RPC payload). */
  outcomes: LeaderboardOutcome[];
  /** Pip size in px. */
  size?: 'sm' | 'md';
  isDark: boolean;
}

export function FormLine({ outcomes, size = 'md', isDark }: FormLineProps) {
  const dim = size === 'sm' ? 8 : 10;
  // Render oldest-on-left, newest-on-right for natural reading.
  const ordered = [...outcomes].reverse();
  return (
    <View style={styles.row}>
      {ordered.map((o, i) => (
        <View
          key={i}
          style={[
            styles.pip,
            { width: dim, height: dim },
            o === 'W'
              ? { backgroundColor: status.success.DEFAULT }
              : { backgroundColor: isDark ? neutral[600] : neutral[300] },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
  },
  pip: {
    borderRadius: radiusPixels.full,
  },
});

export default FormLine;
