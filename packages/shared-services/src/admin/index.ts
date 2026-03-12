/**
 * Admin Services - Barrel Export
 *
 * Note: Some exports are explicitly handled to avoid conflicts with overlapping
 * function names across different services.
 */

// Admin Service - Types
export type {
  AdminUserStatus,
  AdminUserFilters,
  AdminUserInfo,
  AdminBanInfo,
  AdminUsersPage,
  FetchAdminUsersParams,
  BanUserParams,
  AdminUserDetail,
  AdminSportProfile,
  AdminMatchSummary,
  EditableProfileFields,
  AdminAuditLogEntry,
  CertifyRatingParams,
} from './adminService';

// Admin Service - Functions
export {
  fetchAdminUsers,
  fetchAdminUserDetail,
  banUser,
  unbanUser,
  getActivePlayerBan,
  getPlayerBanHistory,
  updatePlayerProfile,
  adminCertifyRating,
} from './adminService';

// Analytics Service - Types
export type {
  RealtimeUserStats,
  MatchStatistics,
  OnboardingFunnelStep,
  AnalyticsSnapshot,
  MetricTrendPoint,
  SportStatistics,
  KPISummary,
  DashboardWidget,
  OnboardingFunnelRPC,
  RetentionCohort,
  MatchAnalyticsRPC,
  SportDistribution,
  UserGrowthTrend,
  SessionMetrics,
  FeatureAdoption,
  ScreenAnalytics,
  MessageVolume,
  ConversationHealth,
  EngagementDistribution,
  MatchChatAdoption,
  RatingDistribution,
  CertificationFunnelStep,
  ReputationDistribution,
  ReputationEventData,
  PeerRatingActivity,
  ReportVolume,
  ReportTypeDistribution,
  ResolutionMetrics,
  BanStatistics,
  FeedbackSentiment,
  NetworkGrowth,
  NetworkSizeDistribution,
  NetworkActivity,
  NetworkMatchIntegration,
  SportPopularity,
  SportActivityComparison,
  SportGrowthTrend,
  SportFacilityData,
} from './analyticsService';

// Analytics Service - Functions
export {
  getRealtimeUserStats,
  getMatchStatistics,
  getMatchesTodayCount,
  getOnboardingFunnel,
  getSportStatistics,
  getMetricTrend,
  getKPISummary,
  getAnalyticsSnapshots,
  buildDashboardWidgets,
  getWidgetTrends,
  getOnboardingFunnelRPC,
  getRetentionCohort,
  getMatchAnalyticsRPC,
  getSportDistribution,
  getUserGrowthTrend,
  getSessionMetrics,
  getFeatureAdoption,
  getScreenAnalytics,
  getMessageVolume,
  getConversationHealth,
  getEngagementDistribution,
  getMatchChatAdoption,
  getRatingDistribution,
  getCertificationFunnel,
  getReputationDistribution,
  getReputationEvents,
  getPeerRatingActivity,
  getReportVolume,
  getReportTypes,
  getResolutionMetrics,
  getBanStatistics,
  getFeedbackSentiment,
  getNetworkGrowth,
  getNetworkSizeDistribution,
  getTopNetworkActivity,
  getNetworkMatchIntegration,
  getSportPopularity,
  getSportActivityComparison,
  getSportGrowthTrends,
  getSportFacilityData,
} from './analyticsService';

// Audit Service - Types
export type {
  AuditActionType,
  AuditEntityType,
  AuditSeverity,
  AuditLogEntry,
  AuditLogStats,
  AuditLogFilters,
  LogActionParams,
} from './auditService';

// Audit Service - Functions and objects
export {
  logAdminAction,
  getAuditLog,
  getAuditLogStats,
  getEntityAuditHistory,
  getAdminActivityHistory,
  logUserView,
  logUserBan,
  logUserUnban,
  logDataExport,
  logAdminLogin,
  logConfigChange,
  logSearchAction,
  getActionTypeLabel,
  getActionTypeIcon,
  getSeverityColor,
  auditService,
} from './auditService';

// Alert Service - Types
export type {
  AlertType,
  AlertSeverity,
  AdminAlert,
  AlertCounts,
  AlertPreference,
} from './alertService';

// Alert Service - Functions and objects
export {
  getAdminAlerts,
  getAlertCounts,
  markAlertRead,
  markAllAlertsRead,
  dismissAlert,
  createManualAlert,
  getAlertPreferences,
  updateAlertPreference,
  getAlertTypeIcon,
  getAlertTypeLabel,
  formatAlertTime,
  alertService,
} from './alertService';

// Moderation Service - primary source for moderation types
export * from './moderationService';

// Admin Push Service
export * from './adminPushService';

// Admin Network Service - Types
export type {
  AdminNetworkType,
  AdminNetworkFilters,
  AdminNetworkInfo,
  AdminNetworkMember,
  AdminNetworkFacility,
  AdminNetworkDetail,
  AdminNetworksPage,
  FetchAdminNetworksParams,
  CertifyNetworkParams,
  DeleteNetworkParams,
  DeleteNetworkResult,
  AdminSetting,
  NetworkLimits,
} from './adminNetworkService';

// Admin Network Service - Functions
export {
  fetchAdminNetworks,
  fetchAdminNetworkDetail,
  certifyNetwork,
  deleteNetwork,
  getAdminSetting,
  updateAdminSetting,
  getNetworkLimits,
  updateNetworkLimits,
} from './adminNetworkService';
