import React from 'react';
import { StyleSheet, View } from 'react-native';
import { spacingPixels } from '@rallia/design-system';
import { isCoveted, isFoundingMember } from '@rallia/shared-utils';

import CovetedBadge from '#/components/CovetedBadge';
import FoundingMemberBadge from '#/components/FoundingMemberBadge';

interface HeroBadgeRowProps {
  /** Player join timestamp (profile/player created_at) */
  createdAt?: string | null;
  /** Whether onboarding is complete — unknown (undefined) does not disqualify */
  onboardingCompleted?: boolean | null;
  reputationScore?: number;
  certificationStatus?: string | null;
  totalEvents?: number;
  isDark: boolean;
  onFoundingInfoPress?: () => void;
  onCovetedInfoPress?: () => void;
  /** Chips rendered at the front of the row (e.g. rating + reputation). */
  leading?: React.ReactNode;
}

/**
 * Full-width row of identity highlight badges (Founding Member, Coveted) shown
 * under the profile header's avatar + identity block. Renders nothing when the
 * player qualifies for neither, so it never leaves an empty gap.
 */
const HeroBadgeRow: React.FC<HeroBadgeRowProps> = ({
  createdAt,
  onboardingCompleted,
  reputationScore,
  certificationStatus,
  totalEvents,
  isDark,
  onFoundingInfoPress,
  onCovetedInfoPress,
  leading,
}) => {
  const showFounding = isFoundingMember(createdAt, onboardingCompleted);
  const showCoveted = isCoveted(reputationScore, certificationStatus ?? undefined, totalEvents);

  if (!leading && !showFounding && !showCoveted) return null;

  return (
    <View style={styles.row}>
      {leading}
      <FoundingMemberBadge
        createdAt={createdAt}
        onboardingCompleted={onboardingCompleted}
        isDark={isDark}
        onInfoPress={onFoundingInfoPress}
      />
      <CovetedBadge
        reputationScore={reputationScore}
        certificationStatus={certificationStatus}
        totalEvents={totalEvents}
        isDark={isDark}
        onInfoPress={onCovetedInfoPress}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacingPixels[2],
    marginTop: spacingPixels[3],
  },
});

export default HeroBadgeRow;
