/**
 * Admin Services - Barrel Export
 * 
 * Note: Some exports are explicitly handled to avoid conflicts with overlapping
 * function names across different services.
 */

// Admin Service - User management and user admin functions
export {
  // Types
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
  // Functions
  fetchAdminUsers,
  fetchAdminUserDetail,
  banUser,
  unbanUser,
  getActivePlayerBan,
  getPlayerBanHistory,
  updatePlayerProfile,
  // Note: logAdminAction and getAuditLog from adminService are excluded - use auditService versions
} from './adminService';

// Analytics Service
export {
  // Dashboard/KPI types
  RealtimeUserStats,
  MatchStatistics,
  OnboardingFunnelStep,
  AnalyticsSnapshot,
  MetricTrendPoint,
  SportStatistics,
  KPISummary,
  DashboardWidget,
  // Dashboard/KPI functions
  getRealtimeUserStats,
  getMatchStatistics,
  getOnboardingFunnel,
  getSportStatistics,
  getMetricTrend,
  getKPISummary,
  getAnalyticsSnapshots,
  buildDashboardWidgets,
  getWidgetTrends,
  // User/Growth analytics types
  OnboardingFunnelRPC,
  RetentionCohort,
  MatchAnalyticsRPC,
  SportDistribution,
  UserGrowthTrend,
  // User/Growth analytics functions
  getOnboardingFunnelRPC,
  getRetentionCohort,
  getMatchAnalyticsRPC,
  getSportDistribution,
  getUserGrowthTrend,
  // Session/Engagement types
  SessionMetrics,
  FeatureAdoption,
  ScreenAnalytics,
  // Session/Engagement functions
  getSessionMetrics,
  getFeatureAdoption,
  getScreenAnalytics,
  // Messaging types
  MessageVolume,
  ConversationHealth,
  EngagementDistribution,
  MatchChatAdoption,
  // Messaging functions
  getMessageVolume,
  getConversationHealth,
  getEngagementDistribution,
  getMatchChatAdoption,
  // Rating types
  RatingDistribution,
  CertificationFunnelStep,
  ReputationDistribution,
  ReputationEventData,
  PeerRatingActivity,
  // Rating functions
  getRatingDistribution,
  getCertificationFunnel,
  getReputationDistribution,
  getReputationEvents,
  getPeerRatingActivity,
  // Moderation analytics types
  ReportVolume,
  ReportTypeDistribution,
  ResolutionMetrics,
  BanStatistics,
  FeedbackSentiment,
  // Moderation analytics functions
  getReportVolume,
  getReportTypes,
  getResolutionMetrics,
  getBanStatistics,
  getFeedbackSentiment,
  // Network/Community types
  NetworkGrowth,
  NetworkSizeDistribution,
  NetworkActivity,
  NetworkMatchIntegration,
  // Network/Community functions
  getNetworkGrowth,
  getNetworkSizeDistribution,
  getTopNetworkActivity,
  getNetworkMatchIntegration,
  // Sport analytics types
  SportPopularity,
  SportActivityComparison,
  SportGrowthTrend,
  SportFacilityData,
  // Sport analytics functions
  getSportPopularity,
  getSportActivityComparison,
  getSportGrowthTrends,
  getSportFacilityData,
} from './analyticsService';

// Audit Service - primary source for audit functions
export {
  // Types
  AuditActionType,
  AuditEntityType,
  AuditSeverity,
  AuditLogEntry,
  AuditLogStats,
  AuditLogFilters,
  LogActionParams,
  // Functions
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
  // Service object
  auditService,
} from './auditService';

// Alert Service
export {
  // Types
  AlertType,
  AlertSeverity,
  AdminAlert,
  AlertCounts,
  AlertPreference,
  // Functions
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
  // Service object
  alertService,
} from './alertService';

// Moderation Service - primary source for moderation types
export * from './moderationService';

// Admin Push Service
export * from './adminPushService';
