/**
 * User Feedback Service
 */
import { supabase } from '../supabase';

export type UserFeedbackCategory = 'bug' | 'feature' | 'improvement' | 'other';

export const USER_FEEDBACK_CATEGORY_LABELS: Record<UserFeedbackCategory, string> = {
  bug: 'Bug Report',
  feature: 'Feature Request',
  improvement: 'Improvement',
  other: 'Other',
};

/** App module/feature area for feedback categorization */
export type UserFeedbackModule =
  | 'match_features'
  | 'profile_settings'
  | 'messaging'
  | 'rating_system'
  | 'player_directory'
  | 'notifications'
  | 'performance'
  | 'other';

export const USER_FEEDBACK_MODULE_LABELS: Record<UserFeedbackModule, string> = {
  match_features: 'Match Features',
  profile_settings: 'Profile & Settings',
  messaging: 'Messaging',
  rating_system: 'Rating System',
  player_directory: 'Player Directory',
  notifications: 'Notifications',
  performance: 'Performance',
  other: 'Other',
};

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
  status: UserFeedbackStatus;
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateUserFeedbackParams {
  playerId?: string;
  category: UserFeedbackCategory;
  module: UserFeedbackModule;
  subject: string;
  message: string;
  screenshotUrls?: string[];
  /** Platform-specific device info (caller should provide) */
  deviceInfo?: Record<string, unknown>;
  /** App version string (caller should provide) */
  appVersion?: string;
}

export async function submitUserFeedback(
  params: CreateUserFeedbackParams
): Promise<UserFeedbackSubmission> {
  const { playerId, category, module, subject, message, screenshotUrls, deviceInfo, appVersion } =
    params;
  const { data, error } = await supabase
    .from('feedback')
    .insert({
      player_id: playerId || null,
      category,
      module,
      subject,
      message,
      app_version: appVersion || null,
      device_info: deviceInfo || null,
      screenshot_urls: screenshotUrls || [],
      status: 'new',
    })
    .select()
    .single();
  if (error) {
    console.error('Error submitting feedback:', error);
    throw new Error('Failed to submit feedback.');
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
