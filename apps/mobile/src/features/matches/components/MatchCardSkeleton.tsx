import React from 'react';
import { SkeletonMatchCard } from '@rallia/shared-components';
import { base, neutral, primary, radiusPixels } from '@rallia/design-system';

import { useThemeStyles } from '#/hooks';

const MatchCardSkeleton: React.FC = () => {
  const { isDark } = useThemeStyles();

  return (
    <SkeletonMatchCard
      backgroundColor={isDark ? neutral[800] : neutral[100]}
      highlightColor={isDark ? neutral[700] : neutral[50]}
      style={{
        backgroundColor: isDark ? neutral[900] : base.white,
        borderColor: isDark ? `${primary[400]}40` : `${primary[500]}20`,
        borderWidth: 1.5,
        borderRadius: radiusPixels['2xl'],
      }}
    />
  );
};

export default MatchCardSkeleton;
