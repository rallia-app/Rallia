/**
 * Match Components
 */

export { MatchCreationWizard } from './MatchCreationWizard';
export * from './steps';

// Public matches components
export { SearchBar } from './SearchBar';
export { default as MatchFiltersBar } from './MatchFiltersBar';

// Network matches tab (for group/community detail)
export { default as NetworkMatchesTab } from './NetworkMatchesTab';
export { default as NetworkLeaderboardTab } from './NetworkLeaderboardTab';
export type { NetworkLeaderboardTabProps } from './NetworkLeaderboardTab';

// Player matches components
export { default as PlayerMatchFilterChips } from './PlayerMatchFilterChips';

// Add Score flow components
export { AddScoreIntroModal } from './AddScoreIntroModal';
export { MatchTypeModal } from './MatchTypeModal';
export type { MatchType as MatchTypeSelection } from './MatchTypeModal';
export * from './addScore';

// Score confirmation components
export { ScoreConfirmationModal } from './ScoreConfirmationModal';
export { PendingScoreCard } from './PendingScoreCard';
export { PendingScoresSection } from './PendingScoresSection';
