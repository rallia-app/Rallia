/**
 * UI Types - View Models and Navigation Types
 *
 * This file contains types that are specific to the UI layer and cannot
 * be derived from database types. These include:
 * - View models (transformed/aggregated data for display)
 * - Navigation params
 * - UI-only enums and constants
 */

import type {
  Notification,
  MatchFormatEnum,
  CourtStatusEnum,
  MatchVisibilityEnum,
  MatchJoinModeEnum,
  CostSplitTypeEnum,
  LocationTypeEnum,
  MatchDurationEnum,
  MatchTypeEnum,
  GenderEnum,
} from './database';

// ============================================
// VIEW MODELS
// ============================================

/**
 * Notification with UI-specific computed properties
 */
export interface NotificationWithMeta extends Notification {
  /** Whether the notification is unread */
  isUnread: boolean;
  /** Relative time string (e.g., "2 min ago") */
  relativeTime?: string;
}

/**
 * Match card display model
 * Used for displaying match cards in the mobile app list views.
 * This is a UI view model, not a database type.
 */
export interface MatchCardDisplay {
  id: string;
  title: string;
  ageRestriction: string;
  date: string;
  time: string;
  location: string;
  court: string;
  tags: string[];
  participantCount: number;
  participantImages?: string[];
}

/**
 * Player card display model for search results and lists
 */
export interface PlayerCardDisplay {
  id: string;
  displayName: string;
  avatarUrl?: string;
  location?: string;
  primarySport?: string;
  ratingDisplay?: string;
  skillLevel?: string;
}

/**
 * Facility card display model for facility lists
 */
export interface FacilityCardDisplay {
  id: string;
  name: string;
  imageUrl?: string;
  address: string;
  city: string;
  distance?: string;
  courtCount?: number;
  amenities?: string[];
}

/**
 * Structured address component from Google Places API (New)
 * @see https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places#AddressComponent
 */
export interface AddressComponent {
  /** Long form text of the address component (e.g. "Montreal") */
  longText: string;
  /** Short form text of the address component (e.g. "MTL") */
  shortText?: string;
  /** Types describing this component (e.g. ["locality", "political"]) */
  types: string[];
}

/**
 * Place prediction from Google Places Autocomplete API
 * Used for location search in match creation
 */
export interface PlacePrediction {
  /** Google Place ID for fetching additional details */
  placeId: string;
  /** Display name of the place (e.g., "Jeanne Mance Tennis Park") */
  name: string;
  /** Formatted address of the place */
  address: string;
  /** Latitude coordinate (if available) */
  latitude?: number;
  /** Longitude coordinate (if available) */
  longitude?: number;
}

// ============================================
// NAVIGATION PARAMS
// ============================================

/**
 * Props for RatingProofs screen
 */
export interface RatingProofsScreenParams {
  playerRatingScoreId: string;
  sportName: string;
  ratingValue: number;
  isOwnProfile: boolean;
  /** Optional: auto-open the add proof sheet on mount */
  openSheet?: 'add';
}

/**
 * Props for Match detail screen
 */
export interface MatchDetailScreenParams {
  matchId: string;
}

/**
 * Props for Player profile screen
 */
export interface PlayerProfileScreenParams {
  playerId: string;
  isOwnProfile?: boolean;
}

/**
 * Props for Facility detail screen
 * returnTo: when set, back button navigates to this root screen instead of popping the stack
 */
export interface FacilityDetailScreenParams {
  facilityId: string;
  returnTo?: 'MyBookings';
}

/**
 * Props for Sport profile screen
 */
export interface SportProfileScreenParams {
  sportId: string;
  sportName: 'tennis' | 'pickleball';
  /** Optional sheet to auto-open on mount */
  openSheet?: 'preferences' | 'rating' | 'favorite-facilities';
}

// ============================================
// UI-ONLY ENUMS
// ============================================

/**
 * Access type for matches (UI concept, not stored in DB)
 */
export type AccessType = 'open' | 'closed' | 'invite-only';

/**
 * UI display modes for lists
 */
export type ViewMode = 'list' | 'grid' | 'map';

/**
 * Filter chip selection state
 */
export type FilterSelectionState = 'selected' | 'unselected' | 'disabled';

/**
 * Loading states for async operations
 */
export type LoadingState = 'idle' | 'loading' | 'success' | 'error';

// ============================================
// FORM TYPES
// ============================================

/**
 * Generic form field state
 */
export interface FormFieldState<T> {
  value: T;
  error?: string;
  touched: boolean;
  dirty: boolean;
}

/**
 * Match creation form data
 * Contains all fields needed for the match creation wizard
 */
export interface MatchFormData {
  // ============================================
  // BASIC INFO
  // ============================================

  /** Selected sport ID */
  sportId: string;

  /** Date of the match (ISO date string YYYY-MM-DD) */
  matchDate: string;

  /** Start time (HH:MM format) */
  startTime: string;

  /** End time (HH:MM format) - calculated from duration */
  endTime: string;

  /** IANA timezone identifier (e.g., "America/New_York") */
  timezone: string;

  // ============================================
  // DURATION
  // ============================================

  /** Standard duration option (30, 60, 90, 120 minutes or custom) */
  duration: MatchDurationEnum;

  /** Custom duration in minutes (required when duration is 'custom') */
  customDurationMinutes?: number;

  // ============================================
  // MATCH FORMAT & TYPE
  // ============================================

  /** Match format: singles (2 players) or doubles (4 players) */
  format: MatchFormatEnum;

  /** Player expectation: practice/rally, competitive match, or both */
  playerExpectation: MatchTypeEnum;

  // ============================================
  // LOCATION
  // ============================================

  /** How location was specified */
  locationType: LocationTypeEnum;

  /** Selected facility ID (when locationType is 'facility') */
  facilityId?: string;

  /** Selected court ID (when locationType is 'facility') */
  courtId?: string;

  /** Custom location name (when locationType is 'custom') */
  locationName?: string;

  /** Custom location address (when locationType is 'custom') */
  locationAddress?: string;

  // ============================================
  // COURT & COST
  // ============================================

  /** Court reservation status */
  courtStatus?: CourtStatusEnum;

  /** Whether the court is free (no cost) */
  isCourtFree: boolean;

  /** How court costs are split among players */
  costSplitType: CostSplitTypeEnum;

  /** Estimated total court cost (when isCourtFree is false) */
  estimatedCost?: number;

  // ============================================
  // OPPONENT PREFERENCES
  // ============================================

  /** Minimum required rating for opponents (rating_score ID) */
  minRatingScoreId?: string;

  /** Preferred gender of opponent/partner */
  preferredOpponentGender?: GenderEnum;

  // ============================================
  // VISIBILITY & ACCESS
  // ============================================

  /** Match visibility: public (discoverable) or private (invite only) */
  visibility: MatchVisibilityEnum;

  /** When private: whether the match is visible in groups the creator is part of */
  visibleInGroups?: boolean;

  /** When private: whether the match is visible in communities the creator is part of */
  visibleInCommunities?: boolean;

  /** How players join: direct (auto-approve) or request (manual approval) */
  joinMode: MatchJoinModeEnum;

  // ============================================
  // ADDITIONAL INFO
  // ============================================

  /** Additional notes or details from the creator */
  notes?: string;
}

/**
 * Match creation wizard step data
 * Used for multi-step form state management
 */
export interface MatchCreationWizardState {
  /** Current step index (0-based) */
  currentStep: number;

  /** Total number of steps */
  totalSteps: number;

  /** Form data accumulated across steps */
  formData: Partial<MatchFormData>;

  /** Validation errors by field */
  errors: Partial<Record<keyof MatchFormData, string>>;

  /** Whether the form is being submitted */
  isSubmitting: boolean;

  /** Whether the form has been submitted successfully */
  isSubmitted: boolean;
}

/**
 * Match creation wizard step definition
 */
export interface MatchCreationWizardStep {
  /** Step identifier */
  id: string;

  /** Step title for display */
  title: string;

  /** Step description/subtitle */
  description?: string;

  /** Fields included in this step */
  fields: Array<keyof MatchFormData>;

  /** Whether this step is optional */
  optional?: boolean;
}

/**
 * Player preferences form data
 */
export interface PreferencesFormData {
  matchDuration?: string;
  matchType?: string;
  court?: string;
  playStyle?: string;
  playAttributes?: string[];
}

/**
 * Player sport preferences information (UI view model)
 * Note: playStyle and playAttributes now use string values from the
 * play_style and play_attribute database tables instead of enums,
 * allowing for sport-specific options that can be updated without code changes.
 */
export interface PreferencesInfo {
  /** Preferred match duration (e.g., '30', '60', '90', '120') */
  matchDuration?: string;

  /** Preferred match type (e.g., 'casual', 'competitive', 'both') */
  matchType?: string;

  /** Preferred court location/name */
  court?: string;

  /** Player's preferred play style (name from play_style table) */
  playStyle?: string;

  /** Player's key attributes/strengths (names from play_attribute table) */
  playAttributes?: string[];
}

// ============================================
// DEPRECATED TYPES
// Keep for backwards compatibility during migration
// ============================================

/**
 * @deprecated Use MatchStatus from database.ts instead
 * Database type: 'scheduled' | 'in_progress' | 'completed' | 'cancelled' | 'no_show'
 *
 * Migration:
 * - 'upcoming' → 'scheduled'
 * - 'in-progress' → 'in_progress'
 * - 'completed' → 'completed' (no change)
 * - 'cancelled' → 'cancelled' (no change)
 */
export type LegacyMatchStatus = 'upcoming' | 'in-progress' | 'completed' | 'cancelled';

/**
 * @deprecated Use separate field in database schema for singles/doubles
 * This type is no longer used - see database.ts for new structure
 */
export type LegacyMatchType = 'singles' | 'doubles';
