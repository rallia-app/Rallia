import React from 'react';
import { SkeletonMatchCard } from '@rallia/shared-components';
import { primary, radiusPixels } from '@rallia/design-system';
import { useThemeStyles } from '../../../hooks';

const MatchCardSkeleton: React.FC = () => {
  const { isDark } = useThemeStyles();

  return (
    <SkeletonMatchCard
      backgroundColor={isDark ? primary[900] : primary[100]}
      highlightColor={isDark ? primary[800] : primary[50]}
      style={{
        backgroundColor: isDark ? primary[950] : primary[50],
        borderColor: isDark ? `${primary[400]}40` : `${primary[500]}20`,
        borderWidth: 1.5,
        borderRadius: radiusPixels.xl,
      }}
    />
  );
};

export default MatchCardSkeleton;
