/**
 * Shared Services - Barrel Export
 */

export * from './supabase';
export * from './database';
// verification.ts is deprecated - use useAuth hook from @rallia/shared-hooks instead
// export * from './verification';
export * from './usta';
export * from './dupr';
export * from './logger';
export * from './notifications';
export * from './matches';
export * from './feedback';
export * from './facilities';
export * from './courts';
export * from './availability';
export * from './players';
export * from './reputation';
export * from './shared-contacts';
export * from './match-share';
export * from './groups';
export * from './communities';
export * from './chat';
// Reports - explicit exports to avoid conflicts with admin/moderationService
export {
  createReport as createUserReport,
  CreateReportParams as CreateUserReportParams,
  ReportReason,
  REPORT_REASON_LABELS,
} from './reports';
// Bookings - client-safe exports (types, validation, status, policy)
// For server-side functions (createBooking, cancelBooking), use web app's lib/bookings
export * from './bookings';
export * from './programs';
export * from './tour';
export * from './feedback';
export * from './admin';

// Export default DatabaseService
export { default } from './database';
export { default as DatabaseService } from './database';
