/**
 * Master gate for the weekly check-in wizard.
 *
 * Flip to `true` to re-enable the auto-opener at app launch and the home
 * availability-refresh banner (whose CTA navigates into the wizard). The
 * `WeeklyCheckIn` route is still registered in AppNavigator when this is
 * false — it's just unreachable from the UI.
 */
export const WEEKLY_CHECKIN_ENABLED = true;
