/**
 * User Feedback Service
 */
import { supabase } from '../supabase';

export type UserFeedbackCategory = 'bug' | 'feature' | 'improvement' | 'missing_court' | 'other';

export const USER_FEEDBACK_CATEGORY_LABELS: Record<UserFeedbackCategory, string> = {
  bug: 'Bug Report',
  feature: 'Feature Request',
  improvement: 'Improvement',
  missing_court: 'Missing Court',
  other: 'Other',
};

/** App module/feature area for feedback categorization */
export type UserFeedbackModule =
  | 'profile_settings'
  | 'match_features'
  | 'facilities'
  | 'player_directory'
  | 'groups_communities'
  | 'notifications'
  | 'performance'
  | 'other';

export const USER_FEEDBACK_MODULE_LABELS: Record<UserFeedbackModule, string> = {
  profile_settings: 'Profile & Settings',
  match_features: 'Match Features',
  facilities: 'Facilities',
  player_directory: 'Player Directory',
  groups_communities: 'Groups & Communities',
  notifications: 'Notifications',
  performance: 'Performance',
  other: 'Other',
};

// Category-specific metadata types
export interface BugFeedbackMetadata {
  severity?: 'minor' | 'major' | 'critical';
  steps_to_reproduce: string;
  expected_vs_actual?: string;
}

export interface FeatureFeedbackMetadata {
  feature_title: string;
  description: string;
  use_case?: string;
}

export interface ImprovementFeedbackMetadata {
  disappointment_score: 'very_disappointed' | 'somewhat_disappointed' | 'not_disappointed';
  main_benefit?: string;
  ideal_user?: string;
  how_to_improve: string;
}

export interface MissingCourtFeedbackMetadata {
  place_name?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  place_id?: string;
  details?: string;
}

export type UserFeedbackMetadata =
  | BugFeedbackMetadata
  | FeatureFeedbackMetadata
  | ImprovementFeedbackMetadata
  | MissingCourtFeedbackMetadata;

export type UserFeedbackStatus = 'new' | 'reviewed' | 'in_progress' | 'resolved' | 'closed';

export interface UserFeedbackSubmission {
  id: string;
  player_id: string | null;
  category: UserFeedbackCategory;
  module: UserFeedbackModule;
  subject: string;
  message: string;
  app_version: string | null;
  device_info: Record<string, unknown> | null;
  screenshot_urls: string[] | null;
  metadata: UserFeedbackMetadata | null;
  status: UserFeedbackStatus;
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateUserFeedbackParams {
  playerId?: string;
  category: UserFeedbackCategory;
  module?: UserFeedbackModule;
  subject?: string;
  message?: string;
  metadata?: UserFeedbackMetadata;
  screenshotUrls?: string[];
  /** Platform-specific device info (caller should provide) */
  deviceInfo?: Record<string, unknown>;
  /** App version string (caller should provide) */
  appVersion?: string;
}

export async function submitUserFeedback(
  params: CreateUserFeedbackParams
): Promise<UserFeedbackSubmission> {
  const {
    playerId,
    category,
    module,
    subject,
    message,
    metadata,
    screenshotUrls,
    deviceInfo,
    appVersion,
  } = params;
  const row = {
    player_id: playerId || null,
    category,
    module: module || 'other',
    subject: subject || '',
    message: message || '',
    metadata: metadata || null,
    app_version: appVersion || null,
    device_info: deviceInfo || null,
    screenshot_urls: screenshotUrls || [],
    status: 'new' as const,
  };

  const { data, error } = await supabase.from('feedback').insert(row).select().single();
  if (error) {
    console.error('[submitUserFeedback] Supabase error:', error.code, error.message, error.details);
    throw new Error(`Failed to submit feedback: ${error.message}`);
  }
  if (!data) {
    console.error('[submitUserFeedback] Insert returned no data (possible RLS or FK issue)');
    throw new Error('Failed to submit feedback: no data returned');
  }
  return data;
}

export async function getUserFeedbackHistory(playerId: string): Promise<UserFeedbackSubmission[]> {
  const { data, error } = await supabase
    .from('feedback')
    .select('*')
    .eq('player_id', playerId)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('Error fetching user feedback:', error);
    throw new Error('Failed to fetch feedback history.');
  }
  return data || [];
}

export async function getUserFeedbackById(
  feedbackId: string,
  playerId: string
): Promise<UserFeedbackSubmission | null> {
  const { data, error } = await supabase
    .from('feedback')
    .select('*')
    .eq('id', feedbackId)
    .eq('player_id', playerId)
    .single();
  if (error) {
    if (error.code === 'PGRST116') return null;
    console.error('Error:', error);
    throw new Error('Failed to fetch feedback.');
  }
  return data;
}

// =============================================================================
// PUBLIC FEEDBACK BROWSE & UPVOTE
// =============================================================================

export type PublicFeedbackCategory = Extract<UserFeedbackCategory, 'bug' | 'feature'>;

export interface PublicFeedback {
  id: string;
  category: PublicFeedbackCategory;
  module: UserFeedbackModule;
  subject: string;
  message: string;
  metadata: UserFeedbackMetadata | null;
  status: UserFeedbackStatus;
  admin_notes: string | null;
  screenshot_urls: string[] | null;
  upvote_count: number;
  created_at: string;
  is_anonymous: boolean;
  has_voted: boolean;
}

export interface ListPublicFeedbackParams {
  category: PublicFeedbackCategory;
  playerId: string;
  limit?: number;
  offset?: number;
  search?: string;
}

interface FeedbackBrowseRow {
  id: string;
  player_id: string | null;
  category: PublicFeedbackCategory;
  module: UserFeedbackModule;
  subject: string;
  message: string;
  metadata: UserFeedbackMetadata | null;
  status: UserFeedbackStatus;
  admin_notes: string | null;
  screenshot_urls: string[] | null;
  upvote_count: number;
  created_at: string;
}

const DEFAULT_BROWSE_LIMIT = 25;

export async function listPublicFeedback(
  params: ListPublicFeedbackParams
): Promise<PublicFeedback[]> {
  const { category, playerId, limit = DEFAULT_BROWSE_LIMIT, offset = 0, search } = params;

  let query = supabase
    .from('feedback')
    .select(
      'id, player_id, category, module, subject, message, metadata, status, admin_notes, screenshot_urls, upvote_count, created_at'
    )
    .eq('category', category)
    .eq('visibility', 'public')
    .is('hidden_at', null)
    .order('upvote_count', { ascending: false })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (search && search.trim().length > 0) {
    const term = search.trim().replace(/[%_]/g, '\\$&');
    query = query.or(`subject.ilike.%${term}%,message.ilike.%${term}%`);
  }

  const { data: rows, error } = await query;
  if (error) {
    console.error('[listPublicFeedback] error:', error);
    throw new Error('Failed to load reports.');
  }
  if (!rows || rows.length === 0) return [];

  // Fetch the requesting player's votes on the returned set in one round trip.
  const ids = rows.map(r => r.id);
  const { data: votes, error: votesError } = await supabase
    .from('feedback_vote')
    .select('feedback_id')
    .eq('player_id', playerId)
    .in('feedback_id', ids);

  if (votesError) {
    console.error('[listPublicFeedback] votes error:', votesError);
  }

  const votedIds = new Set((votes ?? []).map(v => v.feedback_id));

  return (rows as FeedbackBrowseRow[]).map(r => ({
    id: r.id,
    category: r.category,
    module: r.module,
    subject: r.subject,
    message: r.message,
    metadata: r.metadata,
    status: r.status,
    admin_notes: r.admin_notes,
    screenshot_urls: r.screenshot_urls,
    upvote_count: r.upvote_count,
    created_at: r.created_at,
    is_anonymous: r.player_id === null,
    has_voted: votedIds.has(r.id),
  }));
}

export async function upvoteFeedback(feedbackId: string, playerId: string): Promise<void> {
  const { error } = await supabase
    .from('feedback_vote')
    .insert({ feedback_id: feedbackId, player_id: playerId });

  // Treat unique-violation as success (idempotent toggle-on).
  if (error && error.code !== '23505') {
    console.error('[upvoteFeedback] error:', error);
    throw new Error('Failed to upvote.');
  }
}

export async function removeFeedbackUpvote(feedbackId: string, playerId: string): Promise<void> {
  const { error } = await supabase
    .from('feedback_vote')
    .delete()
    .eq('feedback_id', feedbackId)
    .eq('player_id', playerId);

  if (error) {
    console.error('[removeFeedbackUpvote] error:', error);
    throw new Error('Failed to remove upvote.');
  }
}
