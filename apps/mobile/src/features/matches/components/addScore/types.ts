/**
 * Add Score Flow Types
 *
 * Shared types for the Add Score feature.
 */

export type MatchType = 'single' | 'double';
export type MatchExpectation = 'friendly' | 'competitive';
export type Sport = 'tennis' | 'pickleball';

export interface SelectedPlayer {
  id: string;
  firstName: string;
  lastName?: string;
  displayName?: string;
  profilePictureUrl?: string;
  isFromContacts?: boolean;
  phoneNumber?: string;
}

export interface SetScore {
  team1Score: number | null;
  team2Score: number | null;
}

export interface AddScoreFormData {
  matchType: MatchType;
  opponents: SelectedPlayer[]; // 1 for singles, 3 for doubles (you + 3 others = 4 players)
  partner?: SelectedPlayer; // Only for doubles - the teammate you select from the 3 players
  matchDate: Date;
  location?: string;
  sport: Sport;
  expectation: MatchExpectation;
  winnerId: string; // 'team1' or 'team2'
  sets: SetScore[];
  networkId?: string; // If posting to a group
}

export type AddScoreStep =
  | 'find-opponent'
  | 'match-details'
  | 'match-expectation'
  | 'create-teams' // Only for doubles - pick your partner
  | 'winner-scores';

// Steps for singles matches
export const SINGLES_SCORE_STEPS: AddScoreStep[] = [
  'find-opponent',
  'match-details',
  'match-expectation',
  'winner-scores',
];

// Steps for doubles matches (includes team creation)
export const DOUBLES_SCORE_STEPS: AddScoreStep[] = [
  'find-opponent',
  'match-details',
  'match-expectation',
  'create-teams',
  'winner-scores',
];

// Default steps (will be overridden based on match type)
export const ADD_SCORE_STEPS: AddScoreStep[] = SINGLES_SCORE_STEPS;
