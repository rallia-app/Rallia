/**
 * Facility Report Service
 * Handles facility inaccuracy reporting functionality
 */

import { supabase } from '../supabase';

export type FacilityReportReason =
  | 'wrong_address'
  | 'incorrect_hours'
  | 'wrong_court_count'
  | 'wrong_surface_types'
  | 'outdated_contact_info'
  | 'wrong_amenities'
  | 'other';

export interface CreateFacilityReportParams {
  reporterId: string;
  facilityId: string;
  reason: FacilityReportReason;
  description?: string;
}

// Priority assignment based on report reason
const FACILITY_REPORT_PRIORITY: Record<FacilityReportReason, 'low' | 'normal' | 'high'> = {
  wrong_address: 'normal',
  incorrect_hours: 'normal',
  wrong_court_count: 'low',
  wrong_surface_types: 'low',
  outdated_contact_info: 'low',
  wrong_amenities: 'low',
  other: 'normal',
};

/**
 * Submit a facility inaccuracy report
 */
export async function createFacilityReport(params: CreateFacilityReportParams): Promise<void> {
  const { reporterId, facilityId, reason, description } = params;

  // Check for duplicate report within 24 hours (same reporter + facility + reason)
  const oneDayAgo = new Date();
  oneDayAgo.setDate(oneDayAgo.getDate() - 1);

  const { data: existingReport } = await supabase
    .from('facility_report')
    .select('id')
    .eq('reporter_id', reporterId)
    .eq('facility_id', facilityId)
    .eq('reason', reason)
    .gte('created_at', oneDayAgo.toISOString())
    .maybeSingle();

  if (existingReport) {
    throw new Error('DUPLICATE_REPORT');
  }

  const priority = FACILITY_REPORT_PRIORITY[reason];

  const { error } = await supabase.from('facility_report').insert({
    reporter_id: reporterId,
    facility_id: facilityId,
    reason,
    description: description || null,
    status: 'pending',
    priority,
  });

  if (error) {
    console.error('Error creating facility report:', error);
    throw new Error('Failed to submit report. Please try again.');
  }
}
