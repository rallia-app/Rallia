import { primary, secondary, accent } from '@rallia/design-system';
import type { CompletenessTier } from '@rallia/shared-hooks';

export interface TierColors {
  accent: string;
  background: string;
  border: string;
  trackColor: string;
}

export function getTierColors(tier: CompletenessTier, isDark: boolean): TierColors {
  switch (tier) {
    case 'getting_started':
      return {
        accent: isDark ? secondary[400] : secondary[500],
        background: isDark ? secondary[900] : secondary[50],
        border: isDark ? secondary[800] : secondary[200],
        trackColor: isDark ? secondary[800] : secondary[100],
      };
    case 'growing':
      return {
        accent: isDark ? accent[400] : accent[500],
        background: isDark ? accent[900] : accent[50],
        border: isDark ? accent[800] : accent[200],
        trackColor: isDark ? accent[800] : accent[100],
      };
    case 'strong':
    case 'almost_there':
    case 'complete':
    default:
      return {
        accent: isDark ? primary[400] : primary[500],
        background: isDark ? primary[900] : primary[50],
        border: isDark ? primary[800] : primary[200],
        trackColor: isDark ? primary[800] : primary[100],
      };
  }
}
