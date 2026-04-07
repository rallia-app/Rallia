/**
 * Proof Report Service
 * Handles rating proof reporting functionality
 */

import { supabase } from '../supabase';

export type ProofReportReason =
  | 'fake_proof'
  | 'misleading'
  | 'outdated'
  | 'stolen_content'
  | 'other';

export interface CreateProofReportParams {
  reporterId: string;
  proofId: string;
  reason: ProofReportReason;
  description?: string;
}

// Priority assignment based on report reason
const PROOF_REPORT_PRIORITY: Record<ProofReportReason, 'low' | 'normal' | 'high'> = {
  fake_proof: 'high',
  stolen_content: 'high',
  misleading: 'normal',
  outdated: 'low',
  other: 'normal',
};

/**
 * Submit a rating proof report
 */
export async function createProofReport(params: CreateProofReportParams): Promise<void> {
  const { reporterId, proofId, reason, description } = params;

  // Check for duplicate report within 24 hours (same reporter + proof + reason)
  const oneDayAgo = new Date();
  oneDayAgo.setDate(oneDayAgo.getDate() - 1);

  const { data: existingReport } = await supabase
    .from('proof_report')
    .select('id')
    .eq('reporter_id', reporterId)
    .eq('proof_id', proofId)
    .eq('reason', reason)
    .gte('created_at', oneDayAgo.toISOString())
    .maybeSingle();

  if (existingReport) {
    throw new Error('DUPLICATE_REPORT');
  }

  const priority = PROOF_REPORT_PRIORITY[reason];

  const { error } = await supabase.from('proof_report').insert({
    reporter_id: reporterId,
    proof_id: proofId,
    reason,
    description: description || null,
    status: 'pending',
    priority,
  });

  if (error) {
    console.error('Error creating proof report:', error);
    throw new Error('Failed to submit report. Please try again.');
  }
}
